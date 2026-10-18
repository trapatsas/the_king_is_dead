import { FACTIONS, REGION_IDS } from "../domain";
import type { Faction, FactionCounts, GameState } from "../domain";
import { IllegalTurnError } from "../errors";
import type { FollowerLocation, FollowerTransfer } from "../turnTypes";

function countsAt(state: GameState, location: FollowerLocation): FactionCounts {
  if (location.kind === "supply") return state.supply;
  if (location.kind !== "region" || !REGION_IDS.includes(location.regionId)) {
    throw new IllegalTurnError("Unknown follower location");
  }
  const region = state.regions[location.regionId];
  if (region.control.kind !== "unresolved") {
    throw new IllegalTurnError(
      "Followers cannot move into or out of a resolved region",
    );
  }
  return region.followers;
}

function changeCount(
  state: GameState,
  location: FollowerLocation,
  faction: Faction,
  difference: number,
): GameState {
  const followers = { ...countsAt(state, location) };
  followers[faction] += difference;
  if (location.kind === "supply") return { ...state, supply: followers };
  const region = state.regions[location.regionId];
  return {
    ...state,
    regions: { ...state.regions, [region.id]: { ...region, followers } },
  };
}

/** Ordered count transfers shared by later card definitions; no card text here. */
export function applyTransfers(
  state: GameState,
  operations: readonly FollowerTransfer[],
): GameState {
  let next = state;
  for (const operation of operations) {
    if (
      operation.kind !== "transfer" ||
      !FACTIONS.includes(operation.faction) ||
      !Number.isSafeInteger(operation.count) ||
      operation.count <= 0
    ) {
      throw new IllegalTurnError(
        "Transfers require a faction and a positive integer count",
      );
    }
    const from = countsAt(next, operation.from);
    countsAt(next, operation.to);
    if (
      operation.from.kind === operation.to.kind &&
      (operation.from.kind === "supply" ||
        (operation.to.kind === "region" &&
          operation.from.regionId === operation.to.regionId))
    ) {
      throw new IllegalTurnError("Transfer source and destination must differ");
    }
    if (from[operation.faction] < operation.count) {
      throw new IllegalTurnError("Not enough followers at transfer source");
    }
    next = changeCount(
      next,
      operation.from,
      operation.faction,
      -operation.count,
    );
    next = changeCount(next, operation.to, operation.faction, operation.count);
  }
  return next;
}
