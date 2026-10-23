import { FACTIONS } from "../game/domain";
import type { Faction, GameState } from "../game/domain";
import { applyEffectOperations } from "../game/effects/execute";
import { enumerateSummonChoices } from "../game/summons";
import type { TurnPlan } from "../game/turnTypes";
import { cardChoices, simulate } from "./simulation";

/** A proof from resolved control discs, independent of a board forecast.
 * Strict leads deliberately leave latest-victory ties to normal scoring. */
export function lockedCoronationFaction(state: GameState): Faction | null {
  const remaining = state.regionCards.filter((card) => card.faceUp).length;
  if (remaining >= state.instabilityDiscsInFrance) return null;
  const wins = { scottish: 0, welsh: 0, english: 0 };
  for (const region of Object.values(state.regions))
    if (region.control.kind === "faction") wins[region.control.faction]++;
  return (
    FACTIONS.find((faction) =>
      FACTIONS.every(
        (other) => other === faction || wins[faction] > wins[other] + remaining,
      ),
    ) ?? null
  );
}

/** In the last region, every action can collect only one follower. Once the
 * leading faction is fixed, harvest scarce winning support before opponents
 * take it. Prefer spending cards that cannot produce more of it later, and
 * avoid creating extra winning support for the next player to collect. */
export function coronationHarvest(
  state: GameState,
  winningIfAllPass: boolean,
): TurnPlan | undefined {
  if (state.regionCards.filter((card) => card.faceUp).length !== 1)
    return undefined;
  const faction = lockedCoronationFaction(state);
  if (!faction) return undefined;
  const actor = state.players[state.activePlayerId]!;
  const opponents = state.playerOrder
    .filter((id) => id !== actor.id)
    .map((id) => state.players[id]!);
  const region = Object.values(state.regions).find(
    (r) => r.control.kind === "unresolved",
  )!;
  const stock = region.followers[faction];
  const lead =
    actor.court[faction] - Math.max(...opponents.map((p) => p.court[faction]));
  // Do not supply an opponent with followers when waiting already wins.
  if (stock === 0 && (lead > 0 || winningIfAllPass)) return undefined;
  if (lead > Math.max(...opponents.map((p) => Math.min(stock, p.hand.length))))
    return undefined;

  let best:
    | { plan: TurnPlan; stock: number; production: number; effectCost: number }
    | undefined;
  for (const { card, effects } of cardChoices(state)) {
    for (const effect of effects) {
      const after = applyEffectOperations(state, actor.id, effect.operations);
      const summon = enumerateSummonChoices(after).find(
        (s) => s.kind === "follower" && s.faction === faction,
      );
      if (!summon) continue;
      const plan: TurnPlan = {
        kind: "card",
        playerId: actor.id,
        baseTurnSequence: state.turnSequence,
        cardId: card.id,
        effect,
        summon,
      };
      const next = simulate(state, plan);
      const left = Object.values(next.regions).reduce(
        (sum, r) => sum + r.followers[faction],
        0,
      );
      const production =
        card.type === `${faction}-support`
          ? 2
          : card.type === "assemble"
            ? 1
            : 0;
      const effectCost = Number(effect.kind !== "no-effect");
      if (
        !best ||
        left < best.stock ||
        (left === best.stock && production < best.production) ||
        (left === best.stock &&
          production === best.production &&
          effectCost < best.effectCost)
      )
        best = { plan, stock: left, production, effectCost };
    }
  }
  return best?.plan;
}
