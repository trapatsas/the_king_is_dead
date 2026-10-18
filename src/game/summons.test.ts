import { describe, expect, it } from "vitest";
import { beginTurn, draftCard, draftEffect, draftSummon } from "../app/draft";
import { endTurn } from "../app/session";
import {
  actionCardId,
  fixtureEngine,
  followers,
  noEffectEngine,
  pass,
  readyCard,
  setupSession,
  withBoard,
} from "../test/turnFixtures";
import type { Mutable } from "../test/turnFixtures";
import { totalFollowers } from "./domain";
import type { EffectPlan, FollowerTransfer, SummonChoice } from "./turnTypes";
import { applyTransfers } from "./effects/common";
import { assertGameInvariants } from "./invariants";
import { copyChoice } from "./plans";
import { applySummon, enumerateSummonChoices } from "./summons";

const zero: SummonChoice = {
  kind: "zero",
  count: 0,
  reason: "no-followers-in-uncontrolled-regions",
};
const move: FollowerTransfer = {
  kind: "transfer",
  from: { kind: "supply" },
  to: { kind: "region", regionId: "moray" },
  faction: "scottish",
  count: 1,
};
const effect = (operations: readonly FollowerTransfer[]): EffectPlan => ({
  kind: "effect",
  effectiveCard: "assemble",
  tier: 1,
  operations,
});

describe("mandatory post-effect summoning", () => {
  it("offers every available region/faction once, and never offers zero alongside a follower", () => {
    const session = withBoard(setupSession(), {
      moray: followers(2, 1),
      devon: followers(0, 0, 3),
    });
    expect(enumerateSummonChoices(session.state)).toEqual([
      { kind: "follower", count: 1, regionId: "moray", faction: "scottish" },
      { kind: "follower", count: 1, regionId: "moray", faction: "welsh" },
      { kind: "follower", count: 1, regionId: "devon", faction: "english" },
    ]);
    expect(() =>
      applySummon(session.state, session.state.activePlayerId, zero),
    ).toThrow("exactly one");
  });

  it("checks after an effect places a follower, even when the entire board started empty", () => {
    const session = withBoard(setupSession(), {});
    const engine = fixtureEngine(() => [effect([move])]);
    expect(enumerateSummonChoices(session.state)).toEqual([zero]);
    const draft = draftEffect(
      draftCard(beginTurn(session.state), actionCardId(session.state)),
      effect([move]),
    );
    expect(engine.previewTurn(session.state, draft).summonChoices).toEqual([
      { kind: "follower", count: 1, regionId: "moray", faction: "scottish" },
    ]);
    expect(() => endTurn(session, draftSummon(draft, zero), engine)).toThrow(
      "post-effect summon",
    );
    const next = endTurn(session, readyCard(session.state, engine), engine);
    expect(next.state.regions.moray.followers).toEqual(followers());
    expect(
      next.state.players[session.state.activePlayerId]?.court.scottish,
    ).toBe(
      (session.state.players[session.state.activePlayerId]?.court.scottish ??
        0) + 1,
    );
    expect(next.state.supply.scottish).toBe(session.state.supply.scottish - 1);
    assertGameInvariants(next.state);
  });

  it("records explicit zero and its reason after an effect removes the final board follower", () => {
    const session = withBoard(setupSession(), { moray: followers(1) });
    const removal: FollowerTransfer = { ...move, from: move.to, to: move.from };
    const engine = fixtureEngine(() => [effect([removal])]);
    const draft = readyCard(session.state, engine);
    const next = endTurn(session, draft, engine);
    expect(next.state.players[session.state.activePlayerId]?.court).toEqual(
      session.state.players[session.state.activePlayerId]?.court,
    );
    expect(next.state.supply.scottish).toBe(session.state.supply.scottish + 1);
    expect(next.events.at(-1)).toMatchObject({
      type: "TurnCommitted",
      plan: { effect: { operations: [removal] }, summon: zero },
    });
    assertGameInvariants(next.state);
  });

  it("still requires a summon for a card whose effect is explicitly empty", () => {
    const session = withBoard(setupSession(), { devon: followers(0, 1) });
    const next = endTurn(session, readyCard(session.state), noEffectEngine);
    expect(next.state.regions.devon.followers).toEqual(followers());
    expect(
      totalFollowers(
        next.state.players[session.state.activePlayerId]?.court ?? followers(),
      ),
    ).toBe(3);
    expect(next.events.at(-1)).toMatchObject({
      plan: { effect: { kind: "no-effect" }, summon: { kind: "follower" } },
    });
  });

  it("allows zero only when every unresolved region is empty, even with a stocked supply", () => {
    const session = withBoard(setupSession(), {});
    expect(totalFollowers(session.state.supply)).toBeGreaterThan(0);
    expect(enumerateSummonChoices(session.state)).toEqual([zero]);
    const next = endTurn(session, readyCard(session.state), noEffectEngine);
    expect(next.state.players[session.state.activePlayerId]?.court).toEqual(
      session.state.players[session.state.activePlayerId]?.court,
    );
    expect(next.state.supply).toEqual(session.state.supply);
    expect(next.events.at(-1)).toMatchObject({ plan: { summon: zero } });
  });

  it("permits summoning from an unrelated region after the effect", () => {
    const session = withBoard(setupSession(), { devon: followers(0, 0, 1) });
    const engine = fixtureEngine(() => [effect([move])]);
    const draft = readyCard(session.state, engine, (choices) =>
      choices.find(
        (choice) => choice.kind === "follower" && choice.regionId === "devon",
      ),
    );
    const next = endTurn(session, draft, engine);
    expect(next.state.regions.moray.followers).toEqual(followers(1));
    expect(next.state.regions.devon.followers).toEqual(followers());
  });

  it("rejects a follower which was present before the effect but has been removed", () => {
    const session = withBoard(setupSession(), {
      moray: followers(1),
      devon: followers(0, 1),
    });
    const removal: FollowerTransfer = { ...move, from: move.to, to: move.from };
    const engine = fixtureEngine(() => [effect([removal])]);
    const draft = draftSummon(readyCard(session.state, engine), {
      kind: "follower",
      count: 1,
      regionId: "moray",
      faction: "scottish",
    });
    expect(() => endTurn(session, draft, engine)).toThrow("post-effect summon");
  });

  it.each(["supply", "multiple", "wrong-reason"])(
    "rejects malformed summon %s",
    (kind) => {
      const { state } = withBoard(setupSession(), {});
      const choice: Mutable<SummonChoice> = copyChoice(zero);
      if (kind === "supply") Reflect.set(choice, "kind", "supply");
      if (kind === "multiple") Reflect.set(choice, "count", 2);
      if (kind === "wrong-reason")
        Reflect.set(choice, "reason", "player-declined");
      expect(() => applySummon(state, state.activePlayerId, choice)).toThrow(
        "exactly one",
      );
    },
  );

  it("never summons from a resolved region and returns no choices after an ending", () => {
    const base = setupSession();
    const first = base.state.regionCards[0];
    if (!first) throw new Error("fixture");
    const session = pass(
      withBoard(base, {
        [first.regionId]: followers(1),
        devon: followers(0, 1),
      }),
      3,
    );
    expect(
      enumerateSummonChoices(session.state).some(
        (choice) =>
          choice.kind === "follower" && choice.regionId === first.regionId,
      ),
    ).toBe(false);
    expect(() =>
      applySummon(session.state, session.state.activePlayerId, {
        kind: "follower",
        count: 1,
        regionId: first.regionId,
        faction: "scottish",
      }),
    ).toThrow("exactly one");
    const ended = pass(withBoard(setupSession(), {}), 9);
    expect(ended.state.phase).toBe("finished");
    expect(enumerateSummonChoices(ended.state)).toEqual([]);
    expect(() =>
      applySummon(ended.state, ended.state.activePlayerId, zero),
    ).toThrow("exactly one");
  });
});

