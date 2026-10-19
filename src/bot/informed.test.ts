import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { witnessedCards } from "../app/botObservation";
import { FACTIONS } from "../game/domain";
import type { GameSession } from "../game/events";
import { turnEngine } from "../game/turns";
import { getObservation } from "../game/visibility";
import { editFixture, resolvedFixture } from "../test/standardFixtures";
import { setupSession, withBoard } from "../test/turnFixtures";
import { InformedBot, evaluateInformed } from "./informed";
import { reconstructStandard } from "./observation";
import { passingResult } from "./patient";
import type { SearchRequest } from "./search";
import { passPlan, simulate } from "./simulation";

function request(session: GameSession, iterations = 64): SearchRequest {
  return {
    observation: getObservation(session.state, session.state.activePlayerId),
    memory: witnessedCards(session),
    budget: { iterations, seed: 2026 },
  };
}
function informedSeat(session: GameSession): GameSession {
  return editFixture(session, (state) => {
    for (const p of Object.values(state.players)) {
      p.controller = "algorithmic";
      p.botStrategy = p.id === state.activePlayerId ? "informed" : "patient";
    }
  });
}
/** Patient's recorded public positions, observed by an Informed seat instead. */
function fixture(turn: number): SearchRequest {
  const input = JSON.parse(
    readFileSync(
      new URL(`./fixtures/patient-turn-${turn}.json`, import.meta.url),
      "utf8",
    ),
  ) as SearchRequest;
  const players = input.observation.players.map((p) =>
    p.id === input.observation.viewer ? { ...p, botStrategy: "informed" } : p,
  );
  return {
    ...input,
    observation: { ...input.observation, players },
    budget: { iterations: 128, seed: 2026 },
  } as SearchRequest;
}
function clearCourts(state: Parameters<Parameters<typeof editFixture>[1]>[0]) {
  for (const p of Object.values(state.players))
    for (const f of FACTIONS) {
      state.supply[f] += p.court[f];
      p.court[f] = 0;
    }
}

