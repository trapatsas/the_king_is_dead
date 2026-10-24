import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { RegionId } from "../game/domain";
import type { GameSession } from "../game/events";
import { Board, RegionTrack } from "./Board";
import type { FollowerPick } from "./effectChoices";
import { GameLogPanel } from "./GameLogPanel";
import { HeaderSlot } from "./headerSlot";
import { title } from "./presentation";
import { Result } from "./Result";
import { CourtsPanel, StruggleNotice, SupplyPanel } from "./TablePanels";
import {
  BotPanel,
  CommitBar,
  EffectChoicePanel,
  HandPanel,
  PlotPanel,
  SummonPanel,
  TurnSteps,
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
  const headerSlot = useContext(HeaderSlot);
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
    if (step === "choose-summon") {
      const follower = mainRef.current?.querySelector<HTMLElement>(
        ".map .follower-eligible",
      );
      const zero = plannerRef.current?.querySelector<HTMLElement>(
        ".summon-choices button",
      );
      (follower ?? zero)?.focus({ preventScroll: true });
      return;
    }
    if (step === "choose-effect") {
      const listedChoice = plannerRef.current?.querySelector<HTMLElement>(
        ".effect-alternatives[open] .choices button",
      );
      const boardChoice =
        mainRef.current?.querySelector<HTMLElement>(BOARD_CHOICES);
      (listedChoice ?? boardChoice)?.focus({
        preventScroll: true,
      });
      return;
    }
    const selector =
      phase === "plot-choice"
        ? ".plot-choice-button"
        : step === "ready"
          ? ".turn-primary"
          : ".action-card:not(:disabled), .turn-primary";
    const target = plannerRef.current?.querySelector<HTMLElement>(selector);
    const firstCard = plannerRef.current?.querySelector<HTMLElement>(
      ".action-card:not(:disabled)",
    );
    (step === "choose-turn" ? (firstCard ?? target) : target)?.focus({
      preventScroll: true,
    });
  }, [visible, step, decisionKey, phase]);

  // Phones dock the planner over the page; the map sizes itself to the space
  // left above it, so legal targets and End Turn are on screen together.
  useLayoutEffect(() => {
    const planner = plannerRef.current;
    const main = mainRef.current;
    if (!planner || !main || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      main.style.setProperty("--dock-h", `${planner.offsetHeight}px`),
    );
    observer.observe(planner);
    return () => observer.disconnect();
  }, []);

  // Announce each new power struggle briefly wherever the report is out of
  // view. Visual only: the report's own live region already speaks it.
  const [toast, setToast] = useState<string | null>(null);
  const seenNotices = useRef(turn.notices.length);
  useEffect(() => {
    if (turn.notices.length <= seenNotices.current) return;
    seenNotices.current = turn.notices.length;
    setToast(turn.notices.at(-1) ?? null);
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [turn.notices]);

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
        ? "Summon one follower into your court"
        : "No followers remain · confirm zero summon in the turn panel"
      : (decision?.label ?? null);
  const finished = phase === "finished";
  const status = (
    <div className="game-status">
      <h1 title={phase === "turn" ? `${targetPlayer}’s turn` : undefined}>
        {finished
          ? "The kingdom has spoken"
          : phase === "plot-choice"
            ? "One final allegiance"
            : `${targetPlayer}’s turn`}
      </h1>
      <p className="game-meta">
        <span className="eyebrow">
          {title(turn.mode)} kingdom
          {table.seed !== null && ` · seed ${table.seed}`}
        </span>
        <span className="turn-indicator">TURN {table.turn}</span>
        {!finished && (
          <span
            className="pass-meter"
            title="When every player passes in a row, the next power struggle resolves."
          >
            <span className="pips" aria-hidden="true">
              {Array.from({ length: turn.playerCount }, (_, index) => (
                <span
                  key={index}
                  className={index < table.passes ? "on" : ""}
                />
              ))}
            </span>
            <span>
              {table.passes}/{turn.playerCount}{" "}
              <span className="pass-word">consecutive </span>passes
            </span>
          </span>
        )}
        {gameId && (
          <button
            className="game-id quiet"
            onClick={onOpenLog}
            aria-label={`Open log for game ${gameId}`}
            title={gameId}
          >
            Log · <span>{gameId.slice(5, 13)}</span>
          </button>
        )}
      </p>
    </div>
  );
  return (
    <main
      className={`game ${finished ? "is-finished" : "is-playing"} ${turn.bot.active ? "is-bot-turn" : ""}`}
      ref={mainRef}
    >
      {headerSlot ? createPortal(status, headerSlot) : status}
      {toast && (
        <div className="struggle-toast" aria-hidden="true">
          <span className="eyebrow">Power struggle</span>
          {toast}
        </div>
      )}
      <div className="game-rail">
        <CourtsPanel
          table={table}
          activePlayer={targetPlayer}
          lastMoves={turn.lastMoves}
        />
        <SupplyPanel table={table} />
        <StruggleNotice notices={turn.notices} />
      </div>
      <div className="game-board">
        <RegionTrack
          table={table}
          choices={turn.regionOptions}
          onRegion={turn.regionOptions.length ? selectRegion : null}
          selectedRegions={turn.selectedRegions}
        />
        <Board
          table={table}
          choices={turn.regionOptions}
          onRegion={turn.regionOptions.length ? selectRegion : null}
          followerChoices={turn.followerOptions}
          onFollower={turn.followerOptions.length ? selectFollower : null}
          selectedFollowers={turn.selectedFollowers}
          instruction={boardInstruction}
        />
      </div>
      <aside
        ref={plannerRef}
        className="planner"
        aria-label="Turn planner"
        data-step={turn.planning ? step : phase}
      >
        <div className="planner-body">
          {turn.bot.active && <BotPanel turn={turn} player={targetPlayer} />}
          {visible && phase === "plot-choice" && (
            <PlotPanel player={targetPlayer} onChoose={actions.choosePlot} />
          )}
          {turn.planning && (
            <>
              <TurnSteps turn={turn} />
              <HandPanel turn={turn} actions={actions} />
              <EffectChoicePanel turn={turn} actions={actions} />
              <SummonPanel turn={turn} actions={actions} />
            </>
          )}
          {turn.result && <Result result={turn.result} />}
          {finished && turn.result && <GameLogPanel entries={turn.log} />}
          {turn.error && (
            <p role="alert" className="error">
              {turn.error}
            </p>
          )}
        </div>
        {turn.planning && <CommitBar turn={turn} actions={actions} />}
      </aside>
    </main>
  );
}
