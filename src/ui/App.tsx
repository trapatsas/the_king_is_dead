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
      <button ref={keepRef} onClick={onKeep}>
        Keep playing
      </button>
      <button onClick={onLeave}>
        {resuming ? "Resume saved game" : "Leave game"}
      </button>
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
  return (
    <>
      <header className={`app-header ${game ? "app-header-playing" : ""}`}>
        <span className="wordmark">
          <span aria-hidden="true">♜</span> THE KING IS DEAD
        </span>
        {game && (
          <span
            role="status"
            aria-label="Game save status"
            className="save-status"
          >
            {sqliteState === "saving"
              ? "Saving…"
              : sqliteState === "error"
                ? "Save pending"
                : "Saved"}
          </span>
        )}
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
          onResume={resume}
        />
      )}
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
          The playable position could not be saved or restored in this browser.
          Game logs and SQLite saves are separate.
        </p>
      )}
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
      <footer className={`app-footer ${game ? "app-footer-playing" : ""}`}>
        An empty throne. A divided kingdom. An uncertain alliance.
      </footer>
    </>
  );
}
