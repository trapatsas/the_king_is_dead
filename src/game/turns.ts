import type {
  CardId,
  CardInstance,
  GameState,
  PlayableCardType,
  PlayerId,
} from "./domain";
import type { CommitResult, TurnCommittedEvent } from "./events";
import { CardRulesNotImplementedError, IllegalTurnError } from "./errors";
import { applyEffectOperations } from "./effects/execute";
import { STANDARD_EFFECTS } from "./effects/standard";
import { nextSwapMemory } from "./effects/swaps";
import { freezeSnapshot } from "./immutable";
import { assertGameInvariants } from "./invariants";
import { copyChoice, sameChoice } from "./plans";
import { resolveNextStruggle } from "./struggles";
import { advanceEndgameTrusted, resolvePlotChoice } from "./endgame";
import { applySummon, enumerateSummonChoices } from "./summons";
import { assertTurnContext } from "./turnContext";
import type {
  DraftPreview,
  EffectPlan,
  TurnDraft,
  TurnPlan,
} from "./turnTypes";

/** Trusted engine extension point. Clients submit plans, never definitions. */
export interface CardEffectDefinition {
  enumerate(
    state: GameState,
    playerId: PlayerId,
    card: CardInstance,
  ): readonly EffectPlan[];
}
export type CardEffectRegistry = Readonly<
  Partial<Record<PlayableCardType, CardEffectDefinition>>
>;

function heldCard(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
): CardInstance {
  const card = state.players[playerId]?.hand.find(
    (candidate) => candidate.id === cardId,
  );
  if (card === undefined)
    throw new IllegalTurnError("Card is not in the active player's hand");
  if (card.type === "plot")
    throw new IllegalTurnError("Plot cannot be played during normal turns");
  return card;
}

export function createTurnEngine(definitions: CardEffectRegistry = {}) {
  const registry = { ...definitions };
  const sealPreview = (preview: DraftPreview): DraftPreview =>
    freezeSnapshot(copyChoice(preview));

  function enumerateEffectPlans(
    state: GameState,
    playerId: PlayerId,
    cardId: CardId,
  ): readonly EffectPlan[] {
    assertGameInvariants(state);
    assertTurnContext(state, {
      playerId,
      baseTurnSequence: state.turnSequence,
    });
    const card = heldCard(state, playerId, cardId);
    // heldCard rejects Plot, but keep narrowing explicit at this boundary.
    if (card.type === "plot")
      throw new IllegalTurnError("Plot cannot be played");
    const definition = registry[card.type];
    if (definition === undefined)
      throw new CardRulesNotImplementedError(card.type);
    const plans = definition.enumerate(state, playerId, card);
    for (const plan of plans) {
      if (
        !Number.isSafeInteger(plan.tier) ||
        plan.tier < 0 ||
        (card.type !== "spy" && plan.effectiveCard !== card.type) ||
        (plan.kind !== "effect" && plan.kind !== "no-effect") ||
        (plan.kind === "no-effect" &&
          (plan.operations.length !== 0 ||
            plan.reason.length === 0 ||
            plan.tier !== 0))
      ) {
        throw new IllegalTurnError("Invalid effect definition");
      }
    }
    const maximumTier = Math.max(...plans.map((plan) => plan.tier));
    return freezeSnapshot(
      copyChoice(plans.filter((plan) => plan.tier === maximumTier)),
    );
  }

  function getAvailableCards(
    state: GameState,
    playerId: PlayerId,
  ): readonly CardInstance[] {
    assertGameInvariants(state);
    assertTurnContext(state, {
      playerId,
      baseTurnSequence: state.turnSequence,
    });
    const player = state.players[playerId];
    if (player === undefined) throw new IllegalTurnError("Unknown player");
    return freezeSnapshot(
      copyChoice(
        player.hand.filter(
          (card) => card.type !== "plot" && registry[card.type] !== undefined,
        ),
      ),
    );
  }

  function previewTurn(state: GameState, draft: TurnDraft): DraftPreview {
    assertGameInvariants(state);
    assertTurnContext(state, draft);
    const { playerId, baseTurnSequence } = draft;
    const selection = draft.selection;
    const initial: DraftPreview = {
      state,
      step: "choose-turn",
      effectPlans: [],
      summonChoices: [],
      plan: null,
    };
    if (selection.kind === "unselected") return sealPreview(initial);
    if (selection.kind === "pass") {
      return sealPreview({
        ...initial,
        step: "ready",
        plan: { kind: "pass", playerId, baseTurnSequence },
      });
    }
    if (selection.kind !== "card")
      throw new IllegalTurnError("Unknown turn selection");
    const effectPlans = enumerateEffectPlans(state, playerId, selection.cardId);
    if (selection.effect === null) {
      return sealPreview({ ...initial, effectPlans, step: "choose-effect" });
    }
    const effect = effectPlans.find((plan) =>
      sameChoice(plan, selection.effect),
    );
    if (effect === undefined)
      throw new IllegalTurnError(
        "Effect is not a currently legal maximum-tier plan",
      );
    const afterEffect = applyEffectOperations(
      state,
      playerId,
      effect.operations,
    );
    const summonChoices = enumerateSummonChoices(afterEffect);
    if (selection.summon === null) {
      return sealPreview({
        ...initial,
        state: afterEffect,
        effectPlans,
        summonChoices,
        step: "choose-summon",
      });
    }
    const summon = summonChoices.find((choice) =>
      sameChoice(choice, selection.summon),
    );
    if (summon === undefined)
      throw new IllegalTurnError("Invalid mandatory post-effect summon");
    return sealPreview({
      state: applySummon(afterEffect, playerId, summon),
      effectPlans,
      summonChoices,
      step: "ready",
      plan: {
        kind: "card",
        playerId,
        baseTurnSequence,
        cardId: selection.cardId,
        effect,
        summon,
      },
    });
  }

  function commitTurn(state: GameState, submitted: TurnPlan): CommitResult {
    const preview = previewTurn(state, {
      playerId: submitted.playerId,
      baseTurnSequence: submitted.baseTurnSequence,
      selection:
        submitted.kind === "pass"
          ? { kind: "pass" }
          : {
              kind: "card",
              cardId: submitted.cardId,
              effect: submitted.effect,
              summon: submitted.summon,
            },
    });
    const plan = preview.plan;
    if (plan === null) throw new IllegalTurnError("Turn is incomplete");
    // Reject malformed discriminants/additional fields; log the canonical choice.
    if (!sameChoice(plan, submitted))
      throw new IllegalTurnError("Invalid turn plan");
    const result = finishCommittedTurn(state, preview.state, plan);
    assertGameInvariants(result.state);
    return freezeSnapshot(copyChoice(result));
  }

  return Object.freeze({
    getAvailableCards,
    enumerateEffectPlans,
    previewTurn,
    commitTurn,
    resolvePlotChoice,
  });
}

