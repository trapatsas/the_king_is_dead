import { useRef } from "react";
import type { LastMove } from "./finishedLog";
import type { PlayerId } from "../game/domain";
import { Followers } from "./Board";
import { CloseIcon } from "./icons";
import {
  BOT_AGENT_NAMES,
  BOT_STRATEGY_LABELS,
  CARD_TEXT,
  regionsWon,
  title,
} from "./presentation";
import type { TableView } from "./presentation";
import { useModal } from "./useModal";

const STANDARD_CARDS = [
  "scottish-support",
  "welsh-support",
  "english-support",
  "assemble",
  "negotiate",
  "manoeuvre",
  "outmanoeuvre",
] as const;

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useModal(dialog, close);
  return (
    <dialog
      ref={dialog}
      className="sheet-dialog help-dialog"
      aria-label="How to play"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-head">
        <h2>How to play</h2>
        <button
          ref={close}
          className="icon-button"
          onClick={onClose}
          aria-label="Close how to play"
        >
          <CloseIcon />
        </button>
      </div>
      <div className="dialog-body help-content">
        <ol className="help-steps">
          <li>
            <strong>Play a card</strong> from your hand and complete its effect
            by clicking the highlighted regions or followers on the map.
          </li>
          <li>
            <strong>Summon one follower</strong> from an uncontrolled region
            into your court.
          </li>
          <li>
            <strong>End Turn</strong> to commit. Until then, Reset Turn or pick
            another card to start over. You may also pass.
          </li>
        </ol>
        <p>
          When everyone passes consecutively, the next region on the struggle
          track resolves. A unique largest faction gains control; a tie or an
          empty region becomes unstable. Three unstable regions cause an{" "}
          <strong>Invasion</strong>, scored by complete court sets (one of each
          faction). Otherwise all eight struggles lead to a{" "}
          <strong>Coronation</strong>: the faction controlling most regions
          wins, and the player with most of its followers takes the crown.
        </p>
        <p>
          Each player has only eight action cards for the whole game. Passing
          does not stop you from playing on a later turn. The game offers only
          legal choices and requires the greatest achievable effect. A region
          carrying a negotiation disc cannot be exchanged, and a Manoeuvre or
          Outmanoeuvre cannot be immediately undone by either swap card.
        </p>
        <h3>Action cards</h3>
        <dl className="card-reference">
          {STANDARD_CARDS.map((card) => (
            <div key={card}>
              <dt>{title(card)}</dt>
              <dd>{CARD_TEXT[card]}</dd>
            </div>
          ))}
        </dl>
        <h3>Reading the board</h3>
        <ul className="legend-list">
          <li>
            <span className="mark scottish" aria-hidden="true" /> Scottish ·{" "}
            <span className="mark welsh" aria-hidden="true" /> Welsh ·{" "}
            <span className="mark english" aria-hidden="true" /> English
          </li>
          <li>
            Numbers on regions give the struggle order; the gold outline marks
            the next struggle. A region’s top edge shows its current leader.
          </li>
          <li>
            During a turn, legal targets are highlighted and everything else is
            dimmed. Keyboard focus follows each step.
          </li>
        </ul>
      </div>
    </dialog>
  );
}

export function StruggleNotice({ notices }: { notices: readonly string[] }) {
  if (notices.length === 0) return null;
  return (
    <section
      className="rail-section struggle-notice"
      aria-label="Power struggle report"
    >
      <h2 className="rail-title">Latest struggle</h2>
      <p role="status">{notices.at(-1)}</p>
      {notices.length > 1 && (
        <details>
          <summary>Struggle history ({notices.length})</summary>
          <ol className="struggle-history">
            {notices.map((notice, index) => (
              <li key={index}>{notice}</li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

export function SupplyPanel({ table }: { table: TableView }) {
  return (
    <section className="rail-section kingdom-panel" aria-label="Shared supply">
      <h2 className="rail-title">Kingdom</h2>
      <dl className="kingdom-stats">
        <div>
          <dt>Regions won</dt>
          <dd>
            <Followers
              counts={regionsWon(table)}
              label="Regions controlled by faction"
            />
          </dd>
        </div>
        <div>
          <dt>Instability</dt>
          <dd>
            <span
              className="instability"
              role="img"
              aria-label={`${table.instability} of 3 instability discs placed`}
            >
              {Array.from({ length: 3 }, (_, index) => (
                <span
                  className={index < table.instability ? "placed" : ""}
                  key={index}
                  aria-hidden="true"
                >
                  ✕
                </span>
              ))}
            </span>
          </dd>
        </div>
        <div>
          <dt>Supply</dt>
          <dd>
            <Followers counts={table.supply} label="Followers in supply" />
          </dd>
        </div>
        <div>
          <dt>Control discs</dt>
          <dd>
            <Followers
              counts={table.controlDiscs}
              label="Control discs in supply"
            />
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function CourtsPanel({
  table,
  activePlayer,
  lastMoves = Object.create(null),
}: {
  table: TableView;
  activePlayer: PlayerId;
  lastMoves?: Readonly<Record<string, LastMove>>;
}) {
  return (
    <section aria-label="Player courts" className="rail-section courts">
      <h2 className="rail-title">Courts</h2>
      {table.players.map((player) => {
        const move = lastMoves[player.id];
        const bot = player.controller === "algorithmic";
        return (
          <article
            key={player.id}
            className={`court ${player.id === activePlayer ? "active-court" : ""}`}
          >
            <div className="court-heading">
              <h3 title={player.id}>{player.id}</h3>
              <span className="court-controller">
                {bot
                  ? `${BOT_STRATEGY_LABELS[player.botStrategy ?? "reference"]} bot`
                  : "Human"}
              </span>
              <span className="court-cards">{player.handCount} cards</span>
            </div>
            <Followers counts={player.court} label={`${player.id} court`} />
            <p
              className="court-meta"
              title={
                bot
                  ? `Agent: ${BOT_AGENT_NAMES[player.botStrategy ?? "reference"]}`
                  : undefined
              }
            >
              <span>
                Discard{" "}
                <strong>
                  {player.discardTop ? title(player.discardTop.type) : "None"}
                </strong>
              </span>
              <span>
                Disc{" "}
                <strong>
                  {player.negotiationDiscLocation
                    ? title(player.negotiationDiscLocation)
                    : "Available"}
                </strong>
              </span>
            </p>
            <section
              className="last-move"
              aria-label={`${player.id} last move`}
            >
              {move && move.summary !== "Passed" ? (
                <details>
                  <summary>
                    <span className="last-move-label">Turn {move.turn}</span>{" "}
                    <strong>{move.summary}</strong>
                  </summary>
                  <div className="move-details">
                    {move.details.map((detail, index) => (
                      <p key={index}>{detail}</p>
                    ))}
                  </div>
                </details>
              ) : (
                <p>
                  <span className="last-move-label">
                    {move ? `Turn ${move.turn}` : "Last move"}
                  </span>{" "}
                  <strong>{move?.summary ?? "Has not played yet"}</strong>
                </p>
              )}
            </section>
          </article>
        );
      })}
    </section>
  );
}
