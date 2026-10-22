import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { argumentsOf, integer, loadModel, runtime } from "./runtime.mjs";

const args = argumentsOf(process.argv.slice(2));
const allowed = new Set([
  "lineup",
  "seed",
  "seeds",
  "rotations",
  "iterations",
  "timeMs",
  "db",
  "out",
]);
for (const key of Object.keys(args))
  if (!allowed.has(key)) throw new Error(`Unknown option --${key}`);
const iterations = integer(args.iterations, 128);
const timeMs = args.timeMs === undefined ? undefined : Number(args.timeMs);
if (timeMs !== undefined && (!Number.isFinite(timeMs) || timeMs <= 0))
  throw new Error("Invalid timeMs");
const lineup = JSON.parse(
  await readFile(
    args.lineup ?? "scripts/ml/lineups/informed-pilot-v2.json",
    "utf8",
  ),
);
if (
  !Array.isArray(lineup) ||
  ![2, 3].includes(lineup.length) ||
  lineup.some(
    (p) =>
      !p ||
      typeof p.name !== "string" ||
      !p.name.trim() ||
      p.name !== p.name.trim() ||
      p.name.length > 40 ||
      !["reference", "patient", "informed", "ml"].includes(p.strategy) ||
      (p.strategy === "ml"
        ? typeof p.model !== "string" || !p.model
        : p.model !== undefined),
  ) ||
  new Set(lineup.map((p) => p.name.toLowerCase())).size !== lineup.length
)
  throw new Error(
    "Lineup requires 2 or 3 uniquely named bots and ML model paths",
  );
const seeds = integer(args.seeds, 1, 1, 10000);
const rotations = integer(args.rotations, 1, 1, lineup.length);
const batch = seeds * rotations > 1;
const seedPrefix = args.seed ?? `mixed-${randomUUID()}`;

