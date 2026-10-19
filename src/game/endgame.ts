import { FACTIONS } from "./domain";
import type { GameState, PlayerId } from "./domain";
import type {
  CommitResult,
  GameFinishedEvent,
  PlotChosenEvent,
  PlotRevealedEvent,
} from "./events";
import { IllegalTurnError } from "./errors";
import { freezeSnapshot } from "./immutable";
import { assertGameInvariants } from "./invariants";
import { copyChoice } from "./plans";
import { findPlotHolder, scoreGame } from "./scoring";
import type { PlotChoice } from "./turnTypes";

function finish(state: GameState, causedBy: PlayerId): CommitResult {
  const result = scoreGame(state);
  const event: GameFinishedEvent = {
    type: "GameFinished",
    playerId: causedBy,
    turnSequence: state.turnSequence,
    actionSequence: state.actionSequence,
    eventSequence: state.eventSequence + 1,
    result,
  };
  return {
    state: {
      ...state,
      phase: "finished",
      result,
      eventSequence: event.eventSequence,
    },
    events: [event],
  };
}

/** Called atomically after the terminal struggle, before another turn is possible. */
export function advanceEndgame(
  state: GameState,
  causedBy: PlayerId,
): CommitResult {
  assertGameInvariants(state);
  const result = advanceEndgameTrusted(state, causedBy);
  assertGameInvariants(result.state);
  return freezeSnapshot(copyChoice(result));
}

/** Internal transition for already-valid engine/search positions. */
export function advanceEndgameTrusted(
  state: GameState,
  causedBy: PlayerId,
): CommitResult {
  if (
    state.phase !== "scoring" ||
    state.ending === null ||
    state.result !== null ||
    state.plot !== null ||
    !state.playerOrder.includes(causedBy)
  ) {
    throw new IllegalTurnError("Endgame requires a new terminal trigger");
  }
  const holder = findPlotHolder(state);
  let result: CommitResult;
  if (holder === null) result = finish(state, causedBy);
  else {
    const event: PlotRevealedEvent = {
      type: "PlotRevealed",
      playerId: holder.playerId,
      cardId: holder.cardId,
      eventSequence: state.eventSequence + 1,
      turnSequence: state.turnSequence,
      actionSequence: state.actionSequence,
    };
    result = {
      state: {
        ...state,
        phase: "plot-choice",
        plot: { ...holder, faction: null },
        eventSequence: event.eventSequence,
      },
      events: [event],
    };
  }
  return result;
}

/** One explicit owner decision; physical followers, action time and RNG never change. */
export function resolvePlotChoice(
  state: GameState,
  choice: PlotChoice,
): CommitResult {
  assertGameInvariants(state);
  const plot = state.plot;
  if (
    state.phase !== "plot-choice" ||
    state.result !== null ||
    plot === null ||
    plot.faction !== null
  ) {
    throw new IllegalTurnError("No Plot choice is pending");
  }
  if (choice.playerId !== plot.playerId)
    throw new IllegalTurnError("Only the revealed Plot owner may choose");
  if (choice.baseEventSequence !== state.eventSequence)
    throw new IllegalTurnError("Stale Plot choice");
  if (!FACTIONS.includes(choice.faction))
    throw new IllegalTurnError("Choose a valid Plot faction");
  const event: PlotChosenEvent = {
    type: "PlotChosen",
    playerId: choice.playerId,
    cardId: plot.cardId,
    faction: choice.faction,
    eventSequence: state.eventSequence + 1,
    turnSequence: state.turnSequence,
    actionSequence: state.actionSequence,
  };
  const selected: GameState = {
    ...state,
    plot: { ...plot, faction: choice.faction },
    eventSequence: event.eventSequence,
  };
  const completed = finish(selected, choice.playerId);
  assertGameInvariants(completed.state);
  return freezeSnapshot(
    copyChoice({
      state: completed.state,
      events: [event, ...completed.events],
    }),
  );
}
