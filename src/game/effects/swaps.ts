import { FACTIONS, REGION_IDS } from "../domain";
import type { GameState, PlayerId, SwapMemory, SwapTransfer } from "../domain";
import type { EffectPlan, FollowerTransfer } from "../turnTypes";

/** Combine indistinguishable followers; ignore operation order for anti-undo. */
export function transferSignature(transfers: readonly SwapTransfer[]): string {
  const counts = new Map<string, number>();
  for (const transfer of transfers) {
    const key = `${transfer.from}/${transfer.to}/${transfer.faction}`;
    counts.set(key, (counts.get(key) ?? 0) + transfer.count);
  }
  return JSON.stringify(
    [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

export function swapTransfers(effect: EffectPlan): SwapTransfer[] {
  return effect.operations.flatMap((operation) =>
    operation.kind === "transfer" &&
    operation.from.kind === "region" &&
    operation.to.kind === "region"
      ? [
          {
            from: operation.from.regionId,
            to: operation.to.regionId,
            faction: operation.faction,
            count: operation.count,
          },
        ]
      : [],
  );
}

export function isForbiddenReverse(
  state: GameState,
  actorId: PlayerId,
  effect: EffectPlan,
): boolean {
  const last = state.lastSwap;
  if (
    last === null ||
    last.playerId === actorId ||
    last.effectiveCard !== effect.effectiveCard
  )
    return false;
  return (
    transferSignature(swapTransfers(effect)) ===
    transferSignature(
      last.transfers.map((transfer) => ({
        ...transfer,
        from: transfer.to,
        to: transfer.from,
      })),
    )
  );
}

export function nextSwapMemory(
  playerId: PlayerId,
  actionSequence: number,
  effect: EffectPlan,
): SwapMemory | null {
  if (
    effect.kind !== "effect" ||
    (effect.effectiveCard !== "manoeuvre" &&
      effect.effectiveCard !== "outmanoeuvre")
  )
    return null;
  const transfers = swapTransfers(effect);
  return transfers.length === 0
    ? null
    : {
        playerId,
        actionSequence,
        effectiveCard: effect.effectiveCard,
        transfers,
      };
}

/** Stable operation order deduplicates equivalent orientations of a swap. */
export function canonicalSwapOperations(
  transfers: readonly FollowerTransfer[],
): FollowerTransfer[] {
  const order = (transfer: FollowerTransfer): number => {
    if (transfer.from.kind !== "region" || transfer.to.kind !== "region")
      return -1;
    return (
      (REGION_IDS.indexOf(transfer.from.regionId) * 8 +
        REGION_IDS.indexOf(transfer.to.regionId)) *
        3 +
      FACTIONS.indexOf(transfer.faction)
    );
  };
  return [...transfers].sort((a, b) => order(a) - order(b));
}
