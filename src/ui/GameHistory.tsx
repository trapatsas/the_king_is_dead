import { useEffect, useRef, useState } from "react";
import { readArchives, serializeArchive } from "../app/gameArchive";
import type { ArchivedGame } from "../app/gameArchive";
import { GameLogPanel } from "./GameLogPanel";

export function GameHistory({
  onClose,
  initialGameId,
}: {
  onClose: () => void;
  initialGameId: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [archive, setArchive] = useState(() => readArchives());
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(initialGameId);
  const [exportStatus, setExportStatus] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const selected = archive.games.find((game) => game.id === selectedId);
  const needle = query.trim().toLocaleLowerCase();
  const games = archive.games.filter((game) =>
    `${game.id} ${game.players.map((p) => p.name).join(" ")}`
      .toLocaleLowerCase()
      .includes(needle),
  );
  async function copyLog(game: ArchivedGame) {
    try {
      await navigator.clipboard.writeText(serializeArchive(game));
      setExportStatus({
        id: game.id,
        message: "Game log copied. Paste it into your message to share it.",
      });
    } catch {
      setExportStatus({
        id: game.id,
        message:
          "Copying is unavailable. Use Download log to save and share the file.",
      });
    }
  }
  function downloadLog(game: ArchivedGame) {
    const link = document.createElement("a");
    let url: string | undefined;
    try {
      url = URL.createObjectURL(
        new Blob([serializeArchive(game)], { type: "application/json" }),
      );
      link.href = url;
      link.download = `${game.id}.json`;
      link.hidden = true;
      document.body.append(link);
      link.click();
      setExportStatus({
        id: game.id,
        message:
          "Game log download started. Attach the JSON file to share this game.",
      });
    } catch {
      setExportStatus({
        id: game.id,
        message: "The download could not start. Try Copy log instead.",
      });
    } finally {
      link.remove();
      if (url) {
        const exportedUrl = url;
        setTimeout(() => URL.revokeObjectURL(exportedUrl), 1000);
      }
    }
  }
  useEffect(() => {
    const node = dialog.current;
    const opener = document.activeElement;
    if (typeof node?.showModal === "function") node.showModal();
    else node?.setAttribute("open", "");
    close.current?.focus();
    return () => {
      node?.close?.();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="history-dialog"
      aria-label="Saved game logs"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="section-title">
        <h2>Saved game logs</h2>
        <button ref={close} onClick={onClose}>
          Close history
        </button>
      </div>
      <p className="hint">
        Public logs are saved in this browser, including unfinished games. Find
        a game by its ID or a player’s name. Logs do not resume play.
      </p>
      {archive.unavailable && (
        <p role="status">
          Saved logs are unavailable because browser storage could not be read.
        </p>
      )}
      {archive.invalid > 0 && (
        <p role="status">
          Some saved logs could not be read. Other games are still available.
        </p>
      )}
      <label>
        Find a game
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Game ID or player name"
        />
      </label>
      <button className="quiet" onClick={() => setArchive(readArchives())}>
        Refresh saved logs
      </button>
      <div className="history-layout">
        <nav aria-label="Saved games">
          <ul className="saved-games">
            {games.map((game) => (
              <li key={game.id}>
                <button
                  aria-pressed={selectedId === game.id}
                  onClick={() => setSelectedId(game.id)}
                >
                  <strong>{game.players.map((p) => p.name).join(" · ")}</strong>
                  <span>
                    {game.status === "finished" ? "Finished" : "Partial log"} ·{" "}
                    {game.turns} turns
                  </span>
                  <time dateTime={game.createdAt}>
                    {new Date(game.createdAt).toLocaleString()}
                  </time>
                  <span className="saved-game-id">{game.id}</span>
                </button>
              </li>
            ))}
          </ul>
          {games.length === 0 && (
            <p>
              {archive.games.length
                ? "No games match this search."
                : "No saved games yet."}
            </p>
          )}
        </nav>
        <div>
          {selected ? (
            <section aria-label="Selected game log">
              <p className="saved-game-id">Game ID: {selected.id}</p>
              <div className="log-export-actions">
                <button onClick={() => void copyLog(selected)}>Copy log</button>
                <button onClick={() => downloadLog(selected)}>
                  Download log
                </button>
              </div>
              {exportStatus?.id === selected.id && (
                <p role="status">{exportStatus.message}</p>
              )}
              <GameLogPanel
                key={selected.id}
                entries={selected.entries}
                initiallyOpen
              />
            </section>
          ) : (
            <p>Choose a game to read its log.</p>
          )}
        </div>
      </div>
    </dialog>
  );
}
