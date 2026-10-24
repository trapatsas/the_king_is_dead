import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { SetupConfig } from "../game/domain";
import type { GameSession } from "../game/events";
import {
  clearActiveGame,
  loadActiveGame,
  parseSavedGame,
  saveGamePosition,
  saveActiveGame,
} from "../app/activeGame";
import type { SavedGame } from "../app/activeGame";
import { archiveSnapshot, newGameId, saveArchive } from "../app/gameArchive";
import { StorageClient } from "../app/storageClient";
import type { SaveState } from "../app/storageClient";
import { GameHistory } from "./GameHistory";
import { HeaderSlot } from "./headerSlot";
import { HelpIcon, HistoryIcon, NewGameIcon } from "./icons";
import { HelpDialog } from "./TablePanels";
import { useModal } from "./useModal";
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
  resuming = false,
}: {
  onKeep: () => void;
  onLeave: () => void;
  returnFocus: RefObject<HTMLElement | null>;
  resuming?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  // Return focus to the opener ("New game") when it still exists.
  useModal(ref, keepRef, returnFocus);
  return (
    <dialog
      ref={ref}
      className="new-game-dialog"
      aria-label={resuming ? "Resume saved game" : "Start a new game"}
      onCancel={(event) => {
        event.preventDefault();
        onKeep();
      }}
    >
      <h2>{resuming ? "Switch to the saved game?" : "Leave this kingdom?"}</h2>
      <p>
        Your current game is saved in Game history and can be resumed later.
        Only uncommitted choices will be discarded.
      </p>
      <div className="dialog-actions">
        <button onClick={onLeave}>
          {resuming ? "Resume saved game" : "Leave game"}
        </button>
        <button ref={keepRef} className="primary" onClick={onKeep}>
          Keep playing
        </button>
      </div>
    </dialog>
  );
}

interface ActiveGame extends SavedGame {
  /** Bumped by error recovery to remount from the latest committed session. */
  readonly attempt: number;
}

