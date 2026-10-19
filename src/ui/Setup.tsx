import { useState } from "react";
import type {
  BotStrategy,
  ControllerKind,
  GameMode,
  SetupConfig,
} from "../game/domain";

export function Setup({ onStart }: { onStart: (config: SetupConfig) => void }) {
  const [count, setCount] = useState(3);
  const [mode, setMode] = useState<GameMode>("standard");
  const [controllers, setControllers] = useState<ControllerKind[]>([
    "human",
    "human",
    "human",
  ]);
  const [strategies, setStrategies] = useState<BotStrategy[]>([
    "reference",
    "reference",
    "reference",
  ]);
  const [seed, setSeed] = useState("");
  const [names, setNames] = useState(["", "", ""]);
  const playerNames = controllers
    .slice(0, count)
    .map(
      (controller, index) =>
        names[index]!.trim() ||
        `${controller === "algorithmic" ? "Bot" : "Player"} ${index + 1}`,
    );
  const duplicateNames =
    new Set(playerNames.map((name) => name.toLocaleLowerCase())).size !== count;
  // Research release gate remains closed. An explicit development URL supports
  // human play-testing without advertising the prototype as release-ready.
  const experimentalBots =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("bots") === "experimental";
  const chosenControllers = controllers.slice(0, count);
  const unavailable = duplicateNames
    ? "Give each player and bot a different name."
    : mode === "advanced"
      ? "Advanced cards are coming soon. Choose Standard to play."
      : chosenControllers.includes("llm")
        ? "LLM seats are not configured. Choose an available controller to play."
        : chosenControllers.includes("algorithmic") && !experimentalBots
          ? "Algorithmic opponents are in development. Choose Human for every seat to play."
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
              id: playerNames[index]!,
              controller,
              ...(controller === "algorithmic"
                ? { botStrategy: strategies[index]! }
                : {}),
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
        {experimentalBots && (
          <p className="notice">
            Experimental Standard bot preview. Playing-strength validation is
            still in progress.
          </p>
        )}
        <fieldset>
          <legend>Seats · clockwise order</legend>
          {controllers.slice(0, count).map((controller, index) => (
            <div className="seat-row" key={index}>
              <label>
                Seat {index + 1} name
                <input
                  aria-label={`Player ${index + 1} name`}
                  value={names[index]}
                  maxLength={40}
                  placeholder={
                    controller === "algorithmic"
                      ? `Bot ${index + 1}`
                      : `Player ${index + 1}`
                  }
                  onChange={(event) =>
                    setNames((previous) =>
                      previous.map((name, i) =>
                        i === index ? event.target.value : name,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Controller
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
                  <option value="algorithmic">
                    {experimentalBots
                      ? "Algorithmic · experimental"
                      : "Algorithmic · in development"}
                  </option>
                  <option value="llm">LLM · not configured</option>
                </select>
              </label>
              {controller === "algorithmic" && (
                <label className="seat-strategy">
                  Bot strategy
                  <select
                    aria-label={`Player ${index + 1} strategy`}
                    value={strategies[index]}
                    onChange={(event) =>
                      setStrategies((previous) =>
                        previous.map((value, i) =>
                          i === index
                            ? (event.target.value as BotStrategy)
                            : value,
                        ),
                      )
                    }
                  >
                    <option value="reference">
                      Reference · original aggressive bot
                    </option>
                    <option value="patient">
                      Patient · reserve and respond
                    </option>
                    <option value="informed">
                      Informed · card-aware forecast
                    </option>
                  </select>
                  <span className="hint">
                    {strategies[index] === "informed"
                      ? "Ranks its options against what every seat can still do with the cards they hold."
                      : strategies[index] === "patient"
                        ? "Keeps cards for later struggles and can wait for others to commit."
                        : "The original bot, kept as a comparison."}
                  </span>
                </label>
              )}
            </div>
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
          Local play · public game logs are saved in this browser. Reloading
          returns to setup.
        </p>
      </form>
    </main>
  );
}
