import { FACTIONS } from "../game/domain";
import type { CardType, GameState, PlayerId, RegionId } from "../game/domain";
import type { AcceptedEvent } from "../game/events";
import type { EffectOperation, EffectPlan } from "../game/turnTypes";
import { getObservation } from "../game/visibility";

export function title(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export const CARD_TEXT: Partial<Record<CardType, string>> = {
  "scottish-support":
    "Place up to 2 Scottish followers in an eligible border region.",
  "welsh-support":
    "Place up to 2 Welsh followers in an eligible border region.",
  "english-support":
    "Place up to 2 English followers in an eligible border region.",
  assemble:
    "Place 1 follower of each available faction in uncontrolled regions.",
  negotiate:
    "Exchange two eligible region cards. If available, place your negotiation disc on one.",
  manoeuvre:
    "Exchange 1 follower in each direction between two uncontrolled regions.",
  outmanoeuvre:
    "Exchange 1 follower for up to 2 across a border between uncontrolled regions.",
  plot: "Held until the game ends. Choose a faction for a virtual scoring follower.",
};

/** Every rendered table view goes through the engine's redacted observation:
 * public information plus, at most, the revealed viewer's own hand. Full engine
 * state and accepted history must never be spread into view props. */
export function projectTable(
  state: GameState,
  revealedPlayer: PlayerId | null,
) {
  const observation = getObservation(state, revealedPlayer);
  return {
    regions: observation.regions,
    regionCards: observation.regionCards,
    supply: observation.supply,
    controlDiscs: observation.controlDiscsInSupply,
    instability: 3 - observation.instabilityDiscsInFrance,
    players: observation.players,
    hand: observation.own?.hand ?? [],
    passes: observation.consecutivePasses,
    turn: observation.turnSequence + 1,
    /** Null until the game is finished. */
    seed: observation.seed,
  };
}
export type TableView = ReturnType<typeof projectTable>;

export function publicNotices(events: readonly AcceptedEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.type === "PowerStruggleResolved") {
      const control =
        event.control.kind === "faction"
          ? `${title(event.control.faction)} control`
          : "instability";
      return [
        `Struggle ${event.struggleIndex}: ${title(event.regionId)} — ${control}. Followers returned to supply.`,
      ];
    }
    if (event.type === "GameEndTriggered")
      return [`${title(event.method)} ends normal play.`];
    return [];
  });
}

function locationName(
  location: { kind: "supply" } | { kind: "region"; regionId: RegionId },
): string {
  return location.kind === "supply" ? "supply" : title(location.regionId);
}
export function describeOperation(op: EffectOperation): string {
  if (op.kind === "swap-region-cards")
    return `Exchange ${title(op.first)} and ${title(op.second)} cards${op.negotiationDiscOn === null ? "" : `; place your disc on ${title(op.negotiationDiscOn)}`}.`;
  return `Move ${op.count} ${title(op.faction)} from ${locationName(op.from)} to ${locationName(op.to)}.`;
}
export function describeEffect(plan: EffectPlan): string {
  return plan.kind === "no-effect"
    ? plan.reason
    : plan.operations.map(describeOperation).join(" ");
}

export const FACTION_MARKS = Object.fromEntries(
  FACTIONS.map((faction) => [faction, title(faction).charAt(0)]),
) as Record<(typeof FACTIONS)[number], string>;
