import type { GameState } from "../../game/domain";
import { terminalUtility } from "../evaluation";
import { createInformedPolicy } from "../informed";
import type { SearchRequest, SearchResult } from "../search";
import { StandardBot } from "../search";
import { encodePosition, restoreValues } from "./features";
import { maskedValues } from "./model";
import type { ValueModel } from "./model";

export const ML_BOT_VERSION = "ml-mcts-v1";
export function evaluateLearned(state: GameState, model: ValueModel): number[] {
  if (state.result) return terminalUtility(state.result, state.playerOrder);
  if (!model.manifest.supportedSeats.includes(state.playerOrder.length))
    throw new Error("Model does not support this seat count");
  const encoded = encodePosition(state);
  const logits = model.predictBatch(encoded.features, 1);
  return restoreValues(maskedValues(logits, state.playerOrder.length), encoded);
}

/** First ablation: Informed search/priors/root rules, learned leaf evaluation.
 * No network work at weight zero; older profiles keep their original defaults. */
export class MlBot extends StandardBot {
  readonly modelId: string;
  readonly modelHash: string;
  constructor(model: ValueModel, weight = model.manifest.learnedWeight) {
    if (!Number.isFinite(weight) || weight < 0 || weight > 1)
      throw new Error("Invalid learned weight");
    const base = createInformedPolicy();
    const leaf = base.evaluateLeaf ?? base.evaluate;
    super({
      ...base,
      evaluateLeaf:
        weight === 0
          ? leaf
          : (state) => {
              if (state.result)
                return terminalUtility(state.result, state.playerOrder);
              const learned = evaluateLearned(state, model);
              if (weight === 1) return learned;
              const control = leaf(state);
              return learned.map(
                (v, i) => weight * v + (1 - weight) * control[i]!,
              );
            },
      explain: (plan) =>
        `Learned model ${model.manifest.modelId}: ${plan.kind === "pass" ? "preserve responses" : "improve the position"}.`,
    });
    this.modelId = model.manifest.modelId;
    this.modelHash = model.manifest.weightsSha256;
  }
  override search(request: SearchRequest): SearchResult {
    return {
      ...super.search(request),
      modelId: this.modelId,
      modelHash: this.modelHash,
    };
  }
}
