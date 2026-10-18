import { describe, expect, it } from "vitest";
import {
  beginTurn,
  draftCard,
  draftEffect,
  draftPass,
  draftSummon,
  resetTurn,
} from "../app/draft";
import { endTurn } from "../app/session";
import {
  actionCardId,
  fixtureEngine,
  followers,
  noEffect,
  noEffectEngine,
  pass,
  readyCard,
  setupSession,
  withBoard,
} from "../test/turnFixtures";
import type { GameSession } from "./events";
import type { EffectPlan, TurnPlan } from "./turnTypes";
import { totalFollowers } from "./domain";
import { CardRulesNotImplementedError } from "./errors";
import { assertGameInvariants } from "./invariants";
import { copyChoice } from "./plans";
import { createTurnEngine, turnEngine } from "./turns";

describe.each([2, 3])("%i-player turn commits", (count) => {
  it("advances clockwise on pass without consuming cards, support, or action timing", () => {
    const initial = setupSession(count);
    const before = JSON.stringify(initial);
    const next = pass(initial);
    const seat = initial.state.playerOrder.indexOf(
      initial.state.activePlayerId,
    );
    expect(next.state.activePlayerId).toBe(
      initial.state.playerOrder[(seat + 1) % count],
    );
    expect(next.state.players).toEqual(initial.state.players);
    expect(next.state.supply).toEqual(initial.state.supply);
    expect(next.state.regions).toEqual(initial.state.regions);
    expect(next.state.turnSequence).toBe(1);
    expect(next.state.actionSequence).toBe(0);
    expect(next.state.consecutivePasses).toBe(1);
    expect(next.events).toHaveLength(2);
    expect(next.events[1]).toMatchObject({
      type: "TurnCommitted",
      playerId: initial.state.activePlayerId,
      turnSequence: 1,
      actionSequence: 0,
      eventSequence: 1,
      card: null,
      plan: { kind: "pass" },
    });
    expect(JSON.stringify(initial)).toBe(before);
  });

  it("resolves exactly one struggle after the entire table passes and resumes the next seat", () => {
    const initial = setupSession(count);
    const first = initial.state.regionCards[0];
    if (!first) throw new Error("fixture");
    const almost = pass(initial, count - 1);
    expect(almost.state.regionCards.every((card) => card.faceUp)).toBe(true);
    const next = pass(almost);
    expect(next.state.regionCards.filter((card) => !card.faceUp)).toHaveLength(
      1,
    );
    expect(next.state.regionCards[0]?.faceUp).toBe(false);
    expect(next.state.regions[first.regionId].followers).toEqual(followers());
    expect(next.state.activePlayerId).toBe(initial.state.activePlayerId);
    expect(next.state.consecutivePasses).toBe(0);
    expect(next.state.actionSequence).toBe(0);
    expect(next.events.map((event) => event.type)).toEqual([
      "GameCreated",
      ...Array.from({ length: count }, () => "TurnCommitted"),
      "PowerStruggleResolved",
    ]);
    expect(next.events.map((event) => event.eventSequence)).toEqual(
      Array.from({ length: count + 2 }, (_, index) => index),
    );
    assertGameInvariants(next.state);
  });

  it("allows a previous passer to act when the next cycle reaches them", () => {
    const session = pass(setupSession(count), count);
    const actor = session.state.activePlayerId;
    const result = endTurn(session, readyCard(session.state), noEffectEngine);
    expect(result.state.players[actor]?.discards).toHaveLength(1);
    expect(result.state.actionSequence).toBe(1);
    expect(result.state.players[actor]?.lastActionSequence).toBe(1);
  });

  it("resets the pass streak on a card action; summons do not advance action timing twice", () => {
    let session = pass(setupSession(count));
    const actor = session.state.activePlayerId;
    session = endTurn(session, readyCard(session.state), noEffectEngine);
    expect(session.state.consecutivePasses).toBe(0);
    expect(session.state.actionSequence).toBe(1);
    session = pass(session, count - 1);
    expect(session.state.regionCards.every((card) => card.faceUp)).toBe(true);
    expect(session.state.players[actor]?.lastActionSequence).toBe(1);
    expect(session.state.actionSequence).toBe(1);
    expect(
      pass(session).state.regionCards.filter((card) => !card.faceUp),
    ).toHaveLength(1);
  });
});

