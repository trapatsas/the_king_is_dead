import type { CardId, GameState } from "../game/domain";
import { IllegalTurnError } from "../game/errors";
import { freezeSnapshot } from "../game/immutable";
import { assertGameInvariants } from "../game/invariants";
import { copyChoice } from "../game/plans";
import { assertTurnContext } from "../game/turnContext";
import type { EffectPlan, SummonChoice, TurnDraft } from "../game/turnTypes";

export function beginTurn(state: GameState): TurnDraft {
  assertGameInvariants(state);
  const context = {
    playerId: state.activePlayerId,
    baseTurnSequence: state.turnSequence,
  };
  assertTurnContext(state, context);
  return freezeSnapshot({ ...context, selection: { kind: "unselected" } });
}

/** Reset is limited to the current turn. It can never roll back a commit. */
export function resetTurn(state: GameState, draft: TurnDraft): TurnDraft {
  assertTurnContext(state, draft);
  return beginTurn(state);
}

export function draftPass(draft: TurnDraft): TurnDraft {
  return freezeSnapshot({ ...draft, selection: { kind: "pass" } });
}

export function draftCard(draft: TurnDraft, cardId: CardId): TurnDraft {
  return freezeSnapshot({
    ...draft,
    selection: { kind: "card", cardId, effect: null, summon: null },
  });
}

export function draftEffect(draft: TurnDraft, effect: EffectPlan): TurnDraft {
  if (draft.selection.kind !== "card")
    throw new IllegalTurnError("Select a card before its effect");
  return freezeSnapshot({
    ...draft,
    selection: { ...draft.selection, effect: copyChoice(effect), summon: null },
  });
}

export function draftSummon(draft: TurnDraft, summon: SummonChoice): TurnDraft {
  if (draft.selection.kind !== "card" || draft.selection.effect === null) {
    throw new IllegalTurnError("Select an effect before summoning");
  }
  return freezeSnapshot({
    ...draft,
    selection: { ...draft.selection, summon: copyChoice(summon) },
  });
}
