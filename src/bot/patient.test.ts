import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createGame } from "../game/setup";
import { getObservation } from "../game/visibility";
import { witnessedCards } from "../app/botObservation";
import { turnEngine } from "../game/turns";
import { editFixture, resolvedFixture } from "../test/standardFixtures";
import { setupSession, withBoard } from "../test/turnFixtures";
import { FACTIONS, REGION_IDS } from "../game/domain";
import type { GameSession } from "../game/events";
import { PatientBot, evaluatePatient, passingResult } from "./patient";
import { reconstructStandard } from "./observation";
import type { SearchRequest } from "./search";
import { passPlan, simulate } from "./simulation";
function request(session: GameSession, iterations = 64): SearchRequest {
  return {
    observation: getObservation(session.state, session.state.activePlayerId),
    memory: witnessedCards(session),
    budget: { iterations, seed: 2026 },
  };
}
function fixture(turn: number): SearchRequest {
  const input = JSON.parse(
    readFileSync(
      new URL(`./fixtures/patient-turn-${turn}.json`, import.meta.url),
      "utf8",
    ),
  );
  return { ...input, budget: { iterations: 128, seed: 2026 } };
}
function configured(session: GameSession) {
  return editFixture(session, (state) => {
    for (const p of Object.values(state.players)) {
      p.controller = "algorithmic";
      p.botStrategy = p.id === state.activePlayerId ? "patient" : "reference";
    }
  });
}
describe("patient reserve and response policy", () => {
  it("preserves its last Assemble after the reported turn-23 route change", () => {
    const req = fixture(24),
      state = reconstructStandard(req.observation, req.memory);
    expect(state.players[state.activePlayerId]!.hand).toHaveLength(1);
    expect(state.supply).toEqual({ scottish: 0, welsh: 0, english: 0 });
    expect(new PatientBot().search(req).plan.kind).toBe("pass");
  });
  it("uses a remaining card to fix the reported losing Invasion when opponents are spent", () => {
    const req = fixture(38),
      state = reconstructStandard(req.observation, req.memory);
    expect(passingResult(state)).toMatchObject({
      kind: "win",
      winner: "Bot 3",
      method: "invasion",
    });
    const result = new PatientBot().search(req);
    expect(result.plan.kind).toBe("card");
    expect(() => turnEngine.commitTurn(state, result.plan)).not.toThrow();
    expect(passingResult(simulate(state, result.plan))).toMatchObject({
      kind: "win",
      winner: "Panos",
    });
  });
  it("banks a guaranteed win rather than spending more once the other hands are empty", () => {
    const req = fixture(47),
      state = reconstructStandard(req.observation, req.memory);
    expect(passingResult(state)).toMatchObject({
      kind: "win",
      winner: "Panos",
    });
    expect(state.players.Panos!.hand.length).toBeGreaterThan(0);
    expect(new PatientBot().search(req).plan.kind).toBe("pass");
  });
  it("can wait on opening turns without losing legality or determinism", () => {
    const decisions = [
      "patient-opening-a",
      "patient-opening-b",
      "patient-opening-c",
    ].map((seed) => {
      const board = Object.fromEntries(
        REGION_IDS.map((id, index) => [
          id,
          index < 6
            ? { scottish: 2, welsh: 1, english: 1 }
            : { scottish: 0, welsh: 3, english: 1 },
        ]),
      );
      const session = configured(
          editFixture(
            withBoard(setupSession(3, "standard", seed), board),
            (state) => {
              for (const player of Object.values(state.players))
                for (const faction of FACTIONS) {
                  state.supply[faction] += player.court[faction];
                  player.court[faction] = 0;
                }
              state.players[state.activePlayerId]!.court.scottish = 2;
              state.supply.scottish -= 2;
              state.playerOrder
                .filter((id) => id !== state.activePlayerId)
                .forEach((id, index) => {
                  const faction = index === 0 ? "welsh" : "english";
                  state.players[id]!.court[faction] = 2;
                  state.supply[faction] -= 2;
                });
            },
          ),
        ),
        req = request(session);
      const first = new PatientBot().search(req),
        again = new PatientBot().search(req);
      expect(first.plan).toEqual(again.plan);
      expect(() =>
        turnEngine.commitTurn(session.state, first.plan),
      ).not.toThrow();
      expect(
        first.stats.horizonVisits + first.stats.terminalVisits,
      ).toBeGreaterThanOrEqual(first.stats.iterations);
      return first.plan.kind;
    });
    expect(decisions).toContain("pass");
  });
  it("takes immediate winning passes and intervenes to avoid a losing third instability", () => {
    const base = resolvedFixture(withBoard(setupSession(2), {}), {
      moray: "unstable",
      strathclyde: "unstable",
    });
    for (const winning of [true, false]) {
      const session = configured(
        editFixture(base, (state) => {
          state.consecutivePasses = 1;
          for (const p of Object.values(state.players))
            for (const f of FACTIONS) {
              state.supply[f] += p.court[f];
              p.court[f] = 0;
            }
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
      expect(new PatientBot().search(request(session)).plan.kind).toBe(
        winning ? "pass" : "card",
      );
    }
  });
  it("retains public profiles through setup, observation and reconstruction; rejects invalid setup", () => {
    const config = {
      seed: "patient-metadata",
      mode: "standard" as const,
      players: [
        {
          id: "patient",
          controller: "algorithmic" as const,
          botStrategy: "patient" as const,
        },
        {
          id: "original",
          controller: "algorithmic" as const,
          botStrategy: "reference" as const,
        },
      ],
    };
    const session = createGame(config),
      req = request(session);
    const rebuilt = reconstructStandard(req.observation, req.memory);
    expect(rebuilt.players.patient?.botStrategy).toBe("patient");
    expect(rebuilt.players.original?.botStrategy).toBe("reference");
    expect(() =>
      createGame({
        ...config,
        players: config.players.map((p) => ({ ...p, controller: "human" })),
      }),
    ).toThrow(/strategy/);
    expect(evaluatePatient(rebuilt).every(Number.isFinite)).toBe(true);
  });
});
