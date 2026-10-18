import { describe, expect, it } from "vitest";
import { beginTurn, draftPass } from "../app/draft";
import { choosePlot, endTurn } from "../app/session";
import { editFixture, play } from "../test/standardFixtures";
import { followers, pass, setupSession, withBoard } from "../test/turnFixtures";
import type { Mutable } from "../test/turnFixtures";
import { FACTIONS, REGION_IDS } from "./domain";
import type { FactionCounts, GameState, RegionId } from "./domain";
import type { GameSession } from "./events";
import { advanceEndgame, resolvePlotChoice } from "./endgame";
import { assertGameInvariants } from "./invariants";
import { copyChoice } from "./plans";
import { findPlotHolder, scoreGame } from "./scoring";
import type { PlotChoice } from "./turnTypes";

function courts(
  session: GameSession,
  values: Readonly<Record<string, FactionCounts>>,
): GameSession {
  return editFixture(session, (state) => {
    for (const [id, court] of Object.entries(values)) {
      const player = state.players[id];
      if (!player) throw new Error("Invalid fixture player");
      for (const faction of FACTIONS)
        state.supply[faction] += player.court[faction] - court[faction];
      player.court = { ...court };
    }
  });
}

function toEnding(session: GameSession): GameSession {
  let next = session;
  for (let index = 0; next.state.phase === "turn" && index < 24; index += 1)
    next = pass(next);
  if (next.state.phase === "turn") throw new Error("Fixture did not end");
  return next;
}

function advancedFixture(count: number, dealt = true): GameSession {
  for (let index = 0; index < 100; index += 1) {
    const candidate = setupSession(count, "advanced", `endgame-plot-${index}`);
    if ((findPlotHolder(candidate.state) !== null) === dealt) return candidate;
  }
  throw new Error("Could not find deterministic Plot fixture");
}

function plotInvasion(count = 3): GameSession {
  let session = withBoard(advancedFixture(count), {});
  const holder = findPlotHolder(session.state);
  if (!holder) throw new Error("fixture");
  session = courts(
    session,
    Object.fromEntries(
      session.state.playerOrder.map((id) => [
        id,
        id === holder.playerId ? followers(1, 1) : followers(2),
      ]),
    ),
  );
  return toEnding(session);
}

