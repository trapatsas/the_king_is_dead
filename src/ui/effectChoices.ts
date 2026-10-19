import type { Faction, RegionId } from "../game/domain";
import type { EffectPlan } from "../game/turnTypes";
import { title } from "./presentation";

export interface FollowerPick {
  readonly regionId: RegionId;
  readonly faction: Faction;
}
export type EffectOption =
  | {
      readonly kind: "region";
      readonly key: string;
      readonly regionId: RegionId;
      readonly label: string;
    }
  | {
      readonly kind: "follower";
      readonly key: string;
      readonly regionId: RegionId;
      readonly faction: Faction;
      readonly label: string;
    };
export interface EffectPath {
  readonly plan: EffectPlan;
  readonly steps: readonly EffectOption[];
}
export interface EffectChoice {
  readonly paths: readonly EffectPath[];
  readonly picks: readonly EffectOption[];
}

function regionOption(regionId: RegionId): EffectOption {
  return {
    kind: "region",
    key: `region:${regionId}`,
    regionId,
    label: title(regionId),
  };
}
function followerOption(pick: FollowerPick): EffectOption {
  return {
    ...pick,
    kind: "follower",
    key: `follower:${pick.regionId}:${pick.faction}`,
    label: `${title(pick.faction)} · ${title(pick.regionId)}`,
  };
}

/** Interpret only the engine's legal operations. Canonical serialization order
 * never dictates which endpoint or mixed-pair follower the player picks first. */
export function beginEffectChoice(plans: readonly EffectPlan[]): EffectChoice {
  const paths: EffectPath[] = [];
  for (const plan of plans) {
    const swap = plan.operations.find((op) => op.kind === "swap-region-cards");
    if (swap?.kind === "swap-region-cards") {
      for (const [first, second] of [
        [swap.first, swap.second],
        [swap.second, swap.first],
      ] as const)
        paths.push({
          plan,
          steps: [
            regionOption(first),
            regionOption(second),
            ...(swap.negotiationDiscOn
              ? [regionOption(swap.negotiationDiscOn)]
              : []),
          ],
        });
      continue;
    }
    const departures = new Map<RegionId, FollowerPick[]>();
    for (const operation of plan.operations) {
      if (
        operation.kind !== "transfer" ||
        operation.from.kind !== "region" ||
        operation.to.kind !== "region"
      )
        continue;
      const from = operation.from.regionId;
      departures.set(from, [
        ...(departures.get(from) ?? []),
        ...Array.from({ length: operation.count }, () => ({
          regionId: from,
          faction: operation.faction,
        })),
      ]);
    }
    if (departures.size === 2) {
      for (const [from, outgoing] of departures) {
        // Select the single side first; 1-for-1 swaps allow either orientation.
        if (outgoing.length !== 1) continue;
        const incoming = [...departures].find(
          ([regionId]) => regionId !== from,
        )![1];
        const orders = [incoming];
        if (
          incoming.length === 2 &&
          incoming[0]!.faction !== incoming[1]!.faction
        )
          orders.push([...incoming].reverse());
        for (const order of orders)
          paths.push({
            plan,
            steps: [...outgoing, ...order].map(followerOption),
          });
      }
      continue;
    }
    paths.push({
      plan,
      steps: plan.operations.flatMap((operation) =>
        operation.kind === "transfer" && operation.to.kind === "region"
          ? [regionOption(operation.to.regionId)]
          : [],
      ),
    });
  }
  return { paths, picks: [] };
}

function matchingPaths(choice: EffectChoice): readonly EffectPath[] {
  return choice.paths.filter((path) =>
    choice.picks.every((pick, index) => path.steps[index]?.key === pick.key),
  );
}
export function completedEffect(choice: EffectChoice): EffectPlan | null {
  return (
    matchingPaths(choice).find(
      (path) => path.steps.length === choice.picks.length,
    )?.plan ?? null
  );
}
export function effectDecision(choice: EffectChoice) {
  const paths = matchingPaths(choice);
  const options = [
    ...new Map(
      paths.flatMap((path) => {
        const option = path.steps[choice.picks.length];
        return option ? [[option.key, option] as const] : [];
      }),
    ).values(),
  ];
  if (options.length === 0) return null;
  const first = paths[0]!;
  const card = first.plan.effectiveCard;
  const index = choice.picks.length;
  let label: string;
  if (card === "negotiate")
    label = [
      "Choose either region card",
      "Choose the other region card",
      "Place your negotiation disc",
    ][index]!;
  else if (card === "manoeuvre" || card === "outmanoeuvre") {
    const returns = first.steps.length - 1;
    label =
      index === 0
        ? returns === 2
          ? "Select the single follower"
          : "Select the first follower"
        : `Select return follower ${index} of ${returns}`;
  } else {
    const operation = first.plan.operations[index];
    label =
      operation?.kind === "transfer"
        ? `Place ${operation.count} ${title(operation.faction)}`
        : "Choose a region";
  }
  return { key: `${card}:${index}`, label, options };
}
export function pickEffectOption(
  choice: EffectChoice,
  key: string,
): EffectChoice {
  const option = effectDecision(choice)?.options.find(
    (item) => item.key === key,
  );
  if (!option) throw new Error("Choose one of the available effect targets");
  return { ...choice, picks: [...choice.picks, option] };
}
export function undoEffectPick(choice: EffectChoice): EffectChoice {
  return { ...choice, picks: choice.picks.slice(0, -1) };
}