const id = `king-${randomUUID()}`;
const out = args.out ?? `artifacts/ml/matches/${id}.json`;
await mkdir(dirname(out), { recursive: true });
// Reserve a new report before starting; never overwrite an existing game.
await writeFile(out, JSON.stringify({ status: "starting", id }) + "\n", {
  flag: "wx",
});
const rt = await runtime();
let repo;
const games = [];
let activeGameId = null;
async function saveReport(report) {
  const temporary = `${out}.${id}.partial`;
  await writeFile(temporary, JSON.stringify(report, null, 2) + "\n");
  await rename(temporary, out);
}
try {
  const players = [];
  const factories = [];
  const provenance = {};
  for (const p of lineup) {
    const model =
      p.strategy === "ml" ? await loadModel(p.model, rt.model) : null;
    if (model && !model.manifest.supportedSeats.includes(lineup.length))
      throw new Error(`Model for ${p.name} does not support this seat count`);
    const createBot = () =>
      p.strategy === "ml"
        ? new rt.ml.MlBot(model)
        : p.strategy === "informed"
          ? new rt.informed.InformedBot()
          : p.strategy === "patient"
            ? new rt.patient.PatientBot()
            : new rt.search.StandardBot();
    factories.push(createBot);
    const version =
      p.strategy === "ml"
        ? rt.ml.ML_BOT_VERSION
        : p.strategy === "informed"
          ? rt.informed.INFORMED_BOT_VERSION
          : p.strategy === "patient"
            ? rt.patient.PATIENT_BOT_VERSION
            : rt.search.BOT_VERSION;
    const params = {
      ...(p.strategy === "informed" ? rt.informed.DEFAULT_INFORMED_PARAMS : {}),
      iterations,
      ...(timeMs === undefined ? {} : { timeMs }),
      searchSeedRule: "turn*7919+seat+1",
      ...(model
        ? {
            modelId: model.manifest.modelId,
            modelHash: model.manifest.weightsSha256,
            learnedWeight: model.manifest.learnedWeight,
          }
        : {}),
    };
    provenance[p.name] = { version, params };
    players.push({
      name: p.name,
      strategy: p.strategy,
      ...(model ? { manifestPath: p.model } : {}),
      version,
      ...params,
    });
  }
  const db = args.db ?? ".data/ml-matches.sqlite";
  repo = new rt.repository.GameRepository(db);
  function playGame(seedIndex, rotation) {
    const gameId = batch ? `king-${randomUUID()}` : id;
    activeGameId = gameId;
    const order = lineup.map((_, seat) => (seat + rotation) % lineup.length);
    const seatedPlayers = order.map((i) => players[i]);
    // Fresh trees for every seat and every game. Models stay frozen for the run.
    const bots = order.map((i) => factories[i]());
    const config = {
      mode: "standard",
      seed: seeds === 1 ? seedPrefix : `${seedPrefix}-${seedIndex}`,
      players: order.map((i) => {
        const p = lineup[i];
        return {
          id: p.name,
          controller: "algorithmic",
          botStrategy: p.strategy,
        };
      }),
    };
    let session = repo.create(gameId, config, {
      source: "benchmark",
      cohort: "mixed-model-matches-v1",
      bots: provenance,
    });
    const row = repo.get(
      "SELECT created_at_ms FROM games WHERE public_id=?",
      gameId,
    );
    const createdAt = new Date(Number(row.created_at_ms)).toISOString();
    const totals = players.map(() => ({
      searches: 0,
      iterations: 0,
      elapsedMs: 0,
    }));
    while (session.state.phase === "turn") {
      const state = session.state;
      if (state.turnSequence >= lineup.length * (8 * lineup.length + 8))
        throw new Error("Game exceeded finite turn bound");
      const seat = state.playerOrder.indexOf(state.activePlayerId);
      const budget = {
        iterations,
        ...(timeMs === undefined ? {} : { timeMs }),
        seed: state.turnSequence * 7919 + seat + 1,
      };
      const result = bots[seat].search({
        observation: rt.observation.getObservation(state, state.activePlayerId),
        memory: rt.memory.witnessedCards(session),
        budget,
      });
      if (
        seatedPlayers[seat].strategy === "ml" &&
        (result.modelId !== seatedPlayers[seat].modelId ||
          result.modelHash !== seatedPlayers[seat].modelHash)
      )
        throw new Error("Search returned the wrong seat's model");
      session = repo.append(
        gameId,
        `turn-${state.turnSequence + 1}`,
        state.eventSequence,
        result.plan,
        { budget, result, runtime: process.version },
      );
      totals[seat].searches++;
      totals[seat].iterations += result.stats.iterations;
      totals[seat].elapsedMs += result.stats.elapsedMs;
      if (!batch)
        process.stderr.write(
          `Turn ${session.state.turnSequence}: ${state.activePlayerId} ${result.plan.kind === "pass" ? "passed" : "played " + result.plan.effect.effectiveCard}\n`,
        );
    }
    const positions = repo.materialize(gameId);
    const archive = rt.archive.archiveSnapshot(gameId, createdAt, session);
    const report = {
      version: 1,
      status: "finished",
      id: gameId,
      db,
      seed: config.seed,
      seedIndex,
      rotation,
      players: seatedPlayers.map((p, i) => ({ ...p, stats: totals[i] })),
      turns: session.state.turnSequence,
      positions,
      result: session.state.result,
      game: archive,
      note: "One mixed-lineup game; not a strength estimate. Fixed iterations are reproducible within the same runtime/code; time-limited searches may differ.",
    };
    return report;
  }
  for (let seedIndex = 0; seedIndex < seeds; seedIndex++) {
    for (let rotation = 0; rotation < rotations; rotation++) {
      const report = playGame(seedIndex, rotation);
      games.push(report);
      activeGameId = null;
      await saveReport(
        batch
          ? {
              version: 1,
              status: "running",
              id,
              db,
              seedPrefix,
              seeds,
              rotations,
              plannedGames: seeds * rotations,
              completedGames: games.length,
              games,
            }
          : report,
      );
      if (batch)
        process.stderr.write(
          `Completed ${games.length}/${seeds * rotations}: seed ${seedIndex + 1}/${seeds}, rotation ${rotation + 1}/${rotations}, ${report.result.kind === "win" ? report.result.winner + " wins" : "draw"}\n`,
        );
    }
  }
  const summary = players.map((player) => {
    const scores = games.map(({ result }) =>
      result.kind === "win"
        ? Number(result.winner === player.name)
        : result.contenders.includes(player.name)
          ? 1 / result.contenders.length
          : 0,
    );
    const bySeed = Array.from(
      { length: seeds },
      (_, seedIndex) =>
        scores
          .slice(seedIndex * rotations, (seedIndex + 1) * rotations)
          .reduce((a, b) => a + b, 0) / rotations,
    );
    const random = rt.simulation.seededRandom(8527);
    const boot =
      seeds < 2
        ? []
        : Array.from(
            { length: 5000 },
            () =>
              Array.from(
                { length: seeds },
                () => bySeed[Math.floor(random() * seeds)],
              ).reduce((a, b) => a + b, 0) / seeds,
          ).sort((a, b) => a - b);
    return {
      ...player,
      games: games.length,
      wins: games.filter(
        (g) => g.result.kind === "win" && g.result.winner === player.name,
      ).length,
      draws: games.filter(
        (g) =>
          g.result.kind === "draw" && g.result.contenders.includes(player.name),
      ).length,
      losses: scores.filter((s) => s === 0).length,
      score: scores.reduce((a, b) => a + b, 0) / scores.length,
      seedBootstrap95: boot.length ? [boot[125], boot[4874]] : null,
    };
  });
  if (batch)
    await saveReport({
      version: 1,
      status: "finished",
      id,
      db,
      seedPrefix,
      seeds,
      rotations,
      plannedGames: seeds * rotations,
      completedGames: games.length,
      players: summary,
      games,
      note: "Cyclic seat rotations share each setup seed. Draws share one point; 95% bootstrap intervals resample whole setup seeds. Timed searches may differ between runs.",
    });
  console.log(
    JSON.stringify(
      {
        id,
        out,
        db,
        ...(batch
          ? {
              seedPrefix,
              seeds,
              rotations,
              games: games.length,
              players: summary,
            }
          : {
              seed: games[0].seed,
              players: games[0].players,
              turns: games[0].turns,
              result: games[0].result,
            }),
      },
      null,
      2,
    ),
  );
} catch (error) {
  await saveReport({
    status: "failed",
    id,
    activeGameId,
    error: String(error),
    plannedGames: seeds * rotations,
    completedGames: games.length,
    games,
  });
  throw error;
} finally {
  repo?.close();
  await rt.close();
}