describe("atomic card boundary", () => {
  it("logs ordered transfers separately from the final summon", () => {
    const session = withBoard(setupSession(), {
      moray: followers(0, 1),
      devon: followers(1),
    });
    const operations: EffectPlan["operations"] = [
      {
        kind: "transfer",
        from: { kind: "region", regionId: "moray" },
        to: { kind: "supply" },
        faction: "welsh",
        count: 1,
      },
      {
        kind: "transfer",
        from: { kind: "supply" },
        to: { kind: "region", regionId: "moray" },
        faction: "welsh",
        count: 1,
      },
    ];
    const effect: EffectPlan = {
      kind: "effect",
      effectiveCard: "assemble",
      tier: 1,
      operations,
    };
    const engine = fixtureEngine(() => [effect]);
    const draft = readyCard(session.state, engine, (choices) =>
      choices.find(
        (choice) => choice.kind === "follower" && choice.regionId === "devon",
      ),
    );
    const next = endTurn(session, draft, engine);
    expect(next.events.at(-1)).toMatchObject({
      type: "TurnCommitted",
      plan: {
        effect: { operations },
        summon: { kind: "follower", regionId: "devon", faction: "scottish" },
      },
    });
    expect(next.state.regions.moray.followers).toEqual(followers(0, 1));
    expect(next.state.regions.devon.followers).toEqual(followers());
    expect(next.state.supply).toEqual(session.state.supply);
  });

  it("consumes one physical card, summons once, and records a single complete action", () => {
    const initial = setupSession();
    const actor = initial.state.activePlayerId;
    const cardId = actionCardId(initial.state);
    const next = endTurn(initial, readyCard(initial.state), noEffectEngine);
    expect(next.state.players[actor]?.hand).toHaveLength(7);
    expect(
      next.state.players[actor]?.hand.some((card) => card.id === cardId),
    ).toBe(false);
    expect(next.state.players[actor]?.discards.at(-1)?.id).toBe(cardId);
    expect(
      totalFollowers(next.state.players[actor]?.court ?? followers()),
    ).toBe(3);
    expect(next.state.turnSequence).toBe(1);
    expect(next.state.actionSequence).toBe(1);
    expect(next.events[1]).toMatchObject({
      type: "TurnCommitted",
      card: { id: cardId, type: "assemble" },
      plan: {
        kind: "card",
        effect: noEffect,
        summon: { kind: "follower", count: 1 },
      },
    });
    expect(Object.isFrozen(next.events[1])).toBe(true);
    expect(Object.isFrozen(next.state.players[actor]?.discards)).toBe(true);
  });

  it("rejects an opponent's card and a card already consumed on an earlier turn", () => {
    const session = setupSession();
    const opponent = session.state.playerOrder.find(
      (id) => id !== session.state.activePlayerId,
    );
    const card = opponent
      ? session.state.players[opponent]?.hand[0]
      : undefined;
    if (!card) throw new Error("fixture");
    expect(() =>
      noEffectEngine.previewTurn(
        session.state,
        draftCard(beginTurn(session.state), card.id),
      ),
    ).toThrow("not in");
    const cardId = actionCardId(session.state);
    const next = pass(
      endTurn(session, readyCard(session.state), noEffectEngine),
      2,
    );
    expect(() =>
      noEffectEngine.previewTurn(
        next.state,
        draftCard(beginTurn(next.state), cardId),
      ),
    ).toThrow("not in");
  });

  it("reports unsupported card rules explicitly instead of treating them as no-effect", () => {
    const { state } = setupSession();
    const unconfigured = createTurnEngine();
    expect(unconfigured.getAvailableCards(state, state.activePlayerId)).toEqual(
      [],
    );
    expect(() =>
      unconfigured.previewTurn(
        state,
        draftCard(beginTurn(state), actionCardId(state)),
      ),
    ).toThrow(CardRulesNotImplementedError);
  });

  it("keeps Plot unplayable", () => {
    let session: GameSession | undefined;
    for (let seed = 0; seed < 100; seed += 1) {
      const candidate = setupSession(3, "advanced", `plot-${seed}`);
      if (
        candidate.state.players[candidate.state.activePlayerId]?.hand.some(
          (card) => card.type === "plot",
        )
      ) {
        session = candidate;
        break;
      }
    }
    if (!session) throw new Error("No Plot fixture");
    const plot = session.state.players[session.state.activePlayerId]?.hand.find(
      (card) => card.type === "plot",
    );
    if (!plot) throw new Error("fixture");
    expect(() =>
      noEffectEngine.previewTurn(
        session.state,
        draftCard(beginTurn(session.state), plot.id),
      ),
    ).toThrow("Plot cannot");
    expect(
      noEffectEngine
        .getAvailableCards(session.state, session.state.activePlayerId)
        .some((card) => card.type === "plot"),
    ).toBe(false);
  });

  it("rejects incomplete turns and missing summons without changing any accepted data", () => {
    const session = setupSession();
    const before = JSON.stringify(session);
    const draft = draftEffect(
      draftCard(beginTurn(session.state), actionCardId(session.state)),
      noEffect,
    );
    expect(() =>
      endTurn(session, beginTurn(session.state), noEffectEngine),
    ).toThrow("Complete");
    expect(() =>
      endTurn(
        session,
        draftCard(beginTurn(session.state), actionCardId(session.state)),
        noEffectEngine,
      ),
    ).toThrow("Complete");
    expect(() => endTurn(session, draft, noEffectEngine)).toThrow("Complete");
    expect(JSON.stringify(session)).toBe(before);
  });

  it("rejects a forged zero-effect plan while full plans exist elsewhere", () => {
    const session = withBoard(setupSession(), {});
    const full: EffectPlan = {
      kind: "effect",
      effectiveCard: "assemble",
      tier: 1,
      operations: [
        {
          kind: "transfer",
          from: { kind: "supply" },
          to: { kind: "region", regionId: "devon" },
          faction: "english",
          count: 1,
        },
      ],
    };
    const engine = fixtureEngine(() => [noEffect, full]);
    expect(
      engine.enumerateEffectPlans(
        session.state,
        session.state.activePlayerId,
        actionCardId(session.state),
      ),
    ).toEqual([full]);
    const draft = draftEffect(
      draftCard(beginTurn(session.state), actionCardId(session.state)),
      noEffect,
    );
    expect(() => engine.previewTurn(session.state, draft)).toThrow(
      "maximum-tier",
    );
  });

  it("revalidates a previewed effect at End Turn", () => {
    const session = setupSession();
    let allowed = true;
    const engine = fixtureEngine(() => (allowed ? [noEffect] : []));
    const draft = readyCard(session.state, engine);
    expect(engine.previewTurn(session.state, draft).step).toBe("ready");
    allowed = false;
    expect(() => endTurn(session, draft, engine)).toThrow("currently legal");
    expect(session.events).toHaveLength(1);
    expect(session.state.actionSequence).toBe(0);
  });

  it("rejects a later invalid transfer without preserving earlier transfers or consuming the card", () => {
    const session = withBoard(setupSession(), {});
    const invalid: EffectPlan = {
      kind: "effect",
      effectiveCard: "assemble",
      tier: 1,
      operations: [
        {
          kind: "transfer",
          from: { kind: "supply" },
          to: { kind: "region", regionId: "devon" },
          faction: "english",
          count: 1,
        },
        {
          kind: "transfer",
          from: { kind: "region", regionId: "moray" },
          to: { kind: "supply" },
          faction: "scottish",
          count: 1,
        },
      ],
    };
    const engine = fixtureEngine(() => [invalid]);
    const before = JSON.stringify(session);
    const plan: TurnPlan = {
      kind: "card",
      playerId: session.state.activePlayerId,
      baseTurnSequence: 0,
      cardId: actionCardId(session.state),
      effect: invalid,
      summon: {
        kind: "follower",
        count: 1,
        regionId: "devon",
        faction: "english",
      },
    };
    expect(() => engine.commitTurn(session.state, plan)).toThrow("Not enough");
    expect(JSON.stringify(session)).toBe(before);
  });

  it("accepts equivalent JSON property ordering and freezes outputs without freezing caller plans", () => {
    const { state } = setupSession();
    const plan = noEffectEngine.previewTurn(state, readyCard(state)).plan;
    if (plan?.kind !== "card") throw new Error("fixture");
    const reordered = {
      summon: { ...plan.summon },
      effect: { ...plan.effect },
      cardId: plan.cardId,
      baseTurnSequence: plan.baseTurnSequence,
      playerId: plan.playerId,
      kind: "card" as const,
    };
    const result = noEffectEngine.commitTurn(state, reordered);
    expect(result.events).toHaveLength(1);
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(Object.isFrozen(reordered)).toBe(false);
    expect(Object.isFrozen(reordered.effect)).toBe(false);
  });

  it("does not mutate or freeze unfrozen input state during pass/card previews", () => {
    const state = copyChoice(setupSession().state);
    const before = JSON.stringify(state);
    noEffectEngine.previewTurn(state, draftPass(beginTurn(state)));
    noEffectEngine.previewTurn(state, readyCard(state));
    expect(JSON.stringify(state)).toBe(before);
    expect(Object.isFrozen(state)).toBe(false);
    expect(Object.isFrozen(state.regions.moray.followers)).toBe(false);
  });
});

