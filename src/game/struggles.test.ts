import { describe, expect, it } from "vitest";
import { beginTurn, draftPass } from "../app/draft";
import { choosePlot, endTurn } from "../app/session";
import { followers, pass, setupSession, withBoard } from "../test/turnFixtures";
import type { Mutable } from "../test/turnFixtures";
import { FACTIONS, REGION_IDS } from "./domain";
import type { FactionCounts, GameState, RegionId } from "./domain";
import type { GameSession } from "./events";
import { assertGameInvariants } from "./invariants";
import { copyChoice } from "./plans";
import { determineControl, resolveNextStruggle } from "./struggles";
import { turnEngine } from "./turns";
import { findPlotHolder, scoreGame } from "./scoring";

describe("power struggle classification", () => {
  it.each([
    { counts: followers(2, 1, 1), faction: "scottish" },
    { counts: followers(1, 2, 1), faction: "welsh" },
    { counts: followers(1, 1, 2), faction: "english" },
    { counts: followers(1), faction: "scottish" },
  ] as const)(
    "awards strict plurality in $counts to $faction",
    ({ counts, faction }) => {
      expect(determineControl(counts, 5)).toEqual({
        kind: "faction",
        faction,
        struggleIndex: 5,
      });
    },
  );

  it.each([
    followers(2, 2),
    followers(1, 1, 1),
    followers(),
    followers(0, 2, 2),
  ])("makes ties and empty regions unstable: %j", (counts) => {
    expect(determineControl(counts, 3)).toEqual({
      kind: "unstable",
      struggleIndex: 3,
    });
  });

  it("does not resolve a struggle before every player passes", () => {
    const session = setupSession();
    expect(() =>
      resolveNextStruggle(session.state, session.state.activePlayerId),
    ).toThrow("all players");
  });
});

describe("power struggle commit events", () => {
  it("returns all regional followers, consumes the winning disc, and logs 2–1–1 plurality", () => {
    const base = setupSession();
    const first = base.state.regionCards[0];
    if (!first) throw new Error("fixture");
    const session = withBoard(base, { [first.regionId]: followers(2, 1, 1) });
    const result = pass(session, 3);
    expect(result.state.regions[first.regionId].control).toEqual({
      kind: "faction",
      faction: "scottish",
      struggleIndex: 1,
    });
    for (const faction of FACTIONS)
      expect(result.state.supply[faction]).toBe(
        session.state.supply[faction] +
          session.state.regions[first.regionId].followers[faction],
      );
    expect(result.state.controlDiscsInSupply).toEqual(followers(7, 8, 8));
    expect(result.state.instabilityDiscsInFrance).toBe(3);
    expect(result.events.at(-1)).toMatchObject({
      type: "PowerStruggleResolved",
      eventSequence: 4,
      turnSequence: 3,
      actionSequence: 0,
      regionId: first.regionId,
      struggleIndex: 1,
      returnedToSupply: followers(2, 1, 1),
    });
    assertGameInvariants(result.state);
  });

  it("resolves slot order after cards have been rearranged, independently of geography", () => {
    const base = copyChoice(setupSession()) as Mutable<GameSession>;
    const first = base.state.regionCards[0];
    const devon = base.state.regionCards.find(
      (card) => card.regionId === "devon",
    );
    if (!first || !devon || base.events[0]?.type !== "GameCreated")
      throw new Error("fixture");
    const originalFirst = first.regionId;
    first.regionId = "devon";
    devon.regionId = originalFirst;
    base.events[0].state = base.state;
    const result = pass(withBoard(base, { devon: followers(0, 1) }), 3);
    expect(result.state.regions.devon.control).toEqual({
      kind: "faction",
      faction: "welsh",
      struggleIndex: 1,
    });
    expect(result.state.regionCards[0]).toMatchObject({
      slot: 1,
      regionId: "devon",
      faceUp: false,
    });
  });

  it("retains a personal negotiation marker when its card resolves", () => {
    const base = copyChoice(setupSession()) as Mutable<GameSession>;
    const card = base.state.regionCards[0];
    const owner = base.state.players.p1;
    if (!card || !owner || base.events[0]?.type !== "GameCreated")
      throw new Error("fixture");
    card.negotiationDiscOwner = owner.id;
    owner.negotiationDiscLocation = card.regionId;
    base.events[0].state = base.state;
    const result = pass(base, 3);
    expect(result.state.regionCards[0]?.negotiationDiscOwner).toBe(owner.id);
    expect(result.state.players.p1?.negotiationDiscLocation).toBe(
      card.regionId,
    );
    assertGameInvariants(result.state);
  });
});

