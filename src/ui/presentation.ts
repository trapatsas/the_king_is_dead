import { FACTIONS } from "../game/domain";
import type { CardType, GameState, PlayerId, RegionId } from "../game/domain";
import type { AcceptedEvent } from "../game/events";
import type { EffectOperation, EffectPlan } from "../game/turnTypes";

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

/** Deliberately copies only public information and the explicitly revealed hand.
 * Full engine state and accepted history must never be spread into view props. */
export function projectTable(
  state: GameState,
  revealedPlayer: PlayerId | null,
) {
  return {
    regions: state.regions,
    regionCards: state.regionCards,
    supply: state.supply,
    controlDiscs: state.controlDiscsInSupply,
    instability: 3 - state.instabilityDiscsInFrance,
    players: state.playerOrder.map((id) => {
      const player = state.players[id]!;
      return {
        id,
        court: player.court,
        handCount: player.hand.length,
        discardTop: player.discards.at(-1) ?? null,
        negotiationDiscLocation: player.negotiationDiscLocation,
      };
    }),
    hand:
      revealedPlayer === null
        ? []
        : [...(state.players[revealedPlayer]?.hand ?? [])],
    activePlayerId: state.activePlayerId,
    passes: state.consecutivePasses,
    turn: state.turnSequence + 1,
    seed: state.initialSeed,
    phase: state.phase,
    plot: state.plot,
    result: state.result,
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

interface ChoiceField {
  key: string;
  label: string;
  value: string;
  region: boolean;
}
/** Presentation fields are derived from accepted engine candidates, never rules. */
export function effectFields(plan: EffectPlan): ChoiceField[] {
  return plan.operations.flatMap((op, index) => {
    const prefix = `Step ${index + 1}`;
    if (op.kind === "swap-region-cards")
      return [
        {
          key: `${index}:first`,
          label: "First region card",
          value: op.first,
          region: true,
        },
        {
          key: `${index}:second`,
          label: "Second region card",
          value: op.second,
          region: true,
        },
        {
          key: `${index}:disc`,
          label: "Place your negotiation disc",
          value: op.negotiationDiscOn ?? "disc-already-used",
          region: op.negotiationDiscOn !== null,
        },
      ];
    return [
      {
        key: `${index}:from`,
        label: `${prefix} · Move from`,
        value: op.from.kind === "region" ? op.from.regionId : "supply",
        region: op.from.kind === "region",
      },
      {
        key: `${index}:to`,
        label:
          op.from.kind === "supply"
            ? `${prefix} · Place ${op.count} ${title(op.faction)}`
            : `${prefix} · Move from ${locationName(op.from)} to`,
        value: op.to.kind === "region" ? op.to.regionId : "supply",
        region: op.to.kind === "region",
      },
      {
        key: `${index}:faction`,
        label: `${prefix} · Faction, ${locationName(op.from)} to ${locationName(op.to)}`,
        value: op.faction,
        region: false,
      },
      {
        key: `${index}:count`,
        label: `${prefix} · Number of ${title(op.faction)} followers`,
        value: String(op.count),
        region: false,
      },
    ];
  });
}
export function nextDecision(plans: readonly EffectPlan[]) {
  const keys = [
    ...new Set(
      plans.flatMap((plan) => effectFields(plan).map((field) => field.key)),
    ),
  ];
  for (const key of keys) {
    const options = new Map<string, ChoiceField>();
    for (const plan of plans) {
      const field = effectFields(plan).find((item) => item.key === key) ?? {
        key,
        label: "Further exchange",
        value: "none",
        region: false,
      };
      options.set(field.value, field);
    }
    if (options.size > 1)
      return {
        key,
        label: [...options.values()][0]!.label,
        options: [...options.values()],
      };
  }
  return null;
}
export function narrowPlans(
  plans: readonly EffectPlan[],
  key: string,
  value: string,
): readonly EffectPlan[] {
  return plans.filter(
    (plan) =>
      (effectFields(plan).find((field) => field.key === key)?.value ??
        "none") === value,
  );
}
export const FACTION_MARKS = Object.fromEntries(
  FACTIONS.map((faction) => [faction, title(faction).charAt(0)]),
) as Record<(typeof FACTIONS)[number], string>;
