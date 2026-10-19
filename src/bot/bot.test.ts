import { describe, expect, it } from "vitest";
import { witnessedCards } from "../app/botObservation";
import { commitPlan } from "../app/session";
import { FACTIONS } from "../game/domain";
import type { GameSession } from "../game/events";
import { getObservation } from "../game/visibility";
import { turnEngine } from "../game/turns";
import { createRng } from "../game/rng";
import { setupSession, withBoard } from "../test/turnFixtures";
import { editFixture, resolvedFixture } from "../test/standardFixtures";
import { evaluate } from "./evaluation";
import { reconstructStandard } from "./observation";
import { StandardBot } from "./search";
import { passPlan, randomPlan, seededRandom, simulate } from "./simulation";

function request(session: GameSession, iterations = 128) {
  return {
    observation: getObservation(session.state, session.state.activePlayerId),
    memory: witnessedCards(session),
    budget: { iterations, seed: 123 },
  };
}

describe("Standard simulation and public memory", () => {
  it.each([2, 3])(
    "matches authoritative commits through complete %i-seat games",
    (count) => {
      const random = seededRandom(500 + count);
      for (let seed = 0; seed < 8; seed++) {
        let session = setupSession(
          count,
          "standard",
          `bot-differential-${seed}`,
        );
        while (session.state.phase === "turn") {
          const { state } = session;
          const recovered = reconstructStandard(
            request(session).observation,
            witnessedCards(session),
          );
          expect(recovered.players).toEqual(state.players);
          expect(recovered.regions).toEqual(state.regions);
          const plan = randomPlan(recovered, random);
          const simulated = simulate(state, plan);
          const result = turnEngine.commitTurn(state, plan);
          expect(simulated).toEqual(result.state);
          expect(state.turnSequence).toBe(session.state.turnSequence);
          session = {
            state: result.state,
            events: [...session.events, ...result.events],
          };
          expect(session.state.turnSequence).toBeLessThanOrEqual(
            count * (8 * count + 8),
          );
        }
        expect(session.state.result).not.toBeNull();
      }
    },
  );
  it("redacts setup secrets and detects missing or inconsistent public history", () => {
    const initial = setupSession();
    expect(witnessedCards(initial)).toEqual({ eventSequence: 0, plays: [] });
    let session = initial;
    const random = seededRandom(92);
    while (session.state.actionSequence < 3)
      session = commitPlan(session, randomPlan(session.state, random));
    const req = request(session);
    const payload = JSON.stringify(req);
    expect(payload).not.toContain(initial.state.initialSeed);
    for (const key of [
      "initialRngState",
      "rngState",
      "undealtCunningCards",
      "GameCreated",
    ])
      expect(payload).not.toContain(key);
    expect(() =>
      reconstructStandard(req.observation, { ...req.memory, plays: [] }),
    ).toThrow();
    expect(() =>
      witnessedCards({ ...session, events: session.events.slice(1) }),
    ).toThrow();
    const reconstructed = reconstructStandard(req.observation, req.memory);
    expect(reconstructed.initialSeed).toBe("bot-simulation");
  });
  it("has identical decisions when inaccessible setup secrets differ", () => {
    const session = setupSession(2);
    const other = {
      ...session,
      state: {
        ...session.state,
        initialSeed: "secret-other",
        initialRngState: createRng("secret-other"),
        rngState: createRng("secret-other"),
      },
    };
    expect(new StandardBot().search(request(session, 32)).plan).toEqual(
      new StandardBot().search(request(other, 32)).plan,
    );
    expect(() =>
      new StandardBot().search(request(setupSession(2, "advanced"))),
    ).toThrow(/Standard/);
  });
});

describe("multiplayer tree search", () => {
  it.each([2, 3])(
    "is reproducible and explores future decisions with %i players",
    (count) => {
      const session = setupSession(count);
      const before = JSON.stringify(session);
      const first = new StandardBot().search(request(session, 256));
      const second = new StandardBot().search(request(session, 256));
      expect(first.plan).toEqual(second.plan);
      expect(first.stats.iterations).toBe(256);
      expect(first.stats.horizon).toBe(count * 2 + 1);
      expect(first.stats.horizonVisits).toBeGreaterThan(0);
      expect(first.stats.rootChoices).toBeGreaterThan(1);
      expect(() =>
        turnEngine.commitTurn(session.state, first.plan),
      ).not.toThrow();
      expect(JSON.stringify(session)).toBe(before);
    },
  );
  it("reuses only a matching position and honors fixed iteration budgets", () => {
    const bot = new StandardBot();
    const session = setupSession(2);
    const first = bot.search(request(session, 16));
    const again = bot.search(request(session, 16));
    expect(first.stats.reusedVisits).toBe(0);
    expect(again.stats.reusedVisits).toBe(16);
    expect(
      bot.search(request(setupSession(2, "standard", "other"), 16)).stats
        .reusedVisits,
    ).toBe(0);
    expect(() =>
      bot.search({ ...request(session), budget: { iterations: 0, seed: 1 } }),
    ).toThrow(/budget/);
  });
});

