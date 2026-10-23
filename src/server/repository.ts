import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";
import type { BotTelemetry } from "../app/botTelemetry";
import { witnessedCards } from "../app/botObservation";
import { commitPlan } from "../app/session";
import {
  FEATURE_COUNT,
  FEATURE_SCHEMA,
  FEATURE_VERSION,
  encodePosition,
} from "../bot/ml/features";
import { reconstructStandard } from "../bot/observation";
import { getObservation } from "../game/visibility";
import { FACTIONS, REGION_IDS } from "../game/domain";
import type { GameState, SetupConfig } from "../game/domain";
import type { AcceptedEvent, GameSession } from "../game/events";
import type { TurnPlan } from "../game/turnTypes";
import { createGame } from "../game/setup";
import { BOT_VERSION } from "../bot/search";
import { PATIENT_BOT_VERSION } from "../bot/patient";
import { INFORMED_BOT_VERSION } from "../bot/informed";
import { ML_BOT_VERSION } from "../bot/ml/mlBot";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const blob = (values: Float32Array) => {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => bytes.writeFloatLE(v, i * 4));
  return bytes;
};
export interface BotProvenance {
  readonly version: string;
  readonly params: Readonly<Record<string, unknown>>;
}
export interface CaptureOptions {
  readonly source?: "live" | "benchmark" | "import";
  readonly cohort?: string;
  readonly bots?: Readonly<Record<string, BotProvenance>>;
}

/** All live and headless capture uses this repository and the same rule engine.
 * Single-process SQLite writer; search/training never runs inside its transactions. */
