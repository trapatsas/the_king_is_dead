import { FACTIONS, REGION_IDS } from "./domain";
import type { GameState, PlayerId } from "./domain";
import { IllegalTurnError } from "./errors";
import { freezeSnapshot } from "./immutable";
import { sameChoice } from "./plans";
import type { SummonChoice } from "./turnTypes";

export function enumerateSummonChoices(
  afterEffect: GameState,
): readonly SummonChoice[] {
  if (afterEffect.phase !== "turn" || afterEffect.ending !== null) return [];
  const choices: SummonChoice[] = [];
  for (const regionId of REGION_IDS) {
    const region = afterEffect.regions[regionId];
    if (region.control.kind !== "unresolved") continue;
    for (const faction of FACTIONS) {
      if (region.followers[faction] > 0) {
        choices.push({ kind: "follower", count: 1, regionId, faction });
      }
    }
  }
  if (choices.length === 0) {
    choices.push({
      kind: "zero",
      count: 0,
      reason: "no-followers-in-uncontrolled-regions",
    });
  }
  return freezeSnapshot(choices);
}

export function applySummon(
  afterEffect: GameState,
  playerId: PlayerId,
  choice: SummonChoice,
): GameState {
  const player = afterEffect.players[playerId];
  if (player === undefined || afterEffect.activePlayerId !== playerId) {
    throw new IllegalTurnError("Only the active player may summon");
  }
  const accepted = enumerateSummonChoices(afterEffect).find((option) =>
    sameChoice(option, choice),
  );
  if (accepted === undefined) {
    throw new IllegalTurnError(
      "Choose exactly one available post-effect follower, or justified zero",
    );
  }
  return applySummonTrusted(afterEffect, playerId, accepted);
}

/** Internal: choice must come from enumerateSummonChoices for this position. */
export function applySummonTrusted(
  afterEffect: GameState,
  playerId: PlayerId,
  accepted: SummonChoice,
): GameState {
  const player = afterEffect.players[playerId]!;
  if (accepted.kind === "zero") return afterEffect;
  const region = afterEffect.regions[accepted.regionId];
  return {
    ...afterEffect,
    regions: {
      ...afterEffect.regions,
      [region.id]: {
        ...region,
        followers: {
          ...region.followers,
          [accepted.faction]: region.followers[accepted.faction] - 1,
        },
      },
    },
    players: {
      ...afterEffect.players,
      [playerId]: {
        ...player,
        court: {
          ...player.court,
          [accepted.faction]: player.court[accepted.faction] + 1,
        },
      },
    },
  };
}
