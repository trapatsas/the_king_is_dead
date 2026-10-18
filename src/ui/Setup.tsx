import { useState } from "react";
import type { ControllerKind, GameMode, SetupConfig } from "../game/domain";

export function Setup({ onStart }: { onStart: (config: SetupConfig) => void }) {
  const [count, setCount] = useState(3);
  const [mode, setMode] = useState<GameMode>("standard");
  const [controllers, setControllers] = useState<ControllerKind[]>([
    "human",
    "human",
    "human",
  ]);
  const [seed, setSeed] = useState("");
  const unavailable =
    mode === "advanced"
      ? "Advanced cards are coming soon. Choose Standard to play."
      : controllers.slice(0, count).some((controller) => controller !== "human")
        ? "Automated opponents are unavailable. LLM seats are not configured. Choose Human for every seat to play."
        : null;
  return (
    <main className="setup-layout">
      <section className="intro">
        <span className="eyebrow">Britain, after Arthur</span>
        <h1>
          The king
          <br />
          is dead<span>.</span>
        </h1>
        <p>
          The throne is empty. Three factions vie for a fractured kingdom.
          Gather your court, shape the balance, and decide when to let power
          settle.
        </p>
        <div className="faction-legend">
          <span className="scottish">● Scottish</span>
          <span className="welsh">● Welsh</span>
          <span className="english">● English</span>
        </div>
        <div className="intro-rule">
          <span>II — III</span>
          <p>
            2–3 players
            <br />
            Pass the device between turns
          </p>
        </div>
      </section>
      <form
        className="setup-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (unavailable) return;
          const freshSeed =
            seed.trim() ||
            `kingdom-${crypto.getRandomValues(new Uint32Array(1))[0]}`;
          onStart({
            seed: freshSeed,
            mode,
            players: controllers.slice(0, count).map((controller, index) => ({
              id: `Player ${index + 1}`,
              controller,
            })),
          });
        }}
      >
        <span className="eyebrow">Gather the court</span>
        <h2>A new kingdom</h2>
        <label>
          Rules
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as GameMode)}
          >
            <option value="standard">Standard</option>
            <option value="advanced">Advanced — coming soon</option>
          </select>
        </label>
        <label>
          Players
          <select
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          >
            <option value={2}>2 players</option>
            <option value={3}>3 players</option>
          </select>
        </label>
        <fieldset>
          <legend>Seats · clockwise order</legend>
          {controllers.slice(0, count).map((controller, index) => (
            <label className="seat-row" key={index}>
              Player {index + 1}
              <select
                aria-label={`Player ${index + 1} controller`}
                value={controller}
                onChange={(event) =>
                  setControllers((previous) =>
                    previous.map((entry, i) =>
                      i === index
                        ? (event.target.value as ControllerKind)
                        : entry,
                    ),
                  )
                }
              >
                <option value="human">Human · local</option>
                <option value="algorithmic">Algorithmic · unavailable</option>
                <option value="llm">LLM · not configured</option>
              </select>
            </label>
          ))}
        </fieldset>
        <details>
          <summary>Reproducible setup</summary>
          <label>
            Setup seed
            <input
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
              placeholder="Leave blank for a fresh kingdom"
              maxLength={200}
            />
          </label>
          <p className="hint">
            The same seed and seats reproduce the same starting position.
          </p>
        </details>
        {unavailable && (
          <p role="status" className="notice">
            {unavailable}
          </p>
        )}
        <button
          className="primary start-button"
          disabled={unavailable !== null}
        >
          Begin game <span aria-hidden="true">→</span>
        </button>
        <p className="hint">
          Local hotseat · games are not saved yet. Reloading returns here.
        </p>
      </form>
    </main>
  );
}