describe.each([2, 3])("%i-player final scoring integration", (count) => {
  it("finishes and logs a no-action Invasion draw atomically with its last pass", () => {
    const session = withBoard(setupSession(count), {});
    const beforeLast = pass(session, count * 3 - 1);
    const before = JSON.stringify(beforeLast);
    const completed = endTurn(
      beforeLast,
      draftPass(beginTurn(beforeLast.state)),
    );
    expect(completed.state.phase).toBe("finished");
    expect(completed.state.result).toMatchObject({
      kind: "draw",
      contenders: [...session.state.playerOrder].sort(),
      method: "invasion",
    });
    expect(completed.events.slice(-4).map((event) => event.type)).toEqual([
      "TurnCommitted",
      "PowerStruggleResolved",
      "GameEndTriggered",
      "GameFinished",
    ]);
    expect(completed.events.at(-1)).toMatchObject({
      result: completed.state.result,
      turnSequence: count * 3,
      actionSequence: 0,
      eventSequence: completed.state.eventSequence,
    });
    expect(JSON.stringify(beforeLast)).toBe(before);
    expect(completed.state.rngState).toEqual(session.state.rngState);
    expect(() =>
      advanceEndgame(completed.state, completed.state.activePlayerId),
    ).toThrow("new terminal trigger");
  });

  it("scores after real card play without changing final action timing during passes", () => {
    let session = withBoard(setupSession(count), {});
    const actor = session.state.activePlayerId;
    session = courts(
      session,
      Object.fromEntries(
        session.state.playerOrder.map((id) => [
          id,
          id === actor ? followers(1, 1) : followers(2),
        ]),
      ),
    );
    session = play(
      session,
      "assemble",
      (options) =>
        options.find((plan) =>
          plan.operations.every(
            (operation) =>
              operation.kind === "transfer" &&
              operation.to.kind === "region" &&
              operation.to.regionId === "devon",
          ),
        ),
      (options) =>
        options.find(
          (choice) =>
            choice.kind === "follower" &&
            choice.regionId === "devon" &&
            choice.faction === "english",
        ),
    );
    expect(session.state.players[actor]?.court).toEqual(followers(1, 1, 1));
    const finished = toEnding(session);
    expect(finished.state.result).toMatchObject({
      kind: "win",
      winner: actor,
      method: "invasion",
    });
    expect(finished.state.players[actor]?.lastActionSequence).toBe(1);
    expect(finished.state.players[actor]?.hand).toHaveLength(7);
    expect(finished.state.actionSequence).toBe(1);
    expect(finished.state.rngState).toEqual(session.state.rngState);
  });

  it("rewards the earlier final action even when both tied players have cards in hand", () => {
    let session = withBoard(setupSession(count), {});
    const first = session.state.activePlayerId;
    const second =
      session.state.playerOrder[
        (session.state.playerOrder.indexOf(first) + 1) % count
      ];
    if (!second) throw new Error("fixture");
    session = courts(
      session,
      Object.fromEntries(
        session.state.playerOrder.map((id) => [
          id,
          id === first || id === second ? followers(1, 1) : followers(0, 0, 2),
        ]),
      ),
    );
    session = withBoard(
      session,
      Object.fromEntries(REGION_IDS.map((id) => [id, followers(1)])),
    );
    session = play(session, "negotiate");
    session = play(session, "negotiate");
    const finished = toEnding(session);
    expect(finished.state.result).toMatchObject({
      kind: "win",
      winner: first,
      method: "coronation",
    });
    expect(finished.state.players[first]?.lastActionSequence).toBe(1);
    expect(finished.state.players[second]?.lastActionSequence).toBe(2);
    expect(finished.state.players[first]?.hand).toHaveLength(7);
    expect(finished.state.players[second]?.hand).toHaveLength(7);
    expect(
      finished.state.result?.details.cases.every(
        (entry) =>
          entry.outcome.kind === "win" &&
          entry.outcome.criterion === "earliest-final-action",
      ),
    ).toBe(true);
  });

  it("uses the final later action after a temporary pass, not the temporary pass as stopping time", () => {
    let session = withBoard(setupSession(count), {});
    const first = session.state.activePlayerId;
    const second =
      session.state.playerOrder[
        (session.state.playerOrder.indexOf(first) + 1) % count
      ];
    if (!second) throw new Error("fixture");
    session = courts(
      session,
      Object.fromEntries(
        session.state.playerOrder.map((id) => [
          id,
          id === first || id === second ? followers(1, 1) : followers(0, 0, 2),
        ]),
      ),
    );
    session = withBoard(
      session,
      Object.fromEntries(REGION_IDS.map((id) => [id, followers(1)])),
    );
    session = pass(session);
    session = play(session, "negotiate");
    session = pass(session, count - 2);
    session = play(
      session,
      "assemble",
      (options) =>
        options.find((plan) =>
          plan.operations.every(
            (operation) =>
              operation.kind === "transfer" &&
              operation.to.kind === "region" &&
              operation.to.regionId === "devon",
          ),
        ),
      (options) =>
        options.find(
          (choice) =>
            choice.kind === "follower" &&
            choice.regionId === "devon" &&
            choice.faction === "scottish",
        ),
    );
    const finished = toEnding(session);
    expect(finished.state.result).toMatchObject({
      kind: "win",
      winner: second,
      method: "coronation",
    });
    expect(finished.state.players[first]?.lastActionSequence).toBe(2);
    expect(finished.state.players[second]?.lastActionSequence).toBe(1);
  });
});

