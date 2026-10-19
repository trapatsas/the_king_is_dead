import type { CardInstance, GameState } from "../game/domain";
import { STANDARD_EFFECTS } from "../game/effects/standard";
import { applyEffectOperations } from "../game/effects/execute";
import { applySummonTrusted, enumerateSummonChoices } from "../game/summons";
import { finishCommittedTurn } from "../game/turns";
import type { EffectPlan, TurnPlan } from "../game/turnTypes";

export type Random = () => number;
export function seededRandom(seed: number): Random {
  let cursor = seed >>> 0;
  return () => {
    cursor = (cursor + 0x6d2b79f5) >>> 0;
    let x = cursor;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
export function pick<T>(values: readonly T[], random: Random): T {
  const value = values[Math.floor(random() * values.length)];
  if (value === undefined) throw new Error("Cannot sample an empty choice");
  return value;
}
export function passPlan(state: GameState): TurnPlan {
  return {
    kind: "pass",
    playerId: state.activePlayerId,
    baseTurnSequence: state.turnSequence,
  };
}
export function simulate(state: GameState, plan: TurnPlan): GameState {
  const after =
    plan.kind === "pass"
      ? state
      : applySummonTrusted(
          applyEffectOperations(state, plan.playerId, plan.effect.operations),
          plan.playerId,
          plan.summon,
        );
  return finishCommittedTurn(state, after, plan).state;
}

export interface CardChoices {
  readonly card: CardInstance;
  readonly effects: readonly EffectPlan[];
}
/** Enumerate once per position, preserving global maximum-tier and anti-undo.
 * Identical Assemble copies are the only cards collapsed. Regional effects are
 * not presumed equivalent: every effect and summon remains sampleable.
 */
export function cardChoices(state: GameState): CardChoices[] {
  const seen = new Set<string>();
  return state.players[state.activePlayerId]!.hand.flatMap((card) => {
    if (seen.has(card.type)) return [];
    seen.add(card.type);
    const rule = card.type === "plot" ? undefined : STANDARD_EFFECTS[card.type];
    if (!rule) throw new Error("Only Standard rules are available to search");
    const effects = rule.enumerate(state, state.activePlayerId, card);
    const tier = Math.max(...effects.map((effect) => effect.tier));
    return [
      { card, effects: effects.filter((effect) => effect.tier === tier) },
    ];
  });
}
export function sampleCardPlan(
  state: GameState,
  choices: CardChoices,
  random: Random,
): TurnPlan {
  const effect = pick(choices.effects, random);
  const after = applyEffectOperations(
    state,
    state.activePlayerId,
    effect.operations,
  );
  return {
    kind: "card",
    playerId: state.activePlayerId,
    baseTurnSequence: state.turnSequence,
    cardId: choices.card.id,
    effect,
    summon: pick(enumerateSummonChoices(after), random),
  };
}
export function randomPlan(state: GameState, random: Random): TurnPlan {
  const cards = cardChoices(state);
  return !cards.length || random() < 1 / 3
    ? passPlan(state)
    : sampleCardPlan(state, pick(cards, random), random);
}