describe.each([2, 3])("%i-player ending triggers", (count) => {
  it("halts on the third instability immediately, leaving five regions unresolved", () => {
    const session = withBoard(setupSession(count), {});
    const pending = draftPass(beginTurn(pass(session, count * 3 - 1).state));
    const beforeLast = pass(session, count * 3 - 1);
    const next = endTurn(beforeLast, pending);
    expect(next.state.phase).toBe("finished");
    expect(next.state.ending).toBe("invasion");
    expect(next.state.result).toMatchObject({
      kind: "draw",
      method: "invasion",
      contenders: session.state.playerOrder,
    });
    expect(next.state.instabilityDiscsInFrance).toBe(0);
    expect(next.state.regionCards.filter((card) => card.faceUp)).toHaveLength(
      5,
    );
    expect(next.events.slice(-4).map((event) => event.type)).toEqual([
      "TurnCommitted",
      "PowerStruggleResolved",
      "GameEndTriggered",
      "GameFinished",
    ]);
    expect(next.events.at(-2)).toMatchObject({
      type: "GameEndTriggered",
      method: "invasion",
      struggleIndex: 3,
    });
    expect(next.events.at(-1)).toMatchObject({
      type: "GameFinished",
      result: next.state.result,
    });
    expect(() => beginTurn(next.state)).toThrow("ended");
    expect(() => endTurn(next, pending)).toThrow("ended");
    assertGameInvariants(next.state);
  });

  it("halts after the eighth region as coronation and records each faction's latest slot", () => {
    const board = Object.fromEntries(
      REGION_IDS.map((id) => [id, followers(1)]),
    ) as Record<RegionId, FactionCounts>;
    let session = withBoard(setupSession(count), board);
    for (let slot = 1; slot <= 8; slot += 1) {
      session = pass(session, count);
      const card = session.state.regionCards[slot - 1];
      if (!card) throw new Error("fixture");
      expect(session.state.regions[card.regionId].control).toEqual({
        kind: "faction",
        faction: "scottish",
        struggleIndex: slot,
      });
      expect(
        session.state.regionCards.filter((candidate) => !candidate.faceUp),
      ).toHaveLength(slot);
      assertGameInvariants(session.state);
    }
    expect(session.state.phase).toBe("finished");
    expect(session.state.ending).toBe("coronation");
    expect(session.state.controlDiscsInSupply.scottish).toBe(0);
    expect(session.state.result?.method).toBe("coronation");
    expect(session.state.result?.details.cases).toHaveLength(2);
    expect(session.events.at(-2)).toMatchObject({
      type: "GameEndTriggered",
      method: "coronation",
      struggleIndex: 8,
    });
    expect(() =>
      turnEngine.commitTurn(session.state, {
        kind: "pass",
        playerId: session.state.activePlayerId,
        baseTurnSequence: session.state.turnSequence,
      }),
    ).toThrow("ended");
  });

  it("gives invasion priority when the third instability occurs on the eighth struggle", () => {
    const base = setupSession(count);
    const board = Object.fromEntries(
      base.state.regionCards.map((card, index) => [
        card.regionId,
        index < 2 || index === 7 ? followers() : followers(0, 1),
      ]),
    ) as Record<RegionId, FactionCounts>;
    const result = pass(withBoard(base, board), count * 8);
    expect(result.state.regionCards.every((card) => !card.faceUp)).toBe(true);
    expect(result.state.ending).toBe("invasion");
    expect(result.state.phase).toBe("finished");
    expect(result.state.result?.method).toBe("invasion");
    expect(result.events.at(-2)).toMatchObject({
      method: "invasion",
      struggleIndex: 8,
    });
  });
});

describe("terminal state invariants", () => {
  it("rejects turns after a finished result", () => {
    const ended = pass(withBoard(setupSession(), {}), 9).state;
    // A no-action Invasion has zero complete sets in every two-follower court.
    const finished: GameState = {
      ...ended,
      phase: "finished",
      result: scoreGame(ended),
    };
    assertGameInvariants(finished);
    expect(() =>
      turnEngine.commitTurn(finished, {
        kind: "pass",
        playerId: finished.activePlayerId,
        baseTurnSequence: finished.turnSequence,
      }),
    ).toThrow("ended");
  });

  it("rejects mismatched ending metadata and premature scoring", () => {
    const ended = copyChoice(
      pass(withBoard(setupSession(), {}), 9).state,
    ) as Mutable<GameState>;
    ended.ending = "coronation";
    expect(() => assertGameInvariants(ended)).toThrow("Ending trigger");
    const early = copyChoice(setupSession().state) as Mutable<GameState>;
    early.phase = "scoring";
    expect(() => assertGameInvariants(early)).toThrow("Terminal phase");
  });
});

describe.each([2, 3])("%i-player seeded pass-only progression", (count) => {
  it.each(["standard", "advanced"] as const)(
    "halts deterministically in %s mode for 16 seeds",
    (mode) => {
      function run(seed: string): GameSession {
        let session = setupSession(count, mode, seed);
        while (
          session.state.phase === "turn" &&
          session.state.turnSequence < count * 8
        ) {
          session = pass(session);
          assertGameInvariants(session.state);
        }
        const holder = findPlotHolder(session.state);
        expect(session.state.phase).toBe(
          holder === null ? "finished" : "plot-choice",
        );
        if (holder !== null) {
          session = choosePlot(session, {
            playerId: holder.playerId,
            faction: "scottish",
            baseEventSequence: session.state.eventSequence,
          });
        }
        expect(session.state.phase).toBe("finished");
        expect(session.state.result?.method).toBe(session.state.ending);
        expect(
          session.events.filter((event) => event.type === "GameFinished"),
        ).toHaveLength(1);
        expect(session.state.ending).not.toBeNull();
        expect(session.state.actionSequence).toBe(0);
        expect(
          session.events.filter((event) => event.type === "GameEndTriggered"),
        ).toHaveLength(1);
        return session;
      }
      for (let index = 0; index < 16; index += 1) {
        const seed = `pass-regression-${index}`;
        expect(run(seed)).toEqual(run(seed));
      }
    },
  );
});
