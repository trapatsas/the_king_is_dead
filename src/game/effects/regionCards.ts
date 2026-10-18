import type { GameState, PlayerId } from "../domain";
import { IllegalTurnError } from "../errors";
import type { RegionCardSwap } from "../turnTypes";

/** The marker belongs to its region card, never the numbered board position. */
export function applyRegionCardSwap(
  state: GameState,
  actorId: PlayerId,
  operation: RegionCardSwap,
): GameState {
  const actor = state.players[actorId];
  const first = state.regionCards.find(
    (card) => card.regionId === operation.first,
  );
  const second = state.regionCards.find(
    (card) => card.regionId === operation.second,
  );
  if (
    actor === undefined ||
    actorId !== state.activePlayerId ||
    first === undefined ||
    second === undefined ||
    first.regionId === second.regionId ||
    !first.faceUp ||
    !second.faceUp ||
    first.negotiationDiscOwner !== null ||
    second.negotiationDiscOwner !== null
  ) {
    throw new IllegalTurnError(
      "Swap two distinct face-up unmarked region cards",
    );
  }
  const available = actor.negotiationDiscLocation === null;
  if (
    available
      ? operation.negotiationDiscOn !== first.regionId &&
        operation.negotiationDiscOn !== second.regionId
      : operation.negotiationDiscOn !== null
  ) {
    throw new IllegalTurnError(
      "Use only the actor's available personal negotiation disc",
    );
  }
  return {
    ...state,
    regionCards: state.regionCards.map((card) => {
      const replacement =
        card.regionId === first.regionId
          ? second
          : card.regionId === second.regionId
            ? first
            : null;
      if (replacement === null) return card;
      return {
        ...replacement,
        slot: card.slot,
        negotiationDiscOwner:
          replacement.regionId === operation.negotiationDiscOn
            ? actorId
            : replacement.negotiationDiscOwner,
      };
    }),
    players: available
      ? {
          ...state.players,
          [actorId]: {
            ...actor,
            negotiationDiscLocation: operation.negotiationDiscOn,
          },
        }
      : state.players,
  };
}