describe.each([2, 3])("%i-player Plot endgame decisions", (count) => {
  it("reveals only a held Plot and waits for its owner without advancing an action or choosing a faction", () => {
    const pending = plotInvasion(count);
    const holder = findPlotHolder(pending.state);
    expect(holder).not.toBeNull();
    expect(pending.state.phase).toBe("plot-choice");
    expect(pending.state.result).toBeNull();
    expect(pending.state.plot).toEqual({ ...holder, faction: null });
    expect(pending.events.slice(-4).map((event) => event.type)).toEqual([
      "TurnCommitted",
      "PowerStruggleResolved",
      "GameEndTriggered",
      "PlotRevealed",
    ]);
    expect(pending.events.at(-1)).toMatchObject({
      type: "PlotRevealed",
      ...holder,
      actionSequence: 0,
    });
    expect(
      pending.events.some(
        (event) => event.type === "GameFinished" || event.type === "PlotChosen",
      ),
    ).toBe(false);
    expect(() => beginTurn(pending.state)).toThrow("ended");
    expect(() => scoreGame(pending.state)).toThrow("Choose the held Plot");
  });

  it("commits a virtual follower and final result atomically with no physical inventory or timing change", () => {
    const pending = plotInvasion(count);
    const plot = pending.state.plot;
    if (!plot) throw new Error("fixture");
    const choice: PlotChoice = {
      playerId: plot.playerId,
      faction: "english",
      baseEventSequence: pending.state.eventSequence,
    };
    const before = JSON.stringify(pending);
    const completed = choosePlot(pending, choice);
    expect(completed.state.phase).toBe("finished");
    expect(completed.state.result).toMatchObject({
      kind: "win",
      winner: plot.playerId,
      method: "invasion",
    });
    expect(completed.state.plot).toEqual({ ...plot, faction: "english" });
    expect(completed.events.slice(-2).map((event) => event.type)).toEqual([
      "PlotChosen",
      "GameFinished",
    ]);
    expect(completed.events.at(-2)).toMatchObject({
      playerId: plot.playerId,
      cardId: plot.cardId,
      faction: "english",
      eventSequence: choice.baseEventSequence + 1,
    });
    expect(completed.state.eventSequence).toBe(choice.baseEventSequence + 2);
    for (const key of [
      "players",
      "regions",
      "supply",
      "removedFromGame",
      "regionCards",
      "rngState",
      "actionSequence",
      "turnSequence",
      "lastSwap",
    ] as const)
      expect(completed.state[key]).toEqual(pending.state[key]);
    expect(
      completed.state.result?.details.players.find(
        (row) => row.playerId === plot.playerId,
      ),
    ).toMatchObject({
      court: followers(1, 1),
      scoringCourt: followers(1, 1, 1),
      completeSets: 1,
    });
    expect(JSON.stringify(pending)).toBe(before);
    expect(Object.isFrozen(choice)).toBe(false);
    expect(Object.isFrozen(completed.state.result?.details)).toBe(true);
    expect(() => choosePlot(completed, choice)).toThrow("No Plot choice");
    expect(
      scoreGame(completed.state, {
        playerId: plot.playerId,
        faction: "english",
      }),
    ).toEqual(completed.state.result);
    expect(() =>
      scoreGame(completed.state, { playerId: plot.playerId, faction: "welsh" }),
    ).toThrow("already committed");
    assertGameInvariants(completed.state);
  });

  it("validates owner, faction and event cursor and leaves failed choices unaccepted", () => {
    const pending = plotInvasion(count);
    const plot = pending.state.plot;
    const other = pending.state.playerOrder.find((id) => id !== plot?.playerId);
    if (!plot || !other) throw new Error("fixture");
    const choice: PlotChoice = {
      playerId: plot.playerId,
      faction: "english",
      baseEventSequence: pending.state.eventSequence,
    };
    const before = JSON.stringify(pending);
    expect(() => choosePlot(pending, { ...choice, playerId: other })).toThrow(
      "Only the revealed Plot owner",
    );
    expect(() =>
      choosePlot(pending, {
        ...choice,
        baseEventSequence: choice.baseEventSequence - 1,
      }),
    ).toThrow("Stale Plot");
    const invalid = { ...choice };
    Reflect.set(invalid, "faction", "french");
    expect(() => choosePlot(pending, invalid)).toThrow("valid Plot faction");
    expect(() =>
      choosePlot({ ...pending, events: pending.events.slice(0, -1) }, choice),
    ).toThrow("event log");
    expect(JSON.stringify(pending)).toBe(before);
  });

  it("scores Coronation only after Plot choice and applies its final override after support comparisons", () => {
    let session = withBoard(advancedFixture(count), {});
    const holder = findPlotHolder(session.state);
    if (!holder) throw new Error("fixture");
    session = courts(
      session,
      Object.fromEntries(
        session.state.playerOrder.map((id) => [id, followers(1, 0, 1)]),
      ),
    );
    const board = Object.fromEntries(
      session.state.regionCards.map((card, index) => [
        card.regionId,
        index < 4
          ? followers(1)
          : index < 7
            ? followers(0, 1)
            : followers(0, 0, 1),
      ]),
    ) as Record<RegionId, FactionCounts>;
    const pending = toEnding(withBoard(session, board));
    expect(pending.state.phase).toBe("plot-choice");
    expect(pending.state.ending).toBe("coronation");
    const completed = choosePlot(pending, {
      playerId: holder.playerId,
      faction: "english",
      baseEventSequence: pending.state.eventSequence,
    });
    expect(completed.state.result).toMatchObject({
      kind: "win",
      winner: holder.playerId,
      method: "coronation",
    });
    expect(completed.state.result?.details.cases[0]?.ranking).toEqual([
      "scottish",
      "welsh",
      "english",
    ]);
    expect(
      completed.state.result?.details.cases[0]?.steps.map(
        (step) => step.criterion,
      ),
    ).toEqual(["leading-faction", "second-faction", "plot-override"]);
    expect(completed.state.players).toEqual(pending.state.players);
    expect(completed.state.result?.details.factionPower).toEqual({
      scottish: { wins: 4, lastWonStruggle: 4 },
      welsh: { wins: 3, lastWonStruggle: 7 },
      english: { wins: 1, lastWonStruggle: 8 },
    });
  });

  it("finishes without Plot when the unique card was undealt", () => {
    const initial = withBoard(advancedFixture(count, false), {});
    expect(
      initial.state.undealtCunningCards.some((card) => card.type === "plot"),
    ).toBe(true);
    const completed = toEnding(initial);
    expect(completed.state.phase).toBe("finished");
    expect(completed.state.plot).toBeNull();
    expect(completed.state.result?.details.plot).toBeNull();
    expect(
      completed.events.some(
        (event) => event.type === "PlotRevealed" || event.type === "PlotChosen",
      ),
    ).toBe(false);
    expect(() =>
      scoreGame(completed.state, {
        playerId: completed.state.activePlayerId,
        faction: "english",
      }),
    ).toThrow("undealt Plot");
  });
});

