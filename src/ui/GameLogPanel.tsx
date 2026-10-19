import { useId, useState } from "react";
import { FACTIONS } from "../game/domain";
import type { GameLogEntry } from "./finishedLog";
import { title } from "./presentation";

export function GameLogPanel({
  entries,
  initiallyOpen = false,
}: {
  entries: readonly GameLogEntry[];
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const contentId = useId();
  return (
    <section className="game-log" aria-label="Game log">
      <div className="section-title">
        <div>
          <span className="eyebrow">The kingdom’s chronicle</span>
          <h2>Game log</h2>
        </div>
        <button
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((previous) => !previous)}
        >
          {open ? "Hide game log" : "View game log"}
        </button>
      </div>
      <p className="hint">
        Follow the initial setup, every committed turn, power struggles, and the
        final result.
      </p>
      <div id={contentId}>
        {open && (
          <ol
            className="game-log-entries"
            aria-label="Recorded game events"
            tabIndex={0}
          >
            {entries.map((entry) => (
              <li key={entry.sequence} className="game-log-entry">
                <div className="game-log-marker">
                  <span>#{entry.sequence}</span>
                  <span>{entry.label}</span>
                </div>
                <article>
                  <h3>{entry.heading}</h3>
                  {entry.followers && (
                    <div className="game-log-followers">
                      <table>
                        <caption>{entry.followers.caption}</caption>
                        <thead>
                          <tr>
                            <th scope="col">Location</th>
                            {FACTIONS.map((faction) => (
                              <th scope="col" key={faction} className={faction}>
                                {title(faction)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {entry.followers.rows.map((row) => (
                            <tr key={row.label}>
                              <th scope="row">{row.label}</th>
                              {FACTIONS.map((faction) => (
                                <td key={faction}>{row.counts[faction]}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {entry.details.map((detail, index) => (
                    <p key={index}>{detail}</p>
                  ))}
                </article>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
