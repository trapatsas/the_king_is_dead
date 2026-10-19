import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { SetupConfig } from "../game/domain";
import type { GameSession } from "../game/events";
import { archiveSnapshot, newGameId, saveArchive } from "../app/gameArchive";
import { GameHistory } from "./GameHistory";
import { createGame } from "../game/setup";
import { GameErrorBoundary } from "./ErrorBoundary";
import { Game } from "./Game";
import { Setup } from "./Setup";
import { ThemeToggle } from "./ThemeToggle";

export { Game } from "./Game";

function LeaveDialog({
  onKeep,
  onLeave,
  returnFocus,
}: {
  onKeep: () => void;
  onLeave: () => void;
  returnFocus: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (typeof dialog?.showModal === "function") dialog.showModal();
    else dialog?.setAttribute("open", "");
    keepRef.current?.focus();
    return () => {
      if (typeof dialog?.close === "function") dialog.close();
      // Return focus to the opener ("New game") when it still exists.
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
    };
  }, [returnFocus]);
  return (
    <dialog
      ref={ref}
      className="new-game-dialog"
      aria-label="Start a new game"
      onCancel={(event) => {
        event.preventDefault();
        onKeep();
      }}
    >
      <h2>Leave this kingdom?</h2>
      <p>
        This game cannot be resumed after leaving. Its saved public log remains
        available in Game history.
      </p>
      <button ref={keepRef} onClick={onKeep}>
        Keep playing
      </button>
      <button onClick={onLeave}>Leave game</button>
    </dialog>
  );
}

interface ActiveGame {
  /** Unique per started game, so a repeated seed never reuses old Game state. */
  readonly id: string;
  readonly createdAt: string;
  /** Bumped by error recovery to remount from the latest committed session. */
  readonly attempt: number;
  readonly session: GameSession;
}

export function App({ initialSession }: { initialSession?: GameSession }) {
  const [game, setGame] = useState<ActiveGame | null>(() =>
    initialSession
      ? {
          id: newGameId(),
          createdAt: new Date().toISOString(),
          attempt: 0,
          session: initialSession,
        }
      : null,
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyGameId, setHistoryGameId] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    if (game)
      setStorageError(
        !saveArchive(archiveSnapshot(game.id, game.createdAt, game.session)),
      );
  }, [game]);
  // Latest committed session; read only for error recovery, so commits do not
  // re-render the App shell.
  const latest = useRef<GameSession | null>(initialSession ?? null);
  const newGameRef = useRef<HTMLButtonElement>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  function start(config: SetupConfig) {
    try {
      const session = createGame(config);
      latest.current = session;
      setGame({
        id: newGameId(),
        createdAt: new Date().toISOString(),
        attempt: 0,
        session,
      });
      setSetupError(null);
    } catch {
      setSetupError("This game could not be set up. Check the settings.");
    }
  }
  function leave() {
    latest.current = null;
    setGame(null);
    setConfirmNew(false);
  }
  return (
    <>
      <header className="app-header">
        <span className="wordmark">
          <span aria-hidden="true">♜</span> THE KING IS DEAD
        </span>
        <span className="edition">PROJECT RULESET · 2–3 PLAYERS</span>
        <div className="header-actions">
          <ThemeToggle />
          <button
            className="quiet history-button"
            onClick={() => {
              setHistoryGameId(null);
              setHistoryOpen(true);
            }}
          >
            Game history
          </button>
          {game && (
            <button
              ref={newGameRef}
              className="quiet"
              onClick={() => setConfirmNew(true)}
            >
              New game
            </button>
          )}
        </div>
      </header>
      {historyOpen && (
        <GameHistory
          initialGameId={historyGameId}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {storageError && (
        <p role="status" className="notice archive-warning">
          The latest game log could not be saved in this browser. Playing can
          continue; check browser storage before leaving.
        </p>
      )}
      {confirmNew && (
        <LeaveDialog
          onKeep={() => setConfirmNew(false)}
          onLeave={leave}
          returnFocus={newGameRef}
        />
      )}
      {game ? (
        <GameErrorBoundary
          key={`${game.id}:${game.attempt}`}
          onRetry={() =>
            setGame({
              ...game,
              attempt: game.attempt + 1,
              session: latest.current ?? game.session,
            })
          }
          onLeave={leave}
        >
          <Game
            initialSession={game.session}
            gameId={game.id}
            onOpenLog={() => {
              setHistoryGameId(game.id);
              setHistoryOpen(true);
            }}
            onCommit={(session) => {
              latest.current = session;
              setStorageError(
                !saveArchive(archiveSnapshot(game.id, game.createdAt, session)),
              );
            }}
          />
        </GameErrorBoundary>
      ) : (
        <>
          {setupError && (
            <p role="alert" className="error">
              {setupError}
            </p>
          )}
          <Setup onStart={start} />
        </>
      )}
      <footer className="app-footer">
        An empty throne. A divided kingdom. An uncertain alliance.
      </footer>
    </>
  );
}
