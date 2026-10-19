import type { AcceptedEvent, CommitResult, GameSession } from "../game/events";
import { IllegalTurnError } from "../game/errors";
import { freezeSnapshot } from "../game/immutable";
import { copyChoice } from "../game/plans";
import { turnEngine } from "../game/turns";
import type { TurnEngine } from "../game/turns";
import type { PlotChoice, TurnDraft, TurnPlan } from "../game/turnTypes";

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

/** Only history arrays produced here are known to contain deeply frozen data.
 * Object.isFrozen alone cannot establish that a caller's nested data is frozen. */
const acceptedHistories = new WeakSet<readonly AcceptedEvent[]>();

/** Copy externally supplied history once, then reuse our immutable snapshots
 * without re-serializing the whole game on every committed turn. */
function appendCommit(session: GameSession, result: CommitResult): GameSession {
  const accepted = copyChoice(result);
  const history = acceptedHistories.has(session.events)
    ? session.events
    : copyChoice(session.events);
  const next = freezeSnapshot({
    state: accepted.state,
    events: [...history, ...accepted.events],
  });
  acceptedHistories.add(next.events);
  return next;
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

/** Bot plans pass the same authoritative boundary as human drafts. */
export function commitPlan(session: GameSession, plan: TurnPlan): GameSession {
  assertSessionCursor(session);
  return appendCommit(session, turnEngine.commitTurn(session.state, plan));
}
