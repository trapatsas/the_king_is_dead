import { FACTIONS } from "../game/domain";
import type { GameResult } from "../game/domain";
import { title } from "./presentation";

export function Result({ result }: { result: GameResult }) {
  return (
    <section className="result-panel" aria-label="Game result">
      <span className="eyebrow">{title(result.method)}</span>
      <h2>
        {result.kind === "win"
          ? `${result.winner} wins the crown`
          : "The crown remains disputed"}
      </h2>
      <p>{result.kind === "win" ? result.explanation : result.reason}</p>
      {result.kind === "draw" && (
        <p>Draw between {result.contenders.join(", ")}.</p>
      )}
      <details>
        <summary>How the result was decided</summary>
        <div className="score-scroll">
          <table>
            <caption>Final court and action record</caption>
            <thead>
              <tr>
                <th>Player</th>
                {FACTIONS.map((faction) => (
                  <th key={faction}>{title(faction)}</th>
                ))}
                <th>Sets</th>
                <th>Last card action</th>
              </tr>
            </thead>
            <tbody>
              {result.details.players.map((player) => (
                <tr key={player.playerId}>
                  <th>{player.playerId}</th>
                  {FACTIONS.map((faction) => (
                    <td key={faction}>{player.scoringCourt[faction]}</td>
                  ))}
                  <td>{player.completeSets}</td>
                  <td>{player.lastActionSequence ?? "Never acted"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Faction control:{" "}
          {FACTIONS.map(
            (faction) =>
              `${title(faction)} ${result.details.factionPower[faction].wins} (last win ${result.details.factionPower[faction].lastWonStruggle ?? "none"})`,
          ).join("; ")}
          .
        </p>
        {result.details.plot && (
          <p>
            Plot: {result.details.plot.playerId} supports{" "}
            {title(result.details.plot.faction)} for scoring only.
          </p>
        )}
        {result.details.cases.map((evaluation, index) => (
          <div key={index} className="scoring-case">
            <h3>
              {evaluation.ranking
                ? evaluation.ranking.map(title).join(" → ")
                : "Invasion comparison"}
            </h3>
            <ol>
              {evaluation.steps.map((step, stepIndex) => (
                <li key={stepIndex}>
                  {title(step.criterion)}
                  {step.faction ? ` (${title(step.faction)})` : ""}:{" "}
                  {step.values
                    .map(
                      (value) =>
                        `${value.playerId}: ${value.value ?? "never acted"}`,
                    )
                    .join(", ")}
                  . Remaining: {step.remaining.join(", ")}.
                </li>
              ))}
            </ol>
          </div>
        ))}
      </details>
    </section>
  );
}
