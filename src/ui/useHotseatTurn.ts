import { useBotTurn } from "./useBotTurn";
import { useMemo, useState } from "react";
import {
  beginTurn,
  draftCard,
  draftEffect,
  draftPass,
  draftSummon,
  resetTurn,
} from "../app/draft";
import { choosePlot, endTurn } from "../app/session";
import type { Faction, RegionId } from "../game/domain";
import { IllegalTurnError } from "../game/errors";
import type { GameSession } from "../game/events";
import { turnEngine } from "../game/turns";
import type { SummonChoice, TurnDraft } from "../game/turnTypes";
import {
  beginEffectChoice,
  completedEffect,
  effectDecision,
  pickEffectOption,
  undoEffectPick,
} from "./effectChoices";
import type { EffectChoice, EffectOption, FollowerPick } from "./effectChoices";
import { projectFinishedLog, projectLastMoves } from "./finishedLog";
import { projectTable, publicNotices } from "./presentation";

function initialDraft(session: GameSession): TurnDraft | null {
  return session.state.phase === "turn" ? beginTurn(session.state) : null;
}

/** Engine rule errors are written for players. Anything else (an invariant
 * failure, say) can name hidden cards, so only a generic message is shown. */
function playerMessage(cause: unknown): string {
  return cause instanceof IllegalTurnError
    ? cause.message
    : "The turn could not be accepted. Reset Turn and try again.";
}

export function followerPicks(
  options: readonly (EffectOption | SummonChoice)[],
): FollowerPick[] {
  return options.flatMap((option) =>
    option.kind === "follower"
      ? [{ regionId: option.regionId, faction: option.faction }]
      : [],
  );
}

export function regionPicks(options: readonly EffectOption[]): RegionId[] {
  return options.flatMap((option) =>
    option.kind === "region" ? [option.regionId] : [],
  );
}

/**
 * Local hotseat controller. This is the only UI code that holds the full
 * session; everything it returns is either a redacted `getObservation`
 * projection or the active human player's own legal choices.
 */
export function useHotseatTurn(
  initialSession: GameSession,
  onCommit?: (session: GameSession) => void,
) {
  const [session, setSession] = useState(initialSession);
  const [draft, setDraft] = useState<TurnDraft | null>(() =>
    initialDraft(initialSession),
  );
  const [effectChoice, setEffectChoice] = useState<EffectChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { state } = session;
  const targetPlayer =
    state.phase === "plot-choice"
      ? (state.plot?.playerId ?? state.activePlayerId)
      : state.activePlayerId;
  const isHuman = state.players[targetPlayer]?.controller === "human";
  const visible = isHuman && state.phase !== "finished";
  const preview = useMemo(
    () => (draft ? turnEngine.previewTurn(state, draft) : null),
    [state, draft],
  );
  const shownState = visible && preview ? preview.state : state;
  const table = useMemo(
    () => projectTable(shownState, visible ? targetPlayer : null),
    [shownState, visible, targetPlayer],
  );
  const committed = useMemo(() => projectTable(state, null), [state]);
  const notices = useMemo(() => publicNotices(session.events), [session]);
  const lastMoves = useMemo(() => projectLastMoves(session.events), [session]);
  const log = useMemo(() => projectFinishedLog(session), [session]);
  const availableCardIds = useMemo(
    () =>
      visible && state.phase === "turn"
        ? turnEngine
            .getAvailableCards(state, targetPlayer)
            .map((card) => card.id)
        : [],
    [visible, state, targetPlayer],
  );

  const decision =
    visible && effectChoice ? effectDecision(effectChoice) : null;
  const picks = (visible ? effectChoice?.picks : undefined) ?? [];
  const summonChoices = preview?.summonChoices ?? [];
  const step = preview?.step ?? null;
  const selection = draft?.selection ?? null;

  function safely(action: () => void) {
    try {
      if (!isHuman) return;
      action();
      setError(null);
    } catch (cause) {
      setError(playerMessage(cause));
    }
  }
  function accept(next: GameSession) {
    setSession(next);
    setDraft(initialDraft(next));
    setEffectChoice(null);
    onCommit?.(next);
  }
  const bot = useBotTurn(session, accept);
  function updateEffectChoice(nextDraft: TurnDraft, choice: EffectChoice) {
    const effect = completedEffect(choice);
    setDraft(effect ? draftEffect(nextDraft, effect) : nextDraft);
    setEffectChoice(effect ? null : choice);
  }
  function requireDraft(): TurnDraft {
    if (draft === null) throw new IllegalTurnError("Normal turns have ended");
    return draft;
  }
  function chooseSummon(summon: SummonChoice) {
    setDraft(draftSummon(requireDraft(), summon));
  }

  const actions = {
    startCard: (cardId: string) =>
      safely(() => {
        const next = draftCard(requireDraft(), cardId);
        updateEffectChoice(
          next,
          beginEffectChoice(turnEngine.previewTurn(state, next).effectPlans),
        );
      }),
    pick: (key: string) =>
      safely(() => {
        if (!effectChoice) throw new IllegalTurnError("Choose a card first");
        updateEffectChoice(requireDraft(), pickEffectOption(effectChoice, key));
      }),
    undoPick: () =>
      safely(() => {
        if (effectChoice) setEffectChoice(undoEffectPick(effectChoice));
      }),
    summon: (choice: SummonChoice) => safely(() => chooseSummon(choice)),
    summonFollower: (pick: FollowerPick) =>
      safely(() => {
        const summon = summonChoices.find(
          (option) =>
            option.kind === "follower" &&
            option.regionId === pick.regionId &&
            option.faction === pick.faction,
        );
        if (summon) chooseSummon(summon);
      }),
    pass: () =>
      safely(() => {
        setDraft(draftPass(requireDraft()));
        setEffectChoice(null);
      }),
    reset: () =>
      safely(() => {
        setDraft(resetTurn(state, requireDraft()));
        setEffectChoice(null);
      }),
    endTurn: () => safely(() => accept(endTurn(session, requireDraft()))),
    choosePlot: (faction: Faction) =>
      safely(() =>
        accept(
          choosePlot(session, {
            playerId: targetPlayer,
            faction,
            baseEventSequence: state.eventSequence,
          }),
        ),
      ),
  };

  const selectedCard =
    selection?.kind === "card"
      ? (table.hand.find((card) => card.id === selection.cardId) ?? null)
      : null;
  return {
    table,
    bot,
    lastMoves,
    committed: {
      turn: committed.turn,
      passes: committed.passes,
      court:
        committed.players.find((player) => player.id === targetPlayer)?.court ??
        null,
    },
    mode: state.mode,
    phase: state.phase,
    result: state.result,
    playerCount: state.playerOrder.length,
    passCompletesRound:
      state.consecutivePasses + 1 === state.playerOrder.length,
    targetPlayer,
    visible,
    planning: visible && draft !== null && preview !== null,
    step,
    selection,
    selectedCard,
    availableCardIds,
    decision,
    picks,
    summonChoices,
    plan: preview?.plan ?? null,
    regionOptions: decision ? regionPicks(decision.options) : [],
    followerOptions: !visible
      ? []
      : step === "choose-summon"
        ? followerPicks(summonChoices)
        : decision
          ? followerPicks(decision.options)
          : [],
    selectedFollowers: followerPicks(picks),
    selectedRegions: regionPicks(picks),
    notices,
    log,
    error,
    actions,
  };
}
export type HotseatTurn = ReturnType<typeof useHotseatTurn>;
