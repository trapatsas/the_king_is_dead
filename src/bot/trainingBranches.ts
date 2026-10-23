import type { GameState } from "../game/domain";
import { applyEffectOperations } from "../game/effects/execute";
import { sameChoice } from "../game/plans";
import { enumerateSummonChoices } from "../game/summons";
import type { TurnPlan } from "../game/turnTypes";
import { createInformedPolicy } from "./informed";
import { passPlan, seededRandom } from "./simulation";

/** Include the recorded move, passing, and alternate summons for the same
 * effect before broader teacher proposals. These are moves, never labels. */
export function trainingBranchPlans(
  state: GameState,
  recorded: TurnPlan,
  limit: number,
): TurnPlan[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32)
    throw new Error("Branch limit must be between 1 and 32");
  const plans: TurnPlan[] = [];
  const add = (plan: TurnPlan) => {
    if (plans.length < limit && !plans.some((old) => sameChoice(old, plan)))
      plans.push(plan);
  };
  add(recorded);
  add(passPlan(state));
  if (recorded.kind === "card") {
    const after = applyEffectOperations(
      state,
      recorded.playerId,
      recorded.effect.operations,
    );
    for (const summon of enumerateSummonChoices(after))
      add({ ...recorded, summon });
  }
  const options = createInformedPolicy().propose!(
    state,
    seededRandom(2026),
    "root",
  );
  // Include each summon faction rather than spending the budget on several
  // equivalent effects that all collect the same kind of follower.
  const factions = new Set<string>();
  for (const { plan } of options) {
    if (plan.kind !== "card" || plan.summon.kind !== "follower") continue;
    if (factions.has(plan.summon.faction)) continue;
    factions.add(plan.summon.faction);
    add(plan);
  }
  for (const { plan } of options) add(plan);
  return plans;
}
