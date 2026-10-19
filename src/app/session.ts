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

/** Copy only the new delta; accepted history is already a frozen snapshot, so
 * each commit costs O(delta) rather than re-serializing the whole game. */
function appendCommit(session: GameSession, result: CommitResult): GameSession {
  const accepted = copyChoice(result);
  // Frozen events are engine snapshots; copy anything else so callers stay unfrozen.
  const history = session.events.map((event) =>
    Object.isFrozen(event) ? event : copyChoice(event),
  );
  return freezeSnapshot({
    state: accepted.state,
    events: [...history, ...accepted.events],
  });
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
