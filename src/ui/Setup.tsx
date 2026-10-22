import { useState } from "react";
import type { GameMode, SetupConfig } from "../game/domain";
import { BOT_AGENT_NAMES } from "./presentation";

type SeatChoice = "human" | "patient" | "informed" | "ml";
const SEAT_OPTIONS: { value: SeatChoice; label: string }[] = [
  { value: "human", label: "Human" },
  { value: "patient", label: "Easy bot" },
  { value: "informed", label: "Medium bot" },
  { value: "ml", label: "Hard bot" },
];

export function Setup({ onStart }: { onStart: (config: SetupConfig) => void }) {
  const [count, setCount] = useState(3);
  const [mode, setMode] = useState<GameMode>("standard");
  const [seats, setSeats] = useState<SeatChoice[]>(["human", "human", "human"]);
  const [seed, setSeed] = useState("");
  const [names, setNames] = useState(["", "", ""]);
  const playerNames = seats
    .slice(0, count)
    .map(
      (seat, index) =>
        names[index]!.trim() ||
        `${seat === "human" ? "Player" : "Bot"} ${index + 1}`,
    );
  const duplicateNames =
    new Set(playerNames.map((name) => name.toLocaleLowerCase())).size !== count;
  const unavailable = duplicateNames
    ? "Give each player and bot a different name."
    : mode === "advanced"
      ? "Advanced cards are coming soon. Choose Standard to play."
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
            Play locally with people or bots
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
            players: seats.slice(0, count).map((seat, index) => ({
              id: playerNames[index]!,
              controller: seat === "human" ? "human" : "algorithmic",
              ...(seat !== "human" ? { botStrategy: seat } : {}),
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
          {seats.slice(0, count).map((seat, index) => (
            <div className="seat-row" key={index}>
              <label>
                Seat {index + 1} name
                <input
                  aria-label={`Player ${index + 1} name`}
                  value={names[index]}
                  maxLength={40}
                  placeholder={
                    seat === "human"
                      ? `Player ${index + 1}`
                      : `Bot ${index + 1}`
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
                Player type
                <select
                  aria-label={`Player ${index + 1} type`}
                  aria-describedby={
                    seat !== "human" ? `seat-agent-${index}` : undefined
                  }
                  value={seat}
                  onChange={(event) =>
                    setSeats((previous) =>
                      previous.map((entry, i) =>
                        i === index
                          ? (event.target.value as SeatChoice)
                          : entry,
                      ),
                    )
                  }
                >
                  {SEAT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {seat !== "human" && (
                <p className="hint seat-agent" id={`seat-agent-${index}`}>
                  Agent: {BOT_AGENT_NAMES[seat]}.{" "}
                  {seat === "ml"
                    ? "Uses learned evaluation to assess future positions."
                    : seat === "informed"
                      ? "Ranks its options against what every seat can still do with the cards they hold."
                      : "Keeps cards for later struggles and can wait for others to commit."}
                </p>
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
