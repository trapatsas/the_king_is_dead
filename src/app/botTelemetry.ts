import type { GameSession } from "../game/events";
import type { SearchBudget, SearchResult } from "../bot/search";

export interface BotTelemetry {
  readonly budget: SearchBudget;
  readonly result: SearchResult;
  readonly runtime: string;
}
const accepted = new WeakMap<GameSession, BotTelemetry>();
/** Attach diagnostics to an already validated commit without changing engine
 * events, observations or the immutable session's persisted game semantics. */
export function rememberBotTelemetry(
  session: GameSession,
  telemetry: BotTelemetry,
) {
  accepted.set(session, telemetry);
}
export function botTelemetry(
  session: GameSession,
  turn: number,
): BotTelemetry | undefined {
  const value = accepted.get(session);
  return value?.result.plan.baseTurnSequence === turn - 1 ? value : undefined;
}
