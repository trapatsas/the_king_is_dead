import { areAdjacent, HOME_REGIONS } from "../board";
import { FACTIONS, REGION_IDS } from "../domain";
import type {
  Faction,
  FactionCounts,
  GameState,
  PlayerId,
  RegionId,
  StandardCardType,
} from "../domain";
import type { CardEffectRegistry } from "../turns";
import type { EffectPlan, FollowerTransfer } from "../turnTypes";
import { freezeSnapshot } from "../immutable";
import { canonicalSwapOperations, isForbiddenReverse } from "./swaps";

function unresolved(state: GameState): RegionId[] {
  return REGION_IDS.filter(
    (id) => state.regions[id].control.kind === "unresolved",
  );
}

function noEffect(card: StandardCardType, reason: string): EffectPlan[] {
  return [
    { kind: "no-effect", effectiveCard: card, tier: 0, operations: [], reason },
  ];
}

function placement(
  regionId: RegionId,
  faction: Faction,
  count: number,
): FollowerTransfer {
  return {
    kind: "transfer",
    from: { kind: "supply" },
    to: { kind: "region", regionId },
    faction,
    count,
  };
}

/** Shared faction/home-border rule, also usable by later Cunning definitions. */
export function factionBorderTargets(
  state: GameState,
  faction: Faction,
): RegionId[] {
  const home = HOME_REGIONS[faction];
  const anchors = REGION_IDS.filter((id) => {
    const control = state.regions[id].control;
    return (
      (control.kind === "faction" && control.faction === faction) ||
      (id === home && control.kind === "unresolved")
    );
  });
  return unresolved(state).filter((id) =>
    anchors.some((anchor) => areAdjacent(anchor, id)),
  );
}

function support(
  state: GameState,
  faction: Faction,
  card: StandardCardType,
): EffectPlan[] {
  const count = Math.min(2, state.supply[faction]);
  const targets = factionBorderTargets(state, faction);
  return count === 0 || targets.length === 0
    ? noEffect(
        card,
        count === 0
          ? "No followers of this faction in supply"
          : "No eligible uncontrolled border region",
      )
    : targets.map((id) => ({
        kind: "effect",
        effectiveCard: card,
        tier: count,
        operations: [placement(id, faction, count)],
      }));
}

function assemble(state: GameState): EffectPlan[] {
  const targets = unresolved(state);
  const available = FACTIONS.filter((faction) => state.supply[faction] > 0);
  if (targets.length === 0 || available.length === 0)
    return noEffect("assemble", "No available supply placements");
  let assignments: FollowerTransfer[][] = [[]];
  for (const faction of available) {
    assignments = assignments.flatMap((operations) =>
      targets.map((id) => [...operations, placement(id, faction, 1)]),
    );
  }
  return assignments.map((operations) => ({
    kind: "effect",
    effectiveCard: "assemble",
    tier: available.length,
    operations,
  }));
}

function negotiate(state: GameState, playerId: PlayerId): EffectPlan[] {
  const player = state.players[playerId];
  if (player === undefined) return [];
  const eligible = REGION_IDS.filter((id) =>
    state.regionCards.some(
      (card) =>
        card.regionId === id &&
        card.faceUp &&
        card.negotiationDiscOwner === null,
    ),
  );
  const plans: EffectPlan[] = [];
  for (const [index, first] of eligible.entries()) {
    for (const second of eligible.slice(index + 1)) {
      const discChoices =
        player.negotiationDiscLocation === null ? [first, second] : [null];
      for (const negotiationDiscOn of discChoices) {
        plans.push({
          kind: "effect",
          effectiveCard: "negotiate",
          tier: 1,
          operations: [
            { kind: "swap-region-cards", first, second, negotiationDiscOn },
          ],
        });
      }
    }
  }
  return plans.length === 0
    ? noEffect("negotiate", "Fewer than two face-up unmarked region cards")
    : plans;
}

function transfer(
  from: RegionId,
  to: RegionId,
  faction: Faction,
  count: number,
): FollowerTransfer {
  return {
    kind: "transfer",
    from: { kind: "region", regionId: from },
    to: { kind: "region", regionId: to },
    faction,
    count,
  };
}

function swapPlan(
  card: "manoeuvre" | "outmanoeuvre",
  tier: number,
  operations: FollowerTransfer[],
): EffectPlan {
  return {
    kind: "effect",
    effectiveCard: card,
    tier,
    operations: canonicalSwapOperations(operations),
  };
}

function manoeuvre(state: GameState, playerId: PlayerId): EffectPlan[] {
  const targets = unresolved(state);
  const plans: EffectPlan[] = [];
  for (const [index, first] of targets.entries()) {
    for (const second of targets.slice(index + 1)) {
      for (const outgoing of FACTIONS) {
        if (state.regions[first].followers[outgoing] === 0) continue;
        for (const incoming of FACTIONS) {
          if (state.regions[second].followers[incoming] === 0) continue;
          const plan = swapPlan("manoeuvre", 1, [
            transfer(first, second, outgoing, 1),
            transfer(second, first, incoming, 1),
          ]);
          if (!isForbiddenReverse(state, playerId, plan)) plans.push(plan);
        }
      }
    }
  }
  return plans.length === 0
    ? noEffect("manoeuvre", "No legal two-region follower swap")
    : plans;
}

/** Count multisets only, never identities for physically identical followers. */
function groups(counts: FactionCounts, size: 1 | 2): readonly Faction[][] {
  if (size === 1)
    return FACTIONS.filter((faction) => counts[faction] > 0).map((faction) => [
      faction,
    ]);
  return FACTIONS.flatMap((first, index) =>
    FACTIONS.slice(index).flatMap((second) =>
      counts[first] > 0 && counts[second] >= (first === second ? 2 : 1)
        ? [[first, second]]
        : [],
    ),
  );
}

function outmanoeuvre(state: GameState, playerId: PlayerId): EffectPlan[] {
  const targets = unresolved(state);
  const plans: EffectPlan[] = [];
  for (const first of targets) {
    for (const second of targets) {
      if (!areAdjacent(first, second)) continue;
      for (const outgoing of FACTIONS) {
        if (state.regions[first].followers[outgoing] === 0) continue;
        for (const size of [2, 1] as const) {
          for (const incoming of groups(
            state.regions[second].followers,
            size,
          )) {
            const counts = new Map<Faction, number>();
            for (const faction of incoming)
              counts.set(faction, (counts.get(faction) ?? 0) + 1);
            const plan = swapPlan("outmanoeuvre", size, [
              transfer(first, second, outgoing, 1),
              ...[...counts].map(([faction, count]) =>
                transfer(second, first, faction, count),
              ),
            ]);
            if (!isForbiddenReverse(state, playerId, plan)) plans.push(plan);
          }
        }
      }
    }
  }
  const unique = [
    ...new Map(plans.map((plan) => [JSON.stringify(plan), plan])).values(),
  ];
  return unique.length === 0
    ? noEffect("outmanoeuvre", "No legal bordering-region follower swap")
    : unique;
}

export const STANDARD_EFFECTS: CardEffectRegistry = freezeSnapshot({
  "scottish-support": {
    enumerate: (state) => support(state, "scottish", "scottish-support"),
  },
  "welsh-support": {
    enumerate: (state) => support(state, "welsh", "welsh-support"),
  },
  "english-support": {
    enumerate: (state) => support(state, "english", "english-support"),
  },
  assemble: { enumerate: assemble },
  negotiate: { enumerate: negotiate },
  manoeuvre: { enumerate: manoeuvre },
  outmanoeuvre: { enumerate: outmanoeuvre },
});
