import type { GameState } from "./domain";
import { IllegalTurnError } from "./errors";
import type { TurnContext } from "./turnTypes";

export function assertTurnContext(state: GameState, turn: TurnContext): void {
  if (
    state.phase !== "turn" ||
    state.ending !== null ||
    state.result !== null
  ) {
    throw new IllegalTurnError("Normal turns have ended");
  }
  if (turn.baseTurnSequence !== state.turnSequence) {
    throw new IllegalTurnError("Stale turn: the committed state has advanced");
  }
  if (turn.playerId !== state.activePlayerId) {
    throw new IllegalTurnError("Only the active player may take a turn");
  }
}
