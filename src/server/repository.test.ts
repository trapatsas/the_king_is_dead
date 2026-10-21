import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GameRepository } from "./repository";
import { passPlan } from "../bot/simulation";
import { createGame } from "../game/setup";
import type { GameSession } from "../game/events";

let repo: GameRepository;
const id = "king-00000000-0000-0000-0000-000000000001";
const config = {
  mode: "standard" as const,
  seed: "sqlite-replay-test",
  players: [
    { id: "A", controller: "human" as const },
    {
      id: "B",
      controller: "algorithmic" as const,
      botStrategy: "patient" as const,
    },
  ],
};
beforeEach(() => {
  repo = new GameRepository(":memory:");
});
afterEach(() => repo.close());
function finish(): GameSession {
  let session = repo.create(id, config);
  while (session.state.phase === "turn") {
    const before = session.state;
    session = repo.append(
      id,
      `turn-${before.turnSequence + 1}`,
      before.eventSequence,
      passPlan(before),
    );
  }
  return session;
}
describe("SQLite authoritative capture and training projection", () => {
  it("rolls back failed migrations and permits a clean retry", () => {
    const directory = mkdtempSync(join(tmpdir(), "king-migration-"));
    const file = join(directory, "game.sqlite");
    try {
      const sql = readFileSync(
        resolve("docs/sqlite/schema.sql"),
        "utf8",
      ).replace("CREATE TABLE games (", "INVALID SQL (");
      writeFileSync(join(directory, "schema.sql"), sql);
      expect(() => new GameRepository(file, directory)).toThrow();
      const retry = new GameRepository(file);
      expect(retry.get("PRAGMA integrity_check")?.integrity_check).toBe("ok");
      retry.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("stores a real replayable game, exact outcome and pre-turn features", () => {
    const final = finish();
    expect(repo.session(id)).toEqual(final);
    expect(repo.materialize(id)).toBe(final.state.turnSequence);
    expect(repo.materialize(id)).toBe(final.state.turnSequence); // idempotent projection
    expect(repo.all("PRAGMA foreign_key_check")).toEqual([]);
    expect(repo.get("PRAGMA integrity_check")?.integrity_check).toBe("ok");
    const rows = repo.all(
      "SELECT turn_seq,base_event_seq,length(features) AS bytes FROM ml_positions ORDER BY turn_seq",
    );
    expect(rows[0]).toMatchObject({
      turn_seq: 1,
      base_event_seq: 0,
      bytes: 1896,
    });
    expect(repo.all("SELECT * FROM player_results")).toHaveLength(2);
    const dataset = repo.buildDataset("test-dataset");
    expect(repo.buildDataset("test-dataset")).toBe(dataset);
    const batch = repo.all(
      "SELECT * FROM v_ml_training_samples WHERE dataset_id=? ORDER BY ordinal LIMIT 256",
      dataset,
    );
    expect(batch).toHaveLength(final.state.turnSequence);
    for (const r of batch)
      expect(
        Number(r.target0) + Number(r.target1) + Number(r.target2),
      ).toBeCloseTo(1);
    expect(() =>
      repo.run("DELETE FROM ml_dataset_samples WHERE dataset_id=?", dataset),
    ).toThrow(/immutable/);
    expect(() => repo.buildDataset("test-dataset", "different")).toThrow(
      /conflict/,
    );
  });
  it("handles exact retries but rejects stale and conflicting commands atomically", () => {
    const initial = repo.create(id, config);
    const plan = passPlan(initial.state);
    const next = repo.append(id, "request", 0, plan);
    expect(repo.append(id, "request", 0, plan)).toEqual(next);
    expect(repo.create(id, config)).toEqual(next);
    expect(() => repo.append(id, "other", 0, plan)).toThrow(/Stale/);
    expect(() => repo.append(id, "request", 1, plan)).toThrow(/reused/);
    expect(() =>
      repo.append(id, "illegal", next.state.eventSequence, {
        ...plan,
        baseTurnSequence: next.state.turnSequence,
        playerId: "missing",
      }),
    ).toThrow();
    expect(repo.session(id)).toEqual(next);
    expect(repo.all("SELECT * FROM turns")).toHaveLength(1);
  });
  it("requires completed games and detects altered checkpoints during replay", () => {
    repo.create(id, config);
    expect(() => repo.materialize(id)).toThrow(/completed/);
    finish();
    repo.run("UPDATE game_snapshots SET state_json='{}' WHERE turn_seq=1");
    expect(() => repo.materialize(id)).toThrow(/Checkpoint/);
    expect(repo.all("SELECT * FROM ml_games")).toHaveLength(0);
  });
  it("groups renamed games together and deduplicates identical trajectories", () => {
    finish();
    repo.materialize(id);
    const other = "king-00000000-0000-0000-0000-000000000002";
    const changed = {
      ...config,
      players: config.players.map((p, i) => ({ ...p, id: `renamed-${i}` })),
    };
    let s: GameSession = repo.create(other, changed);
    while (s.state.phase === "turn")
      s = repo.append(
        other,
        `turn-${s.state.turnSequence + 1}`,
        s.state.eventSequence,
        passPlan(s.state),
      );
    repo.materialize(other);
    const metadata = repo.all(
      "SELECT family_hash,trajectory_hash FROM ml_games",
    );
    expect(metadata[0]).toEqual(metadata[1]);
    repo.buildDataset("dedup");
    expect(repo.all("SELECT * FROM ml_dataset_games")).toHaveLength(1);
  });
  it("stores exactly the same initial game as the public engine", () => {
    expect(repo.create(id, config)).toEqual(createGame(config));
  });
});

describe("bot decision provenance", () => {
  it("links accepted search statistics without changing game events", () => {
    const s = repo.create(id, config);
    // Advance the human seat if necessary; then commit a real bot search.
    const active = s.state.players[s.state.activePlayerId]!;
    let current = s;
    if (active.controller === "human")
      current = repo.append(
        id,
        "human",
        s.state.eventSequence,
        passPlan(s.state),
      );
    const state = current.state,
      plan = passPlan(state);
    const result = {
      plan,
      explanation: "test",
      stats: {
        iterations: 1,
        elapsedMs: 2,
        nodes: 1,
        maxDepth: 1,
        horizon: 5,
        horizonVisits: 0,
        terminalVisits: 0,
        rootChoices: 1,
        reusedVisits: 0,
      },
    };
    const next = repo.append(id, "bot", state.eventSequence, plan, {
      budget: { iterations: 1, seed: 1 },
      result,
      runtime: "test",
    });
    expect(
      repo.all(
        "SELECT status,committed_turn_seq,iterations FROM bot_decisions",
      ),
    ).toEqual([
      {
        status: "committed",
        committed_turn_seq: next.state.turnSequence,
        iterations: 1,
      },
    ]);
    expect(repo.session(id).events.at(-1)?.eventSequence).toBe(
      next.state.eventSequence,
    );
  });
});