describe("informed strategy", () => {
  it(
    "is deterministic, legal and reports search statistics",
    { timeout: 60000 },
    () => {
      for (const count of [2, 3]) {
        const session = informedSeat(setupSession(count));
        const first = new InformedBot().search(request(session, 96));
        const again = new InformedBot().search(request(session, 96));
        expect(first.plan).toEqual(again.plan);
        expect(first.stats.iterations).toBe(96);
        expect(first.stats.rootChoices).toBeGreaterThan(1);
        expect(() =>
          turnEngine.commitTurn(session.state, first.plan),
        ).not.toThrow();
        expect(evaluateInformed(session.state).every(Number.isFinite)).toBe(
          true,
        );
      }
    },
  );
  it("proposes pass first and never evaluates a position below the terminal floor", () => {
    const session = informedSeat(setupSession(3));
    const values = evaluateInformed(session.state);
    expect(values).toHaveLength(3);
    for (const v of values) expect(v).toBeGreaterThan(0);
    const sum = values.reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThan(1.05);
  });
  it("holds its last Assemble with an empty supply (recorded turn 24)", () => {
    const req = fixture(24);
    const state = reconstructStandard(req.observation, req.memory);
    expect(state.players[state.activePlayerId]!.hand).toHaveLength(1);
    expect(new InformedBot().search(req).plan.kind).toBe("pass");
  });
  it("repairs a losing Invasion route once opponents are spent (recorded turn 38)", () => {
    const req = fixture(38);
    const state = reconstructStandard(req.observation, req.memory);
    expect(passingResult(state)).toMatchObject({
      kind: "win",
      winner: "Bot 3",
    });
    const result = new InformedBot().search(req);
    expect(result.plan.kind).toBe("card");
    expect(() => turnEngine.commitTurn(state, result.plan)).not.toThrow();
    expect(passingResult(simulate(state, result.plan))).toMatchObject({
      kind: "win",
      winner: "Panos",
    });
  });
  it("banks a proven win instead of spending another card (recorded turn 47)", () => {
    const req = fixture(47);
    const state = reconstructStandard(req.observation, req.memory);
    expect(passingResult(state)).toMatchObject({
      kind: "win",
      winner: "Panos",
    });
    expect(new InformedBot().search(req).plan.kind).toBe("pass");
  });
  it("takes an immediate winning pass and intervenes against a losing third instability", () => {
    const base = resolvedFixture(withBoard(setupSession(2), {}), {
      moray: "unstable",
      strathclyde: "unstable",
    });
    for (const winning of [true, false]) {
      const session = informedSeat(
        editFixture(base, (state) => {
          state.consecutivePasses = 1;
          clearCourts(state);
          const leader = winning
            ? state.activePlayerId
            : state.playerOrder.find((id) => id !== state.activePlayerId)!;
          for (const f of FACTIONS) {
            state.players[leader]!.court[f] = 1;
            state.supply[f]--;
          }
        }),
      );
      expect(
        simulate(session.state, passPlan(session.state)).result,
      ).toMatchObject({ kind: "win" });
      expect(new InformedBot().search(request(session)).plan.kind).toBe(
        winning ? "pass" : "card",
      );
    }
  });
  it(
    "finds a two-card winning sequence when opponents cannot respond",
    { timeout: 60000 },
    () => {
      // Opponent leads 2-1 on Scottish, which controls the board. The actor needs
      // two actions (one card is not enough) to overtake before the end.
      const session = informedSeat(
        editFixture(
          resolvedFixture(
            withBoard(setupSession(2), {
              lancaster: { scottish: 2, welsh: 0, english: 0 },
              warwick: { scottish: 2, welsh: 0, english: 0 },
            }),
            {
              moray: "scottish",
              strathclyde: "scottish",
              northumbria: "scottish",
              gwynedd: "welsh",
              essex: "welsh",
              devon: "english",
            },
          ),
          (state) => {
            clearCourts(state);
            const actor = state.players[state.activePlayerId]!;
            const other =
              state.players[state.playerOrder.find((id) => id !== actor.id)!]!;
            other.court.scottish = 2;
            actor.court.scottish = 1;
            state.supply.scottish -= 3;
            // Opponent has spent everything; the actor holds two Assembles only.
            other.discards = [...other.hand];
            other.hand = [];
            actor.discards = actor.hand.filter((c) => c.type !== "assemble");
            actor.hand = actor.hand.filter((c) => c.type === "assemble");
            const played = other.discards.length + actor.discards.length;
            state.actionSequence = played;
            state.turnSequence = played;
            state.eventSequence = played;
            other.lastActionSequence = other.discards.length;
            actor.lastActionSequence = played;
          },
        ),
      );
      const state = session.state;
      const memory = {
        eventSequence: state.eventSequence,
        plays: state.playerOrder.flatMap((id) =>
          state.players[id]!.discards.map((card) => ({ playerId: id, card })),
        ),
      };
      expect(passingResult(state)).toMatchObject({ kind: "win" });
      expect((passingResult(state) as { winner: string }).winner).not.toBe(
        state.activePlayerId,
      );
      const bot = new InformedBot();
      const first = bot.search({
        observation: getObservation(state, state.activePlayerId),
        memory,
        budget: { iterations: 64, seed: 7 },
      });
      expect(first.plan.kind).toBe("card");
      let next = turnEngine.commitTurn(state, first.plan).state;
      // Opponent must pass; then the actor plays again.
      next = turnEngine.commitTurn(next, passPlan(next)).state;
      const second = bot.search({
        observation: getObservation(next, next.activePlayerId),
        memory: {
          eventSequence: next.eventSequence,
          plays: next.playerOrder.flatMap((id) =>
            next.players[id]!.discards.map((card) => ({ playerId: id, card })),
          ),
        },
        budget: { iterations: 64, seed: 7 },
      });
      const after = turnEngine.commitTurn(next, second.plan).state;
      expect(passingResult(after)).toMatchObject({
        kind: "win",
        winner: state.activePlayerId,
      });
    },
  );
});