describe("ordered transfer execution", () => {
  it("makes followers returned earlier available to later placement in the same action", () => {
    const { state } = withBoard(setupSession(), { moray: followers(1) });
    const operations: FollowerTransfer[] = [
      { ...move, from: move.to, to: move.from },
      { ...move, count: state.supply.scottish + 1 },
    ];
    const next = applyTransfers(state, operations);
    expect(next.supply.scottish).toBe(0);
    expect(next.regions.moray.followers.scottish).toBe(
      state.supply.scottish + 1,
    );
    expect(() => applyTransfers(state, [...operations].reverse())).toThrow(
      "Not enough",
    );
    assertGameInvariants(next);
  });

  it.each(["faction", "unstable"] as const)(
    "blocks transfers both into and out of a %s region",
    (kind) => {
      const base = setupSession();
      const card = base.state.regionCards[0];
      if (!card) throw new Error("fixture");
      const session = pass(
        withBoard(base, {
          [card.regionId]: kind === "faction" ? followers(1) : followers(),
        }),
        3,
      );
      expect(session.state.regions[card.regionId].control.kind).toBe(kind);
      const to: FollowerTransfer = {
        ...move,
        to: { kind: "region", regionId: card.regionId },
      };
      expect(() => applyTransfers(session.state, [to])).toThrow(
        "resolved region",
      );
      expect(() =>
        applyTransfers(session.state, [{ ...to, from: to.to, to: to.from }]),
      ).toThrow("resolved region");
    },
  );

  it.each([0, -1, 0.5, Infinity, NaN])(
    "rejects invalid transfer count %s",
    (count) => {
      expect(() =>
        applyTransfers(setupSession().state, [{ ...move, count }]),
      ).toThrow("positive integer");
    },
  );

  it("rejects transferring to the same location", () => {
    expect(() =>
      applyTransfers(setupSession().state, [{ ...move, to: move.from }]),
    ).toThrow("must differ");
  });
});
