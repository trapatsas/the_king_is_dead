import { FACTIONS, emptyFactionCounts } from "./domain";
import type {
  FactionCounts,
  GameState,
  RegionCardSlot,
  RegionControl,
} from "./domain";
import type {
  CommitResult,
  GameEndTriggeredEvent,
  PowerStruggleResolvedEvent,
} from "./events";
import { IllegalTurnError } from "./errors";

export function determineControl(
  followers: FactionCounts,
  struggleIndex: number,
): Exclude<RegionControl, { readonly kind: "unresolved" }> {
  const maximum = Math.max(...FACTIONS.map((faction) => followers[faction]));
  const leaders = FACTIONS.filter((faction) => followers[faction] === maximum);
  const winner = leaders.length === 1 ? leaders[0] : undefined;
  return maximum > 0 && winner !== undefined
    ? { kind: "faction", faction: winner, struggleIndex }
    : { kind: "unstable", struggleIndex };
}

/** Internal turn-finalization step, only after a full consecutive pass streak. */
export function resolveNextStruggle(
  state: GameState,
  passingPlayerId: string,
): CommitResult {
  if (
    state.phase !== "turn" ||
    state.ending !== null ||
    state.consecutivePasses !== state.playerOrder.length
  ) {
    throw new IllegalTurnError(
      "A struggle requires all players to pass consecutively",
    );
  }
  // Lowest-numbered face-up slot, independent of the array's storage order.
  let card: RegionCardSlot | undefined;
  for (const candidate of state.regionCards) {
    if (candidate.faceUp && (card === undefined || candidate.slot < card.slot))
      card = candidate;
  }
  if (card === undefined)
    throw new IllegalTurnError("No unresolved region remains");
  const region = state.regions[card.regionId];
  const control = determineControl(region.followers, card.slot);
  const supply = { ...state.supply };
  for (const faction of FACTIONS) supply[faction] += region.followers[faction];
  const controlDiscsInSupply = { ...state.controlDiscsInSupply };
  if (control.kind === "faction") controlDiscsInSupply[control.faction] -= 1;
  const instabilityDiscsInFrance =
    state.instabilityDiscsInFrance - (control.kind === "unstable" ? 1 : 0);
  const regionCards = state.regionCards.map((candidate) =>
    candidate.slot === card.slot ? { ...candidate, faceUp: false } : candidate,
  );
  const ending =
    instabilityDiscsInFrance === 0
      ? "invasion"
      : regionCards.every((candidate) => !candidate.faceUp)
        ? "coronation"
        : null;
  const metadata = {
    turnSequence: state.turnSequence,
    actionSequence: state.actionSequence,
    playerId: passingPlayerId,
  };
  const struggle: PowerStruggleResolvedEvent = {
    ...metadata,
    type: "PowerStruggleResolved",
    eventSequence: state.eventSequence + 1,
    regionId: region.id,
    struggleIndex: card.slot,
    control,
    returnedToSupply: { ...region.followers },
  };
  const events: (PowerStruggleResolvedEvent | GameEndTriggeredEvent)[] = [
    struggle,
  ];
  if (ending !== null) {
    events.push({
      ...metadata,
      type: "GameEndTriggered",
      eventSequence: struggle.eventSequence + 1,
      method: ending,
      regionId: region.id,
      struggleIndex: card.slot,
    });
  }
  return {
    state: {
      ...state,
      eventSequence: state.eventSequence + events.length,
      supply,
      regions: {
        ...state.regions,
        [region.id]: { ...region, followers: emptyFactionCounts(), control },
      },
      regionCards,
      controlDiscsInSupply,
      instabilityDiscsInFrance,
      consecutivePasses: 0,
      ending,
      phase: ending === null ? "turn" : "scoring",
    },
    events,
  };
}