function invasionFixture(winning: boolean) {
  let session = resolvedFixture(withBoard(setupSession(2), {}), {
    moray: "unstable",
    strathclyde: "unstable",
  });
  session = editFixture(session, (state) => {
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
  });
  return session;
}
describe("tactical regression positions", () => {
  it("takes an immediate Invasion win by passing and uses exact terminal utilities", () => {
    const session = invasionFixture(true);
    const result = new StandardBot().search(request(session));
    expect(result.plan.kind).toBe("pass");
    const next = simulate(session.state, result.plan);
    expect(next.result).toMatchObject({
      kind: "win",
      winner: session.state.activePlayerId,
      method: "invasion",
    });
    expect(
      evaluate(next)[next.playerOrder.indexOf(session.state.activePlayerId)],
    ).toBe(1);
  });
  it("does not pass into a losing third instability when intervention is possible", () => {
    const session = invasionFixture(false);
    expect(
      evaluate(simulate(session.state, passPlan(session.state)))[
        session.state.playerOrder.indexOf(session.state.activePlayerId)
      ],
    ).toBe(0);
    expect(new StandardBot().search(request(session)).plan.kind).toBe("card");
  });
  it("completes a set when Invasion is imminent", () => {
    let session = resolvedFixture(
      withBoard(setupSession(2), {
        lancaster: { scottish: 3, welsh: 1, english: 1 },
      }),
      { moray: "unstable", strathclyde: "unstable" },
    );
    session = editFixture(session, (state) => {
      for (const p of Object.values(state.players))
        for (const f of FACTIONS) {
          state.supply[f] += p.court[f];
          p.court[f] = 0;
        }
      const actor = state.players[state.activePlayerId]!;
      actor.court.welsh = 1;
      actor.court.english = 1;
      state.supply.welsh--;
      state.supply.english--;
    });
    const result = new StandardBot().search(request(session, 256));
    expect(result.plan.kind).toBe("card");
    if (result.plan.kind === "card")
      expect(result.plan.summon).toMatchObject({
        kind: "follower",
        faction: "scottish",
      });
  });
  it("locks a Coronation lead with a winning pass instead of spending another card", () => {
    const session = editFixture(
      resolvedFixture(setupSession(2), {
        moray: "scottish",
        strathclyde: "scottish",
        lancaster: "scottish",
        northumbria: "scottish",
        gwynedd: "welsh",
        warwick: "welsh",
        essex: "english",
      }),
      (state) => {
        state.consecutivePasses = 1;
        for (const p of Object.values(state.players))
          for (const f of FACTIONS) {
            state.supply[f] += p.court[f];
            p.court[f] = 0;
          }
        state.players[state.activePlayerId]!.court.scottish = 2;
        state.supply.scottish -= 2;
      },
    );
    const result = new StandardBot().search(request(session));
    expect(result.plan.kind).toBe("pass");
    expect(simulate(session.state, result.plan).result).toMatchObject({
      method: "coronation",
      kind: "win",
      winner: session.state.activePlayerId,
    });
  });
  it("uses Negotiate to postpone a losing struggle when it is the last card", () => {
    let session = resolvedFixture(
      withBoard(setupSession(2), {
        northumbria: { scottish: 3, welsh: 0, english: 0 },
      }),
      { moray: "unstable", strathclyde: "unstable" },
    );
    session = editFixture(session, (state) => {
      state.consecutivePasses = 1;
      state.regionCards = state.regionCards.map((card, index) => ({
        ...card,
        regionId: (
          [
            "moray",
            "strathclyde",
            "lancaster",
            "northumbria",
            "gwynedd",
            "warwick",
            "essex",
            "devon",
          ] as const
        )[index]!,
      }));
      const actor = state.players[state.activePlayerId]!;
      actor.discards = actor.hand.filter((c) => c.type !== "negotiate");
      actor.hand = actor.hand.filter((c) => c.type === "negotiate");
      state.actionSequence = 7;
      state.turnSequence = 7;
      state.eventSequence = 7;
      actor.lastActionSequence = 7;
      for (const p of Object.values(state.players))
        for (const f of FACTIONS) {
          state.supply[f] += p.court[f];
          p.court[f] = 0;
        }
      const other =
        state.players[state.playerOrder.find((id) => id !== actor.id)!]!;
      for (const f of FACTIONS) {
        other.court[f] = 1;
        state.supply[f]--;
      }
    });
    const state = session.state;
    // Synthetic conserved tactical position; explicitly supply its public plays.
    const memory = {
      eventSequence: 7,
      plays: state.players[state.activePlayerId]!.discards.map((card) => ({
        playerId: state.activePlayerId,
        card,
      })),
    };
    const result = new StandardBot().search({
      observation: getObservation(state, state.activePlayerId),
      memory,
      budget: { iterations: 256, seed: 123 },
    });
    expect(result.plan.kind).toBe("card");
    const after = simulate(state, result.plan);
    expect(after.regionCards.find((c) => c.slot === 3)?.regionId).toBe(
      "northumbria",
    );
  });
  it("shares a real drawn game's utility only among its contenders", () => {
    const session = editFixture(invasionFixture(true), (state) => {
      for (const p of Object.values(state.players))
        for (const f of FACTIONS) {
          state.supply[f] += p.court[f];
          p.court[f] = 0;
        }
    });
    const next = simulate(session.state, passPlan(session.state));
    expect(next.result?.kind).toBe("draw");
    expect(evaluate(next)).toEqual([0.5, 0.5]);
  });
});