describe("draft reset and accepted history", () => {
  it("does not freeze a caller's mutable session or its existing history when appending", () => {
    const session = copyChoice(setupSession());
    const before = JSON.stringify(session);
    const next = pass(session);
    expect(Object.isFrozen(session.events)).toBe(false);
    expect(Object.isFrozen(session.events[0])).toBe(false);
    expect(Object.isFrozen(session.state)).toBe(false);
    expect(JSON.stringify(session)).toBe(before);
    expect(next.events.slice(0, 1)).toEqual(session.events);
    expect(Object.isFrozen(next.events[0])).toBe(true);
  });

  it("discards card/effect/summon previews without changing any canonical field or event", () => {
    const session = withBoard(setupSession(), {});
    const effect: EffectPlan = {
      kind: "effect",
      effectiveCard: "assemble",
      tier: 1,
      operations: [
        {
          kind: "transfer",
          from: { kind: "supply" },
          to: { kind: "region", regionId: "moray" },
          faction: "welsh",
          count: 1,
        },
      ],
    };
    const engine = fixtureEngine(() => [effect]);
    const before = JSON.stringify(session);
    const draft = readyCard(session.state, engine);
    const preview = engine.previewTurn(session.state, draft);
    expect(
      preview.state.players[session.state.activePlayerId]?.court,
    ).not.toEqual(session.state.players[session.state.activePlayerId]?.court);
    expect(preview.state.supply.welsh).toBe(session.state.supply.welsh - 1);
    expect(resetTurn(session.state, draft)).toEqual(beginTurn(session.state));
    expect(JSON.stringify(session)).toBe(before);
    expect(
      session.state.players[session.state.activePlayerId]
        ?.negotiationDiscLocation,
    ).toBeNull();
  });

  it("resets a drafted pass without resolving its imminent struggle", () => {
    const session = pass(setupSession(), 2);
    const draft = draftPass(beginTurn(session.state));
    const before = JSON.stringify(session);
    expect(turnEngine.previewTurn(session.state, draft).state).toEqual(
      session.state,
    );
    expect(resetTurn(session.state, draft).selection.kind).toBe("unselected");
    expect(JSON.stringify(session)).toBe(before);
    expect(session.state.regionCards.every((card) => card.faceUp)).toBe(true);
  });

  it("cannot reset or resubmit a committed turn, even when the same player becomes active again", () => {
    const session = setupSession();
    const draft = draftPass(beginTurn(session.state));
    const committed = endTurn(session, draft);
    expect(() => resetTurn(committed.state, draft)).toThrow("Stale");
    expect(() => endTurn(committed, draft)).toThrow("Stale");
    const cycle = pass(committed, 2);
    expect(cycle.state.activePlayerId).toBe(draft.playerId);
    expect(() => endTurn(cycle, draft)).toThrow("Stale");
  });

  it("clears dependent summon/effect choices when an earlier choice changes", () => {
    const state = setupSession().state;
    const ready = readyCard(state);
    const changedEffect = draftEffect(ready, noEffect);
    expect(changedEffect.selection).toMatchObject({
      kind: "card",
      summon: null,
    });
    expect(draftCard(ready, actionCardId(state)).selection).toMatchObject({
      effect: null,
      summon: null,
    });
    expect(draftPass(ready).selection).toEqual({ kind: "pass" });
    expect(() => draftEffect(beginTurn(state), noEffect)).toThrow(
      "Select a card",
    );
    expect(() =>
      draftSummon(draftCard(beginTurn(state), actionCardId(state)), {
        kind: "zero",
        count: 0,
        reason: "no-followers-in-uncontrolled-regions",
      }),
    ).toThrow("Select an effect");
  });

  it("rejects the wrong player and malformed or truncated accepted history", () => {
    const session = setupSession();
    const draft = draftPass(beginTurn(session.state));
    expect(() => endTurn(session, { ...draft, playerId: "stranger" })).toThrow(
      "active player",
    );
    expect(() => endTurn({ ...session, events: [] }, draft)).toThrow(
      "event log",
    );
    const next = pass(session);
    expect(() =>
      endTurn(
        { ...next, events: session.events },
        draftPass(beginTurn(next.state)),
      ),
    ).toThrow("event log");
  });

  it("preserves all accepted events and counters in JSON round trips", () => {
    let session = setupSession();
    session = endTurn(session, readyCard(session.state), noEffectEngine);
    session = pass(session, 3);
    const loaded: GameSession = JSON.parse(JSON.stringify(session));
    expect(loaded).toEqual(session);
    expect(pass(loaded)).toEqual(pass(session));
    expect(loaded.events.map((event) => event.eventSequence)).toEqual(
      Array.from({ length: loaded.events.length }, (_, index) => index),
    );
    expect(
      loaded.events.filter((event) => event.type === "TurnCommitted"),
    ).toHaveLength(4);
    expect(loaded.state.actionSequence).toBe(1);
    assertGameInvariants(loaded.state);
  });
});
