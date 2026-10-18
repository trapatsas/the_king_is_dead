import type { GameState, PlayerId } from "../domain";
import { IllegalTurnError } from "../errors";
import type { EffectOperation } from "../turnTypes";
import { applyTransfers } from "./common";
import { applyRegionCardSwap } from "./regionCards";

export function applyEffectOperations(
  state: GameState,
  actorId: PlayerId,
  operations: readonly EffectOperation[],
): GameState {
  let next = state;
  for (const operation of operations) {
    switch (operation.kind) {
      case "transfer":
        next = applyTransfers(next, [operation]);
        break;
      case "swap-region-cards":
        next = applyRegionCardSwap(next, actorId, operation);
        break;
      default:
        throw new IllegalTurnError("Unknown effect operation");
    }
  }
  return next;
}
