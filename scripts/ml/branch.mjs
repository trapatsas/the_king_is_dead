import { DatabaseSync } from "node:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { argumentsOf, integer, runtime } from "./runtime.mjs";

const args = argumentsOf(process.argv.slice(2));
const allowed = new Set([
  "sourceDb",
  "game",
  "turns",
  "db",
  "iterations",
  "branches",
  "cohort",
  "out",
]);
for (const key of Object.keys(args))
  if (!allowed.has(key)) throw new Error(`Unknown option --${key}`);
if (!args.game || !args.turns || !args.db || !args.out)
  throw new Error(
    "Required: --game=<id> --turns=33,36 --db=<destination> --out=<report>",
  );
const sourcePath = resolve(args.sourceDb ?? ".data/king.sqlite");
if (sourcePath === resolve(args.db))
  throw new Error("Use a separate destination database");
const turns = [...new Set(args.turns.split(",").map((t) => integer(t, 1)))];
const iterations = integer(args.iterations, 128);
const limit = integer(args.branches, 4, 1, 32);
const cohort = args.cohort ?? "tactical-branches-v1";
const source = new DatabaseSync(sourcePath, { readOnly: true });
let rt, destination;
try {
  const game = source
    .prepare(
      "SELECT * FROM games WHERE public_id=? AND status='finished' AND mode='standard'",
    )
    .get(args.game);
  if (!game) throw new Error("Source must be a completed Standard game");
  const events = source
    .prepare(
      "SELECT payload_json FROM game_events WHERE game_id=? ORDER BY event_seq",
    )
    .all(game.id)
    .map((r) => JSON.parse(r.payload_json));
  rt = await runtime();
  const commands = events.filter((e) => e.type === "TurnCommitted");
  if (turns.some((t) => t > commands.length))
    throw new Error("Branch turn exceeds recorded game");
  const created = events[0];
  let replay = rt.setup.createGame(created.config);
  for (const e of commands) replay = rt.turns.commitPlan(replay, e.plan);
  if (
    !replay.state.result ||
    rt.repository.hash(replay.events) !== rt.repository.hash(events)
  )
    throw new Error("Source history failed authoritative replay");
  // Same board, courts, track, hands and IDs; all continuations use the teacher.
  const config = {
    ...created.config,
    players: created.config.players.map((p) => ({
      id: p.id,
      controller: "algorithmic",
      botStrategy: "informed",
    })),
  };
  destination = new rt.repository.GameRepository(args.db);
  const report = {
    version: 1,
    sourceGame: args.game,
    sourceDigest: rt.repository.hash(events),
    cohort,
    teacher: rt.informed.INFORMED_BOT_VERSION,
    iterations,
    games: [],
  };
  await mkdir(dirname(resolve(args.out)), { recursive: true });
  for (const turn of turns) {
    let prefix = rt.setup.createGame(config);
    for (const command of commands.slice(0, turn - 1))
      prefix = rt.turns.commitPlan(prefix, command.plan);
    const candidates = rt.branches.trainingBranchPlans(
      prefix.state,
      commands[turn - 1].plan,
      limit,
    );
    for (const forced of candidates) {
      const params = {
        ...rt.informed.DEFAULT_INFORMED_PARAMS,
        sourceGame: args.game,
        sourceDigest: report.sourceDigest,
        turn,
        forced,
        iterations,
        searchSeedRule: "turn*7919+seat+1",
        continuation: "fresh-informed-v2",
      };
      const options = {
        source: "benchmark",
        cohort,
        bots: Object.fromEntries(
          config.players.map((p) => [
            p.id,
            { version: rt.informed.INFORMED_BOT_VERSION, params },
          ]),
        ),
      };
      const digest = rt.repository.hash({ config, options });
      const id = `king-${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
      let session = destination.create(id, config, options);
      if (!session.state.result) {
        // Replay searches as well as moves on resume, preserving tree reuse.
        const prior = session.events.filter((e) => e.type === "TurnCommitted");
        session = rt.setup.createGame(config);
        const bots = Object.fromEntries(
          config.players.map((p) => [p.id, new rt.informed.InformedBot()]),
        );
        while (session.state.phase === "turn") {
          const state = session.state,
            nextTurn = state.turnSequence + 1;
          let plan, decision;
          if (nextTurn < turn) plan = commands[nextTurn - 1].plan;
          else if (nextTurn === turn) plan = forced;
          else {
            const budget = {
              iterations,
              seed:
                state.turnSequence * 7919 +
                state.playerOrder.indexOf(state.activePlayerId) +
                1,
            };
            const result = bots[state.activePlayerId].search({
              observation: rt.observation.getObservation(
                state,
                state.activePlayerId,
              ),
              memory: rt.memory.witnessedCards(session),
              budget,
            });
            plan = result.plan;
            decision = { budget, result, runtime: process.version };
          }
          const old = prior[nextTurn - 1];
          if (old && rt.repository.hash(old.plan) !== rt.repository.hash(plan))
            throw new Error("Resume policy/version mismatch");
          session = old
            ? rt.turns.commitPlan(session, old.plan)
            : destination.append(
                id,
                `turn-${nextTurn}`,
                state.eventSequence,
                plan,
                decision,
              );
          if (
            nextTurn >
            config.players.length * (8 * config.players.length + 8)
          )
            throw new Error("Finite game bound exceeded");
        }
      }
      const positions = destination.materialize(id);
      report.games.push({
        id,
        branchTurn: turn,
        forced,
        positions,
        result: session.state.result,
      });
      process.stderr.write(
        `Validated branch ${report.games.length}: turn ${turn}\n`,
      );
    }
  }
  // Reports are reviewable; accepted games are immutable and resume by ID.
  await writeFile(args.out, JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      games: report.games.length,
      positions: report.games.reduce((n, g) => n + g.positions, 0),
      db: args.db,
      out: args.out,
    }),
  );
} finally {
  source.close();
  destination?.close();
  await rt?.close();
}