export function App({ initialSession }: { initialSession?: GameSession }) {
  const [recovery] = useState(() =>
    initialSession ? { game: null, error: false } : loadActiveGame(),
  );
  const [game, setGame] = useState<ActiveGame | null>(() =>
    initialSession
      ? {
          version: 1,
          id: newGameId(),
          createdAt: new Date().toISOString(),
          attempt: 0,
          session: initialSession,
        }
      : recovery.game
        ? { ...recovery.game, attempt: 0 }
        : null,
  );
  const [recoveryError, setRecoveryError] = useState(recovery.error);
  const [pendingResume, setPendingResume] = useState<SavedGame | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const [historyGameId, setHistoryGameId] = useState<string | null>(null);
  const [resumeToken, setResumeToken] = useState(() =>
    new URLSearchParams(window.location.hash.slice(1)).get("resume"),
  );
  const legacyRequests = useRef(new Map<string, Promise<SavedGame>>());
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const capture = useRef<StorageClient | null>(null);
  const [sqliteState, setSqliteState] = useState<SaveState>("saved");
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    if (game) {
      setRecoveryError(
        !saveActiveGame({ ...game, session: latest.current ?? game.session }),
      );
      setStorageError(
        !saveArchive(archiveSnapshot(game.id, game.createdAt, game.session)),
      );
    }
  }, [game]);
  // Latest committed session; read only for error recovery, so commits do not
  // re-render the App shell.
  const latest = useRef<GameSession | null>(game?.session ?? null);
  useEffect(() => {
    const changed = () =>
      setResumeToken(
        new URLSearchParams(window.location.hash.slice(1)).get("resume"),
      );
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    if (!resumeToken) return;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    fragment.delete("resume");
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname +
        window.location.search +
        (fragment.size ? "#" + fragment.toString() : ""),
    );
    let active = true;
    if (!/^[a-f0-9]{64}$/.test(resumeToken)) {
      setResumeNotice("This recovery link is invalid or expired.");
      return;
    }
    let request = legacyRequests.current.get(resumeToken);
    if (!request) {
      request = (async () => {
        const response = await fetch("/api/resume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: resumeToken }),
        });
        if (!response.ok) throw new Error("Recovery link unavailable");
        const saved = parseSavedGame(JSON.stringify(await response.json()));
        if (
          !saveGamePosition(saved) ||
          !saveArchive(
            archiveSnapshot(saved.id, saved.createdAt, saved.session),
          )
        )
          throw new Error("Could not save the recovered position");
        return saved;
      })();
      legacyRequests.current.set(resumeToken, request);
    }
    void request.then(
      (saved) => {
        if (!active) return;
        legacyRequests.current.delete(resumeToken);
        setResumeToken(null);
        setHistoryGameId(saved.id);
        setHistoryOpen(true);
        setResumeNotice(
          "Your recovered game is ready. Select Resume game in Game history.",
        );
      },
      () => {
        if (active) {
          legacyRequests.current.delete(resumeToken);
          setResumeToken(null);
          setResumeNotice(
            "This saved game could not be recovered. The link may have expired, or browser storage is unavailable. Your current game has not changed.",
          );
        }
      },
    );
    return () => {
      active = false;
    };
  }, [resumeToken]);
  useEffect(() => {
    let active = true;
    const client = new StorageClient((state) => {
      if (active) setSqliteState(state);
    });
    capture.current = client;
    const retry = () => void client.flush();
    retry();
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    // A restarted local API does not trigger the browser's online event.
    const timer = window.setInterval(retry, 10000);
    return () => {
      active = false;
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
      window.clearInterval(timer);
      capture.current = null;
    };
  }, []);
  useEffect(() => {
    if (game) capture.current?.capture(game.id, latest.current ?? game.session);
  }, [game?.id]);
  const newGameRef = useRef<HTMLButtonElement>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  function start(config: SetupConfig) {
    document.documentElement.scrollTop = 0;
    try {
      const session = createGame(config);
      latest.current = session;
      setGame({
        version: 1,
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
    clearActiveGame();
    latest.current = null;
    setGame(null);
    setConfirmNew(false);
  }
  function activate(saved: SavedGame) {
    document.documentElement.scrollTop = 0;
    latest.current = saved.session;
    setGame({
      ...saved,
      attempt: game?.id === saved.id ? game.attempt + 1 : 0,
    });
    setRecoveryError(!saveActiveGame(saved));
    setPendingResume(null);
    setConfirmNew(false);
    setHistoryOpen(false);
    setResumeNotice(null);
  }
  function resume(saved: SavedGame) {
    setHistoryOpen(false);
    setResumeNotice(null);
    if (game?.id === saved.id) {
      if (
        saved.session.state.eventSequence >
        (latest.current?.state.eventSequence ?? -1)
      )
        activate(saved);
      return;
    }
    if (game && latest.current?.state.phase !== "finished")
      setPendingResume(saved);
    else activate(saved);
  }
  const saveLabel =
    sqliteState === "saving"
      ? "Saving…"
      : sqliteState === "error"
        ? "Save pending"
        : "Saved";
  return (
    <div className={`app-shell ${game ? "is-playing" : "is-setup"}`}>
      <header className="app-header">
        <span className="wordmark" title="The King Is Dead">
          <span aria-hidden="true">♜</span>
          <span className="wordmark-text">The King Is Dead</span>
        </span>
        <div className="header-game" ref={setHeaderSlot} />
        {game && (
          <span
            role="status"
            aria-label="Game save status"
            className={`save-status save-${sqliteState}`}
            title={saveLabel}
          >
            <span className="save-dot" aria-hidden="true" />
            <span className="save-text">{saveLabel}</span>
          </span>
        )}
        <nav className="header-actions" aria-label="Game menu">
          <button
            className="icon-button help-button"
            onClick={() => setHelpOpen(true)}
            title="How to play"
          >
            <HelpIcon />
            <span className="button-label">How to play</span>
          </button>
          <button
            className="icon-button history-button"
            onClick={() => {
              setHistoryGameId(null);
              setHistoryOpen(true);
            }}
            title="Game history"
          >
            <HistoryIcon />
            <span className="button-label">Game history</span>
          </button>
          {game && (
            <button
              ref={newGameRef}
              className="icon-button"
              onClick={() => setConfirmNew(true)}
              title="New game"
            >
              <NewGameIcon />
              <span className="button-label">New game</span>
            </button>
          )}
          <ThemeToggle />
        </nav>
      </header>
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      {historyOpen && (
        <GameHistory
          initialGameId={historyGameId}
          onClose={() => setHistoryOpen(false)}
          onResume={resume}
        />
      )}
      <div className="app-notices">
        {resumeNotice && (
          <p role="status" className="notice">
            {resumeNotice}
          </p>
        )}
        {sqliteState === "error" && (
          <p role="status" className="notice archive-warning">
            Some game saves are pending. Retrying automatically.{" "}
            <button onClick={() => void capture.current?.flush()}>
              Retry save
            </button>
          </p>
        )}
        {storageError && (
          <p role="status" className="notice archive-warning">
            The latest game log could not be saved in this browser. Playing can
            continue; check browser storage before leaving.
          </p>
        )}
        {recoveryError && (
          <p role="status" className="notice archive-warning">
            The playable position could not be saved or restored in this
            browser. Game logs and SQLite saves are separate.
          </p>
        )}
      </div>
      {(confirmNew || pendingResume) && (
        <LeaveDialog
          onKeep={() => {
            setConfirmNew(false);
            setPendingResume(null);
          }}
          onLeave={() => (pendingResume ? activate(pendingResume) : leave())}
          returnFocus={newGameRef}
          resuming={pendingResume !== null}
        />
      )}
      <HeaderSlot.Provider value={headerSlot}>
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
                setRecoveryError(!saveActiveGame({ ...game, session }));
                capture.current?.capture(game.id, session);
                setStorageError(
                  !saveArchive(
                    archiveSnapshot(game.id, game.createdAt, session),
                  ),
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
            <footer className="app-footer">
              An empty throne. A divided kingdom. An uncertain alliance.
            </footer>
          </>
        )}
      </HeaderSlot.Provider>
    </div>
  );
}