/** Shared production rules for every Standard card; Cunning arrives later. */
export const turnEngine = createTurnEngine(STANDARD_EFFECTS);
export type TurnEngine = ReturnType<typeof createTurnEngine>;

/** Internal trusted transition shared by validated commits and search.
 * Callers must supply a legal complete plan and its post-summon position.
 * Does not validate, clone or freeze; never expose this as a submission API.
 */
export function finishCommittedTurn(
  state: GameState,
  afterSummon: GameState,
  plan: TurnPlan,
): CommitResult {
  const seat = state.playerOrder.indexOf(plan.playerId);
  const nextPlayer = state.playerOrder[(seat + 1) % state.playerOrder.length];
  if (nextPlayer === undefined)
    throw new IllegalTurnError("Missing next player");
  const actionSequence = state.actionSequence + (plan.kind === "card" ? 1 : 0);
  let next: GameState = {
    ...afterSummon,
    activePlayerId: nextPlayer,
    turnSequence: state.turnSequence + 1,
    actionSequence,
    eventSequence: state.eventSequence + 1,
    consecutivePasses: plan.kind === "pass" ? state.consecutivePasses + 1 : 0,
  };
  let card: CardInstance | null = null;
  if (plan.kind === "card") {
    card = heldCard(state, plan.playerId, plan.cardId);
    const player = next.players[plan.playerId];
    if (player === undefined) throw new IllegalTurnError("Unknown player");
    next = {
      ...next,
      lastSwap: nextSwapMemory(plan.playerId, actionSequence, plan.effect),
      players: {
        ...next.players,
        [player.id]: {
          ...player,
          hand: player.hand.filter((held) => held.id !== plan.cardId),
          discards: [...player.discards, card],
          lastActionSequence: actionSequence,
        },
      },
    };
  }
  const committed: TurnCommittedEvent = {
    type: "TurnCommitted",
    playerId: plan.playerId,
    eventSequence: next.eventSequence,
    turnSequence: next.turnSequence,
    actionSequence,
    plan,
    card,
  };
  let events: CommitResult["events"] = [committed];
  if (next.consecutivePasses === next.playerOrder.length) {
    const struggle = resolveNextStruggle(next, plan.playerId);
    next = struggle.state;
    events = [committed, ...struggle.events];
    if (next.phase === "scoring") {
      const ending = advanceEndgameTrusted(next, plan.playerId);
      next = ending.state;
      events = [...events, ...ending.events];
    }
  }
  return { state: next, events };
}