export class GameRepository {
  readonly db: DatabaseSync;
  private readonly statements = new Map<
    string,
    ReturnType<DatabaseSync["prepare"]>
  >();
  constructor(path: string, schemaDirectory = resolve("docs/sqlite")) {
    if (path !== ":memory:")
      mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    try {
      this.initialize(schemaDirectory);
    } catch (error) {
      // A failed DDL batch must not leave a write lock held until GC.
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* no transaction may be active */
      }
      this.db.close();
      throw error;
    }
  }
  private initialize(schemaDirectory: string) {
    this.db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;",
    );
    let version = Number(
      this.db.prepare("PRAGMA user_version").get()!.user_version,
    );
    for (const [target, file] of [
      [1, "schema.sql"],
      [2, "002_training.sql"],
    ] as const) {
      if (version < target) {
        const sql = readFileSync(resolve(schemaDirectory, file), "utf8");
        // Insert the checksum before the migration's own COMMIT.
        const checksum = createHash("sha256").update(sql).digest("hex");
        this.db.exec(
          sql.replace(
            /COMMIT;\s*$/,
            `INSERT INTO schema_migrations VALUES (${target}, ${Date.now()}, '${checksum}'); COMMIT;`,
          ),
        );
        version = target;
      } else {
        const existing = this.db
          .prepare("SELECT checksum FROM schema_migrations WHERE version=?")
          .get(target);
        if (
          !existing ||
          existing.checksum !==
            createHash("sha256")
              .update(readFileSync(resolve(schemaDirectory, file)))
              .digest("hex")
        )
          throw new Error(`Migration ${target} checksum mismatch`);
      }
    }
    if (version !== 2) throw new Error("Unsupported database version");
    this.run(
      "INSERT INTO ml_feature_schemas VALUES (?, ?, ?, 'float32-le', ?, ?, ?) ON CONFLICT(version) DO NOTHING",
      FEATURE_VERSION,
      "project-2-3-v1",
      FEATURE_COUNT,
      hash(FEATURE_SCHEMA),
      canonical(FEATURE_SCHEMA),
      FEATURE_VERSION,
    );
    if (
      this.get(
        "SELECT schema_hash FROM ml_feature_schemas WHERE version=?",
        FEATURE_VERSION,
      )?.schema_hash !== hash(FEATURE_SCHEMA)
    )
      throw new Error("Feature version/schema mismatch");
  }
  close() {
    this.db.close();
  }
  private statement(sql: string) {
    let query = this.statements.get(sql);
    if (!query) {
      query = this.db.prepare(sql);
      this.statements.set(sql, query);
    }
    return query;
  }
  run(sql: string, ...args: SQLInputValue[]) {
    return this.statement(sql).run(...args);
  }
  get(sql: string, ...args: SQLInputValue[]) {
    return this.statement(sql).get(...args);
  }
  all(sql: string, ...args: SQLInputValue[]) {
    return this.statement(sql).all(...args);
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private row(publicId: string) {
    const row = this.get("SELECT * FROM games WHERE public_id=?", publicId);
    if (!row) throw new Error("Unknown game");
    return row;
  }
  session(publicId: string): GameSession {
    const id = Number(this.row(publicId).id);
    const checkpoint = this.get(
      "SELECT state_json FROM game_snapshots WHERE game_id=? ORDER BY event_seq DESC LIMIT 1",
      id,
    );
    if (!checkpoint) throw new Error("Missing checkpoint");
    return {
      state: JSON.parse(String(checkpoint.state_json)) as GameState,
      events: this.all(
        "SELECT payload_json FROM game_events WHERE game_id=? ORDER BY event_seq",
        id,
      ).map((r) => JSON.parse(String(r.payload_json)) as AcceptedEvent),
    };
  }
  create(publicId: string, config: SetupConfig, options: CaptureOptions = {}) {
    if (!/^king-[a-f0-9-]{36}$/.test(publicId))
      throw new Error("Invalid game ID");
    if (config.mode !== "standard")
      throw new Error("SQLite capture currently supports Standard only");
    const inputHash = hash({ config, options });
    const existing = this.get(
      "SELECT id FROM games WHERE public_id=?",
      publicId,
    );
    if (existing) {
      const prior = this.get(
        "SELECT request_hash FROM game_commands WHERE game_id=? AND request_id='setup'",
        Number(existing.id),
      );
      if (prior?.request_hash !== inputHash)
        throw new Error("Game ID reused with different setup");
      return this.session(publicId);
    }
    const session = createGame(config);
    const now = Date.now();
    this.transaction(() => {
      const id = Number(
        this.run(
          `INSERT INTO games(public_id,mode,rules_version,state_schema_version,app_revision,status,player_count,starting_seat,source,dataset,created_at_ms,updated_at_ms,last_event_seq,last_turn_seq,last_action_seq)
        VALUES (?,'standard',?,?,?,'in_progress',?,?,?,?,?,?,0,0,0)`,
          publicId,
          session.state.rulesVersion,
          session.state.schemaVersion,
          process.env.KING_CODE_REVISION ?? "working-tree",
          config.players.length,
          session.state.playerOrder.indexOf(session.state.startingPlayerId),
          options.source ?? "live",
          options.cohort ?? null,
          now,
          now,
        ).lastInsertRowid,
      );
      config.players.forEach((player, seat) => {
        let botId: number | null = null;
        if (player.controller === "algorithmic") {
          const strategy = player.botStrategy ?? "reference";
          const defaults: Record<string, string> = {
            reference: BOT_VERSION,
            patient: PATIENT_BOT_VERSION,
            informed: INFORMED_BOT_VERSION,
            ml: ML_BOT_VERSION,
          };
          const version =
            options.bots?.[player.id]?.version ?? defaults[strategy]!;
          const params = options.bots?.[player.id]?.params ?? {};
          const revision = process.env.KING_CODE_REVISION ?? "working-tree";
          const configHash = hash({
            strategy,
            version,
            code_revision: revision,
            params,
          });
          this.run(
            "INSERT INTO bot_configs(strategy,version,code_revision,params_json,config_hash) VALUES (?,?,?,?,?) ON CONFLICT(config_hash) DO NOTHING",
            strategy,
            version,
            revision,
            canonical(params),
            configHash,
          );
          botId = Number(
            this.get(
              "SELECT id FROM bot_configs WHERE config_hash=?",
              configHash,
            )!.id,
          );
        }
        this.run(
          "INSERT INTO game_players(game_id,seat,engine_player_id,display_name,controller,bot_config_id) VALUES (?,?,?,?,?,?)",
          id,
          seat,
          player.id,
          player.id,
          player.controller,
          botId,
        );
      });
      this.writeEvents(id, session.state, session.events);
      this.snapshot(id, session.state);
      this.run(
        "INSERT INTO game_commands VALUES (?,'setup',?,-1,0)",
        id,
        inputHash,
      );
    });
    return session;
  }
  append(
    publicId: string,
    requestId: string,
    baseEvent: number,
    plan: TurnPlan,
    decision?: BotTelemetry,
  ): GameSession {
    if (
      !/^[a-zA-Z0-9:_.-]{1,120}$/.test(requestId) ||
      !Number.isSafeInteger(baseEvent) ||
      baseEvent < 0
    )
      throw new Error("Invalid command envelope");
    const row = this.row(publicId),
      id = Number(row.id);
    const requestHash = hash({ baseEvent, plan });
    const duplicate = this.get(
      "SELECT request_hash FROM game_commands WHERE game_id=? AND request_id=?",
      id,
      requestId,
    );
    if (duplicate) {
      if (duplicate.request_hash !== requestHash)
        throw new Error("Request ID reused with different command");
      return this.session(publicId);
    }
    if (row.last_event_seq !== baseEvent) throw new Error("Stale game cursor");
    const before = this.session(publicId);
    const next = commitPlan(before, plan);
    if (decision) {
      if (
        !decision.budget ||
        !decision.result ||
        hash(decision.result.plan) !== hash(plan) ||
        before.state.players[plan.playerId]?.controller !== "algorithmic" ||
        !Number.isSafeInteger(decision.budget.iterations) ||
        decision.budget.iterations < 1 ||
        !Number.isSafeInteger(decision.budget.seed) ||
        (decision.budget.timeMs !== undefined &&
          (!Number.isFinite(decision.budget.timeMs) ||
            decision.budget.timeMs <= 0)) ||
        Object.values(decision.result.stats).some(
          (v) => !Number.isFinite(v) || v < 0,
        )
      )
        throw new Error("Invalid bot telemetry");
    }
    this.transaction(() => {
      if (this.row(publicId).last_event_seq !== baseEvent)
        throw new Error("Stale game cursor");
      this.writeEvents(id, next.state, next.events.slice(before.events.length));
      this.snapshot(id, next.state);
      if (decision) {
        const d = decision.result,
          s = d.stats;
        const columns = [
          "game_id",
          "request_id",
          "seat",
          "base_event_seq",
          "committed_turn_seq",
          "status",
          "recorded_at_ms",
          "budget_iterations",
          "budget_time_ms",
          "search_seed",
          "elapsed_ms",
          "iterations",
          "nodes",
          "max_depth",
          "horizon",
          "horizon_visits",
          "terminal_visits",
          "root_choices",
          "reused_visits",
          "explanation",
          "plan_json",
          "environment_json",
        ];
        const values: SQLInputValue[] = [
          id,
          requestId,
          before.state.playerOrder.indexOf(plan.playerId),
          baseEvent,
          next.state.turnSequence,
          "committed",
          Date.now(),
          decision.budget.iterations,
          decision.budget.timeMs ?? null,
          decision.budget.seed,
          s.elapsedMs,
          s.iterations,
          s.nodes,
          s.maxDepth,
          s.horizon,
          s.horizonVisits,
          s.terminalVisits,
          s.rootChoices,
          s.reusedVisits,
          d.explanation,
          canonical(plan),
          canonical({
            runtime: decision.runtime,
            modelId: d.modelId,
            modelHash: d.modelHash,
          }),
        ];
        this.run(
          `INSERT INTO bot_decisions(${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
          ...values,
        );
      }
      this.run(
        "INSERT INTO game_commands VALUES (?,?,?,?,?)",
        id,
        requestId,
        requestHash,
        baseEvent,
        next.state.eventSequence,
      );
      this.run(
        "UPDATE games SET status=?,updated_at_ms=?,finished_at_ms=?,last_event_seq=?,last_turn_seq=?,last_action_seq=? WHERE id=?",
        next.state.result ? "finished" : "in_progress",
        Date.now(),
        next.state.result ? Date.now() : null,
        next.state.eventSequence,
        next.state.turnSequence,
        next.state.actionSequence,
        id,
      );
    });
    return next;
  }
  private writeEvents(
    id: number,
    state: GameState,
    events: readonly AcceptedEvent[],
  ) {
    for (const event of events) {
      const actor =
        event.type === "GameCreated"
          ? null
          : state.playerOrder.indexOf(event.playerId);
      this.run(
        "INSERT INTO game_events VALUES (?,?,?,?,?,?,?,1,?)",
        id,
        event.eventSequence,
        event.turnSequence,
        event.actionSequence,
        event.type,
        actor,
        Date.now(),
        canonical(event),
      );
      if (event.type === "TurnCommitted") {
        const p = event.plan;
        this.run(
          `INSERT INTO turns(game_id,turn_seq,event_seq,actor_seat,kind,action_seq,card_instance_id,card_type,effective_card,effect_tier,no_effect_reason,summon_kind,summon_region,summon_faction)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          id,
          event.turnSequence,
          event.eventSequence,
          actor,
          p.kind,
          p.kind === "card" ? event.actionSequence : null,
          p.kind === "card" ? p.cardId : null,
          event.card?.type ?? null,
          p.kind === "card" ? p.effect.effectiveCard : null,
          p.kind === "card" ? p.effect.tier : null,
          p.kind === "card" && p.effect.kind === "no-effect"
            ? p.effect.reason
            : null,
          p.kind === "card" ? p.summon.kind : null,
          p.kind === "card" && p.summon.kind === "follower"
            ? p.summon.regionId
            : null,
          p.kind === "card" && p.summon.kind === "follower"
            ? p.summon.faction
            : null,
        );
        if (p.kind === "card")
          p.effect.operations.forEach((op, index) => {
            if (op.kind === "transfer")
              this.run(
                "INSERT INTO turn_transfers VALUES (?,?,?,?,?,?,?)",
                id,
                event.turnSequence,
                index,
                op.faction,
                op.count,
                op.from.kind === "region" ? op.from.regionId : null,
                op.to.kind === "region" ? op.to.regionId : null,
              );
            else
              this.run(
                "INSERT INTO turn_region_swaps VALUES (?,?,?,?,?,?)",
                id,
                event.turnSequence,
                index,
                op.first,
                op.second,
                op.negotiationDiscOn,
              );
          });
      }
      if (event.type === "PowerStruggleResolved")
        this.run(
          "INSERT INTO struggles VALUES (?,?,?,?,?,?,?,?,?,?)",
          id,
          event.struggleIndex,
          event.eventSequence,
          event.turnSequence,
          event.regionId,
          event.control.kind,
          event.control.kind === "faction" ? event.control.faction : null,
          ...FACTIONS.map((f) => event.returnedToSupply[f]),
        );
      if (event.type === "GameFinished") {
        this.run(
          "INSERT INTO game_results VALUES (?,?,?,?)",
          id,
          event.eventSequence,
          event.result.kind,
          event.result.method,
        );
        state.playerOrder.forEach((playerId, seat) => {
          const result = event.result;
          const outcome =
            result.kind === "win"
              ? result.winner === playerId
                ? "win"
                : "loss"
              : result.contenders.includes(playerId)
                ? "draw"
                : "loss";
          this.run(
            "INSERT INTO player_results(game_id,seat,outcome,share_denominator) VALUES (?,?,?,?)",
            id,
            seat,
            outcome,
            outcome === "win"
              ? 1
              : outcome === "draw" && result.kind === "draw"
                ? result.contenders.length
                : null,
          );
        });
      }
    }
  }
  private snapshot(id: number, state: GameState) {
    const seq = state.eventSequence;
    this.run(
      "INSERT INTO game_snapshots VALUES (?,?,?,?,?,?,?)",
      id,
      seq,
      state.turnSequence,
      state.phase,
      state.playerOrder.indexOf(state.activePlayerId),
      state.schemaVersion,
      canonical(state),
    );
    state.playerOrder.forEach((playerId, seat) => {
      const p = state.players[playerId]!;
      this.run(
        "INSERT INTO player_snapshots VALUES (?,?,?,?,?,?,?,?)",
        id,
        seq,
        seat,
        p.hand.length,
        ...FACTIONS.map((f) => p.court[f]),
        p.lastActionSequence,
      );
    });
    for (const regionId of REGION_IDS) {
      const r = state.regions[regionId],
        c = state.regionCards.find((card) => card.regionId === regionId)!;
      this.run(
        "INSERT INTO region_snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        id,
        seq,
        regionId,
        c.slot,
        Number(c.faceUp),
        r.control.kind,
        r.control.kind === "faction" ? r.control.faction : null,
        r.control.kind === "unresolved" ? null : r.control.struggleIndex,
        c.negotiationDiscOwner === null
          ? null
          : state.playerOrder.indexOf(c.negotiationDiscOwner),
        ...FACTIONS.map((f) => r.followers[f]),
      );
    }
  }

  /** Replays authoritative commands, compares ALL events/checkpoints, then encodes
   * actor observations. Nothing is admitted by trusting a client-supplied vector. */
  materialize(publicId: string) {
    const row = this.row(publicId),
      id = Number(row.id);
    const stored = this.session(publicId),
      created = stored.events[0];
    if (created?.type !== "GameCreated" || !stored.state.result)
      throw new Error("Only completed games can be materialized");
    let replay: GameSession = createGame(created.config);
    if (hash(replay.events[0]) !== hash(created))
      throw new Error("Setup replay mismatch");
    const positions: {
      state: GameState;
      encoded: ReturnType<typeof encodePosition>;
    }[] = [];
    const commands = stored.events.filter((e) => e.type === "TurnCommitted");
    for (const command of commands) {
      if (command.type !== "TurnCommitted") continue;
      const reconstructed = reconstructStandard(
        getObservation(replay.state, replay.state.activePlayerId),
        witnessedCards(replay),
      );
      positions.push({
        state: replay.state,
        encoded: encodePosition(reconstructed),
      });
      replay = commitPlan(replay, command.plan);
      const checkpoint = this.get(
        "SELECT state_json FROM game_snapshots WHERE game_id=? AND event_seq=?",
        id,
        replay.state.eventSequence,
      );
      if (
        !checkpoint ||
        hash(JSON.parse(String(checkpoint.state_json))) !== hash(replay.state)
      )
        throw new Error("Checkpoint replay mismatch");
    }
    if (hash(replay) !== hash(stored))
      throw new Error("Accepted history/result replay mismatch");
    const initial = created.state;
    const initialPublic = {
      rules: initial.rulesVersion,
      count: initial.playerOrder.length,
      board: REGION_IDS.map((regionId) => initial.regions[regionId].followers),
      track: [...initial.regionCards]
        .sort((a, b) => a.slot - b.slot)
        .map((c) => c.regionId),
      courts: initial.playerOrder
        .map((p) => canonical(initial.players[p]!.court))
        .sort(),
    };
    const family = hash(initialPublic);
    const normalizedPlans = commands.map((event) => {
      if (event.type !== "TurnCommitted") return null;
      const plan = event.plan;
      return {
        ...plan,
        playerId: initial.playerOrder.indexOf(plan.playerId),
        ...(plan.kind === "card"
          ? {
              cardId: plan.cardId.replace(
                encodeURIComponent(plan.playerId),
                "seat",
              ),
            }
          : {}),
      };
    });
    const trajectory = hash({
      initialPublic,
      starting: initial.playerOrder.indexOf(initial.startingPlayerId),
      courts: initial.playerOrder.map((p) => initial.players[p]!.court),
      plans: normalizedPlans,
    });
    const digest = hash(stored.events);
    const source =
      row.source !== "benchmark" &&
      initial.playerOrder.some(
        (p) => initial.players[p]!.controller === "human",
      )
        ? "human"
        : initial.playerOrder.some(
              (p) => initial.players[p]!.botStrategy === "ml",
            )
          ? "self_play"
          : "teacher";
    this.transaction(() => {
      const prior = this.get(
        "SELECT source_digest FROM ml_games WHERE game_id=?",
        id,
      );
      if (prior && prior.source_digest !== digest)
        throw new Error("Immutable source digest mismatch");
      this.run(
        "INSERT INTO ml_games VALUES (?,?,?,?,?,?,?) ON CONFLICT(game_id) DO NOTHING",
        id,
        family,
        trajectory,
        source,
        digest,
        "replay-v1",
        Date.now(),
      );
      for (const { state, encoded } of positions) {
        const bytes = blob(encoded.features);
        const featureHash = createHash("sha256").update(bytes).digest("hex");
        const old = this.get(
          "SELECT features_hash FROM ml_positions WHERE game_id=? AND turn_seq=? AND feature_version=?",
          id,
          state.turnSequence + 1,
          FEATURE_VERSION,
        );
        if (old && old.features_hash !== featureHash)
          throw new Error("Immutable feature mismatch");
        this.run(
          `INSERT INTO ml_positions(game_id,turn_seq,base_event_seq,feature_version,feature_count,c0,c1,c2,features,features_hash)
          VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(game_id,turn_seq,feature_version) DO NOTHING`,
          id,
          state.turnSequence + 1,
          state.eventSequence,
          FEATURE_VERSION,
          FEATURE_COUNT,
          encoded.canonicalToPlayer[0],
          encoded.canonicalToPlayer[1],
          encoded.canonicalToPlayer[2] < 0
            ? null
            : encoded.canonicalToPlayer[2],
          bytes,
          featureHash,
        );
      }
    });
    return positions.length;
  }

  buildDataset(
    name: string,
    splitSeed = "split-v1",
    cohort: string | null = null,
    weighting: "equal-game-v1" | "equal-family-v1" = "equal-game-v1",
  ) {
    if (weighting !== "equal-game-v1" && weighting !== "equal-family-v1")
      throw new Error("Invalid dataset weighting");
    const config = canonical({
      splitSeed,
      cohort,
      featureVersion: FEATURE_VERSION,
      split: [0.8, 0.1, 0.1],
      weighting,
    });
    const existing = this.get("SELECT * FROM ml_datasets WHERE name=?", name);
    if (existing) {
      if (existing.config_json !== config || existing.status !== "frozen")
        throw new Error("Dataset name/config conflict");
      return Number(existing.id);
    }
    const games = this.all(
      `SELECT m.*,g.last_turn_seq FROM ml_games m JOIN games g ON g.id=m.game_id
      WHERE (? IS NULL OR g.dataset=?) ORDER BY m.game_id`,
      cohort,
      cohort,
    );
    if (!games.length) throw new Error("No validated games for dataset");
    const trajectories = new Set<string>();
    const familyGames = new Map<string, number>();
    for (const game of games) {
      if (trajectories.has(String(game.trajectory_hash))) continue;
      trajectories.add(String(game.trajectory_hash));
      const family = String(game.family_hash);
      familyGames.set(family, (familyGames.get(family) ?? 0) + 1);
    }
    return this.transaction(() => {
      const datasetId = Number(
        this.run(
          "INSERT INTO ml_datasets(name,feature_version,status,split_seed,config_json,created_at_ms) VALUES (?,?,'building',?,?,?)",
          name,
          FEATURE_VERSION,
          splitSeed,
          config,
          Date.now(),
        ).lastInsertRowid,
      );
      const ordinals: Record<string, number> = {
        train: 0,
        validation: 0,
        test: 0,
      };
      const seen = new Set<string>();
      const members: unknown[] = [];
      for (const game of games) {
        const trajectory = String(game.trajectory_hash);
        if (seen.has(trajectory)) continue;
        seen.add(trajectory);
        const family = String(game.family_hash),
          gameId = Number(game.game_id);
        const roll =
          parseInt(hash([splitSeed, family]).slice(0, 8), 16) / 2 ** 32;
        const split = roll < 0.8 ? "train" : roll < 0.9 ? "validation" : "test";
        this.run(
          "INSERT INTO ml_dataset_families VALUES (?,?,?) ON CONFLICT(dataset_id,family_hash) DO NOTHING",
          datasetId,
          family,
          split,
        );
        this.run(
          "INSERT INTO ml_dataset_games VALUES (?,?,?,?)",
          datasetId,
          gameId,
          family,
          trajectory,
        );
        const rows = this.all(
          "SELECT id,features_hash FROM ml_positions WHERE game_id=? AND feature_version=? ORDER BY turn_seq",
          gameId,
          FEATURE_VERSION,
        );
        if (rows.length !== game.last_turn_seq)
          throw new Error("Incomplete feature coverage");
        for (const position of rows) {
          const ordinal = ordinals[split]!++;
          this.run(
            "INSERT INTO ml_dataset_samples VALUES (?,?,?,?,?,?,?,?)",
            datasetId,
            split,
            ordinal,
            Number(position.id),
            gameId,
            family,
            FEATURE_VERSION,
            1 /
              rows.length /
              (weighting === "equal-family-v1" ? familyGames.get(family)! : 1),
          );
          members.push([split, ordinal, trajectory, position.features_hash]);
        }
      }
      this.run(
        "UPDATE ml_datasets SET status='frozen', frozen_at_ms=?, manifest_hash=? WHERE id=?",
        Date.now(),
        hash({ config, members }),
        datasetId,
      );
      return datasetId;
    });
  }
}
