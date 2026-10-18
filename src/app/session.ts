import type { CommitResult, GameSession } from "../game/events";
import { IllegalTurnError } from "../game/errors";
import { freezeSnapshot } from "../game/immutable";
import { copyChoice } from "../game/plans";
import { turnEngine } from "../game/turns";
import type { TurnEngine } from "../game/turns";
import type { PlotChoice, TurnDraft } from "../game/turnTypes";

/** Append accepted deltas atomically; no draft API writes accepted history. */
function assertSessionCursor(session: GameSession): void {
  const first = session.events[0];
  const last = session.events.at(-1);
  if (
    first?.type !== "GameCreated" ||
    last === undefined ||
    last.eventSequence !== session.state.eventSequence ||
    last.turnSequence !== session.state.turnSequence ||
    last.actionSequence !== session.state.actionSequence ||
    session.events.some((event, index) => event.eventSequence !== index)
  ) {
    throw new IllegalTurnError(
      "Accepted event log does not match the committed state",
    );
  }
}

function appendCommit(session: GameSession, result: CommitResult): GameSession {
  return freezeSnapshot(
    copyChoice({
      state: result.state,
      events: [...session.events, ...result.events],
    }),
  );
}

export function endTurn(
  session: GameSession,
  draft: TurnDraft,
  engine: TurnEngine = turnEngine,
): GameSession {
  assertSessionCursor(session);
  const preview = engine.previewTurn(session.state, draft);
  if (preview.plan === null)
    throw new IllegalTurnError("Complete the turn before End Turn");
  const result = engine.commitTurn(session.state, preview.plan);
  return appendCommit(session, result);
}

export function choosePlot(
  session: GameSession,
  choice: PlotChoice,
  engine: TurnEngine = turnEngine,
): GameSession {
  assertSessionCursor(session);
  return appendCommit(session, engine.resolvePlotChoice(session.state, choice));
}
