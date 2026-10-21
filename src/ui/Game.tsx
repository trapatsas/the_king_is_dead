import { useEffect, useRef } from "react";
import type { RegionId } from "../game/domain";
import type { GameSession } from "../game/events";
import { Board, RegionTrack } from "./Board";
import type { FollowerPick } from "./effectChoices";
import { GameLogPanel } from "./GameLogPanel";
import { BOT_STRATEGY_LABELS, title } from "./presentation";
import { Result } from "./Result";
import {
  CourtsPanel,
  HowToPlay,
  StruggleNotice,
  SupplyPanel,
} from "./TablePanels";
import {
  CommitBar,
  EffectChoicePanel,
  FinishedPanel,
  HandPanel,
  PlanSummary,
  PlotPanel,
  PrivacyCurtain,
  SummonPanel,
} from "./TurnPanels";
import { useHotseatTurn } from "./useHotseatTurn";

/** The numbered struggle track and the map hold the clickable board targets. */
const BOARD_AREAS = ".region-track, .map";
const BOARD_CHOICES =
  ".region-track button:not(:disabled), .map button:not(:disabled)";

/** Wrap every action so it first records where the choice came from. */
function markOrigin<T extends Record<string, (...args: never[]) => void>>(
  actions: T,
  mark: () => void,
): T {
  return Object.fromEntries(
    Object.entries(actions).map(([name, action]) => [
      name,
      (...args: never[]) => {
        mark();
        action(...args);
      },
    ]),
  ) as T;
}

export function Game({
  initialSession,
  onCommit,
  gameId,
  onOpenLog,
}: {
  initialSession: GameSession;
  onCommit?: (session: GameSession) => void;
  gameId?: string;
  onOpenLog?: () => void;
}) {
  const turn = useHotseatTurn(initialSession, onCommit);
  const { table, visible, step, phase, targetPlayer, decision } = turn;
  const mainRef = useRef<HTMLElement>(null);
  const plannerRef = useRef<HTMLElement>(null);
  const choiceOrigin = useRef<"board" | "panel">("panel");
  const decisionKey = decision?.key;

  useEffect(() => {
    if (!visible) return;
    if (
      choiceOrigin.current === "board" &&
      (step === "choose-effect" || step === "choose-summon")
    ) {
      // Board picks keep focus on the board without scrolling to the sidebar.
      // The control just used is often disabled by its own pick, so move to the
      // next legal board target rather than letting focus fall to <body>.
      const active = document.activeElement;
      if (
        active instanceof HTMLButtonElement &&
        !active.disabled &&
        active.closest(BOARD_AREAS) !== null
      )
        return;
      const next = mainRef.current?.querySelector<HTMLElement>(BOARD_CHOICES);
      const fallback = plannerRef.current?.querySelector<HTMLElement>(
        step === "choose-effect" ? ".choices button" : ".summon-choices button",
      );
      (next ?? fallback)?.focus({ preventScroll: true });
      return;
    }
    const selector =
      phase === "plot-choice"
        ? ".plot-choice-button"
        : step === "choose-effect"
          ? ".choices button"
          : step === "choose-summon"
            ? ".summon-choices button"
            : step === "ready"
              ? ".plan-summary"
              : ".action-card:not(:disabled), .pass-button";
    plannerRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [visible, step, decisionKey, phase]);

  // Sidebar controls return keyboard focus to the planner flow.
  const actions = markOrigin(turn.actions, () => {
    choiceOrigin.current = "panel";
  });
  function selectRegion(region: RegionId) {
    choiceOrigin.current = "board";
    turn.actions.pick(`region:${region}`);
  }
  function selectFollower(pick: FollowerPick) {
    choiceOrigin.current = "board";
    if (step === "choose-summon") turn.actions.summonFollower(pick);
    else turn.actions.pick(`follower:${pick.regionId}:${pick.faction}`);
  }

  const boardInstruction = !visible
    ? null
    : step === "choose-summon"
      ? turn.followerOptions.length
        ? "Preview · Summon one follower into your court"
        : "Preview · No followers remain; confirm zero summon in the turn panel"
      : (decision?.label ?? null);
  return (
    <main className="game-layout" ref={mainRef}>
      <section className="game-heading">
        <div>
          <span className="eyebrow">
            {title(turn.mode)} kingdom
            {table.seed !== null && ` · seed ${table.seed}`}
          </span>
          <h1>
            {phase === "finished"
              ? "The kingdom has spoken"
              : phase === "plot-choice"
                ? "One final allegiance"
                : `${targetPlayer}’s turn`}
          </h1>
          {gameId && (
            <button
              className="game-id quiet"
              onClick={onOpenLog}
              aria-label={`Open log for game ${gameId}`}
            >
              Game ID: <span>{gameId}</span>
            </button>
          )}
        </div>
        <div className="turn-indicator">
          TURN {table.turn}
          <span>
            {table.passes}/{turn.playerCount} consecutive passes
          </span>
        </div>
      </section>
      <HowToPlay />
      {turn.result && <Result result={turn.result} />}
      {phase === "finished" && turn.result && (
        <GameLogPanel entries={turn.log} />
      )}
      <StruggleNotice notices={turn.notices} />
      <RegionTrack
        table={table}
        choices={turn.regionOptions}
        onRegion={turn.regionOptions.length ? selectRegion : null}
        selectedRegions={turn.selectedRegions}
      />
      <div className="table-layout">
        <div>
          <Board
            table={table}
            choices={turn.regionOptions}
            onRegion={turn.regionOptions.length ? selectRegion : null}
            followerChoices={turn.followerOptions}
            onFollower={turn.followerOptions.length ? selectFollower : null}
            selectedFollowers={turn.selectedFollowers}
            instruction={boardInstruction}
          />
          <SupplyPanel table={table} />
          <CourtsPanel
            table={table}
            activePlayer={targetPlayer}
            lastMoves={turn.lastMoves}
          />
        </div>
        <aside
          ref={plannerRef}
          className="turn-panel"
          aria-label="Turn planner"
        >
          {turn.bot.active && (
            <section aria-label="Bot turn" aria-busy={!turn.bot.error}>
              <span className="eyebrow">
                {BOT_STRATEGY_LABELS[turn.bot.strategy]} opponent
              </span>
              <h2>
                {turn.bot.error
                  ? "Bot turn paused"
                  : turn.bot.loading
                    ? "Loading learned model"
                    : `${targetPlayer} is thinking`}
              </h2>
              {turn.bot.error ? (
                <>
                  <p role="alert" className="error">
                    {turn.bot.error}
                  </p>
                  <button className="primary" onClick={turn.bot.retry}>
                    Retry bot turn
                  </button>
                </>
              ) : (
                <p role="status">
                  Considering the court, the next struggle, and possible
                  replies…
                </p>
              )}
            </section>
          )}
          {phase !== "finished" && !visible && !turn.bot.active && (
            <PrivacyCurtain player={targetPlayer} onReveal={actions.reveal} />
          )}
          {visible && phase === "plot-choice" && (
            <PlotPanel player={targetPlayer} onChoose={actions.choosePlot} />
          )}
          {turn.planning && (
            <>
              <HandPanel turn={turn} actions={actions} />
              <EffectChoicePanel turn={turn} actions={actions} />
              <SummonPanel turn={turn} actions={actions} />
              <PlanSummary turn={turn} />
              <CommitBar turn={turn} actions={actions} />
            </>
          )}
          {phase === "finished" && <FinishedPanel />}
          {turn.error && (
            <p role="alert" className="error">
              {turn.error}
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}
