import type { LastMove } from "./finishedLog";
import type { PlayerId } from "../game/domain";
import { Followers } from "./Board";
import { BOT_AGENT_NAMES, BOT_STRATEGY_LABELS, title } from "./presentation";
import type { TableView } from "./presentation";

export function HowToPlay() {
  return (
    <details className="how-to">
      <summary>How to play</summary>
      <div className="help-content">
        <p>
          Play one action card, complete its effect, then summon one follower
          from an uncontrolled region to your court. Or pass. Review your
          preview and choose End Turn to commit. Reset Turn clears your choices.
        </p>
        <p>
          When everyone passes consecutively, the next region resolves. A unique
          largest faction gains control; a tie causes instability. Three
          unstable regions cause an Invasion, scored by complete court sets.
          Otherwise all eight struggles lead to a Coronation, scored by faction
          power and court support. Each player has only eight action cards for
          the entire game. Players keep taking turns before a struggle; a pass
          does not stop you from playing on a later turn.
        </p>
        <p>
          The engine offers only legal choices and requires the greatest
          achievable effect. A region carrying a negotiation disc cannot be
          exchanged. Another player cannot immediately undo a Manoeuvre or
          Outmanoeuvre with either swap card.
        </p>
      </div>
    </details>
  );
}

export function StruggleNotice({ notices }: { notices: readonly string[] }) {
  if (notices.length === 0) return null;
  return (
    <section
      className="notice struggle-notice"
      aria-label="Power struggle report"
    >
      <p role="status">{notices.at(-1)}</p>
      <details>
        <summary>Struggle history</summary>
        <div className="struggle-history-content">
          <ol>
            {notices.map((notice, index) => (
              <li key={index}>{notice}</li>
            ))}
          </ol>
        </div>
      </details>
    </section>
  );
}

export function SupplyPanel({ table }: { table: TableView }) {
  return (
    <section className="supply-panel" aria-label="Shared supply">
      <div>
        <h3>Common supply</h3>
        <Followers counts={table.supply} label="Followers in supply" />
      </div>
      <div>
        <h3>Control discs remaining</h3>
        <Followers
          counts={table.controlDiscs}
          label="Control discs in supply"
        />
      </div>
      <div>
        <h3>Instability</h3>
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
      </div>
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
    <section aria-label="Player courts" className="courts">
      {table.players.map((player) => (
        <article
          key={player.id}
          className={`court ${player.id === activePlayer ? "active-court" : ""}`}
        >
          <div className="court-heading">
            <h3 title={player.id}>{player.id}</h3>
            <span>{player.handCount} cards</span>
          </div>
          <div className="court-overview">
            <Followers counts={player.court} label={`${player.id} court`} />
            <span className="court-controller">
              {player.controller === "algorithmic"
                ? `${BOT_STRATEGY_LABELS[player.botStrategy ?? "reference"]} bot`
                : "Human"}
            </span>
          </div>
          <section className="last-move" aria-label={`${player.id} last move`}>
            <p className="last-move-label">
              {lastMoves[player.id]
                ? `Turn ${lastMoves[player.id]!.turn}`
                : "Last move"}
            </p>
            <strong>
              {lastMoves[player.id]?.summary ?? "Has not played yet"}
            </strong>
            {lastMoves[player.id] &&
              lastMoves[player.id]!.summary !== "Passed" && (
                <details>
                  <summary>Move details</summary>
                  <div className="court-expanded">
                    {lastMoves[player.id]!.details.map((detail, index) => (
                      <p key={index}>{detail}</p>
                    ))}
                  </div>
                </details>
              )}
          </section>
          <details className="court-details">
            <summary>Player details</summary>
            <div className="court-expanded">
              <p>
                {player.controller === "algorithmic"
                  ? `Agent: ${BOT_AGENT_NAMES[player.botStrategy ?? "reference"]}`
                  : "Human player"}
              </p>
              <p>
                Top discard:{" "}
                <strong>
                  {player.discardTop ? title(player.discardTop.type) : "None"}
                </strong>
              </p>
              <p>
                Negotiation disc:{" "}
                {player.negotiationDiscLocation
                  ? title(player.negotiationDiscLocation)
                  : "Available"}
              </p>
            </div>
          </details>
        </article>
      ))}
    </section>
  );
}