describe("scoring state and reproducibility", () => {
  it("previews all virtual factions without accepting a Plot choice or mutating state", () => {
    const pending = plotInvasion();
    const plot = pending.state.plot;
    if (!plot) throw new Error("fixture");
    const before = JSON.stringify(pending);
    const scores = FACTIONS.map((faction) =>
      scoreGame(pending.state, { playerId: plot.playerId, faction }),
    );
    expect(scores[2]).toMatchObject({ kind: "win", winner: plot.playerId });
    expect(JSON.stringify(pending)).toBe(before);
    expect(() => scoreGame(setupSession().state)).toThrow(
      "Normal play must end",
    );
    const stranger = pending.state.playerOrder.find(
      (id) => id !== plot.playerId,
    );
    if (!stranger) throw new Error("fixture");
    expect(() =>
      scoreGame(pending.state, { playerId: stranger, faction: "english" }),
    ).toThrow("held Plot");
  });

  it("continues a pending Plot after JSON load and reproduces state, counters, events and result exactly", () => {
    const pending = plotInvasion();
    const plot = pending.state.plot;
    if (!plot) throw new Error("fixture");
    const loaded: GameSession = JSON.parse(JSON.stringify(pending));
    const choice: PlotChoice = {
      playerId: plot.playerId,
      faction: "english",
      baseEventSequence: pending.state.eventSequence,
    };
    const completed = choosePlot(pending, choice);
    expect(choosePlot(loaded, choice)).toEqual(completed);
    const restored: GameSession = JSON.parse(JSON.stringify(completed));
    expect(scoreGame(restored.state)).toEqual(completed.state.result);
    expect(restored.events.map((event) => event.eventSequence)).toEqual(
      Array.from({ length: restored.events.length }, (_, index) => index),
    );
    expect(
      scoreGame({
        ...restored.state,
        playerOrder: [...restored.state.playerOrder].reverse(),
      }),
    ).toEqual(completed.state.result);
    assertGameInvariants(restored.state);
  });

  it("does not freeze caller-owned state while resolving a choice", () => {
    const pending = copyChoice(plotInvasion());
    const plot = pending.state.plot;
    if (!plot) throw new Error("fixture");
    const before = JSON.stringify(pending);
    const result = resolvePlotChoice(pending.state, {
      playerId: plot.playerId,
      faction: "english",
      baseEventSequence: pending.state.eventSequence,
    });
    expect(Object.isFrozen(pending.state)).toBe(false);
    expect(Object.isFrozen(pending.state.plot)).toBe(false);
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(JSON.stringify(pending)).toBe(before);
  });

  it("rejects tampered final scoring details and invalid reveal metadata", () => {
    const completed = copyChoice(
      toEnding(withBoard(setupSession(), {})).state,
    ) as Mutable<GameState>;
    if (!completed.result) throw new Error("fixture");
    if (completed.result.kind === "draw")
      completed.result.reason += " tampered";
    else completed.result.explanation += " tampered";
    expect(() => assertGameInvariants(completed)).toThrow(
      "Stored result must match",
    );
    const pending = copyChoice(plotInvasion().state) as Mutable<GameState>;
    if (!pending.plot) throw new Error("fixture");
    pending.plot.cardId = "not-plot";
    expect(() => assertGameInvariants(pending)).toThrow(
      "Revealed Plot ownership",
    );
    const missing = copyChoice(plotInvasion().state) as Mutable<GameState>;
    missing.plot = null;
    expect(() => assertGameInvariants(missing)).toThrow(
      "Missing revealed Plot",
    );
  });

  it("rejects Plot resolution without a pending decision", () => {
    const { state } = setupSession();
    expect(() =>
      resolvePlotChoice(state, {
        playerId: state.activePlayerId,
        faction: "scottish",
        baseEventSequence: state.eventSequence,
      }),
    ).toThrow("No Plot choice");
  });
});
