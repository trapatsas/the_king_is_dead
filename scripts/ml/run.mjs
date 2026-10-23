import { DatabaseSync } from "node:sqlite";
import {
  readFileSync,
  mkdirSync,
  renameSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { argumentsOf, integer, runtime, loadModel } from "./runtime.mjs";

const command = process.argv[2];
const args = argumentsOf(process.argv.slice(3));
const allowed = new Set([
  "db",
  "seeds",
  "seats",
  "iterations",
  "prefix",
  "policies",
  "noise",
  "openings",
  "model",
  "name",
  "splitSeed",
  "cohort",
  "out",
  "weighting",
]);
for (const key of Object.keys(args))
  if (!allowed.has(key)) throw new Error(`Unknown option --${key}`);
const rt = await runtime();
const repo = new rt.repository.GameRepository(args.db ?? ".data/king.sqlite");
try {
  if (command === "generate") {
    const seeds = integer(args.seeds, 10, 1, 10000);
    const seats = (args.seats ?? "2,3").split(",").map(Number);
    const policies = (args.policies ?? "reference,patient,informed").split(",");
    if (
      !seats.length ||
      seats.some((n) => n !== 2 && n !== 3) ||
      policies.some(
        (p) =>
          !["reference", "patient", "informed", "random", "ml"].includes(p),
      )
    )
      throw new Error("Invalid seats/policies");
    const iterations = integer(args.iterations, 32);
    const noise = Number(args.noise ?? 0.05),
      openings = integer(args.openings, 0, 0, 12);
    if (!Number.isFinite(noise) || noise < 0 || noise > 0.5)
      throw new Error("Noise must be in [0, 0.5]");
    const prefix = args.prefix ?? "ml-boot-v1";
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(prefix))
      throw new Error("Invalid prefix");
    const model = policies.includes("ml")
      ? await loadModel(
          args.model ?? "public/models/pilot/manifest.json",
          rt.model,
        )
      : null;
    let games = 0,
      positions = 0;
    for (const count of seats)
      for (let seed = 0; seed < seeds; seed++)
        for (let rotation = 0; rotation < count; rotation++) {
          const types = Array.from(
            { length: count },
            (_, i) =>
              policies[
                (seed % 4 === 0 ? seed : seed + i + rotation) % policies.length
              ],
          );
          const config = {
            seed: `${prefix}-${count}-${seed}`,
            mode: "standard",
            players: types.map((strategy, i) => ({
              id: `p${i}`,
              controller: strategy === "random" ? "human" : "algorithmic",
              ...(strategy === "random" ? {} : { botStrategy: strategy }),
            })),
          };
          const bots = types.map((strategy) =>
            strategy === "ml"
              ? new rt.ml.MlBot(model)
              : strategy === "informed"
                ? new rt.informed.InformedBot()
                : strategy === "patient"
                  ? new rt.patient.PatientBot()
                  : new rt.search.StandardBot(),
          );
          const options = {
            source: "benchmark",
            cohort: prefix,
            bots: Object.fromEntries(
              config.players.map((p, i) => [
                p.id,
                {
                  version:
                    types[i] === "ml"
                      ? rt.ml.ML_BOT_VERSION
                      : types[i] === "informed"
                        ? rt.informed.INFORMED_BOT_VERSION
                        : types[i] === "patient"
                          ? rt.patient.PATIENT_BOT_VERSION
                          : rt.search.BOT_VERSION,
                  params: {
                    iterations,
                    noise,
                    openings,
                    searchSeedRule: "turn*7919+seat+1",
                    ...(types[i] === "informed"
                      ? rt.informed.DEFAULT_INFORMED_PARAMS
                      : {}),
                    ...(types[i] === "ml"
                      ? {
                          modelId: model.manifest.modelId,
                          modelHash: model.manifest.weightsSha256,
                          learnedWeight: model.manifest.learnedWeight,
                        }
                      : {}),
                  },
                },
              ]),
            ),
          };
          const digest = rt.repository.hash({ config, options, rotation });
          const publicId = `king-${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
          const accepted = repo.create(publicId, config, options);
          if (accepted.state.result) {
            positions += repo.materialize(publicId);
            games++;
            process.stderr.write(`Already recorded ${games}: ${count} seats\n`);
            continue;
          }
          const prior = accepted.events.filter(
            (e) => e.type === "TurnCommitted",
          );
          let session = rt.setup.createGame(config);
          const random = rt.simulation.seededRandom(
            parseInt(digest.slice(0, 8), 16),
          );
          // Replay searches too, restoring tree/RNG history on interrupted runs.
          while (session.state.phase === "turn") {
            const state = session.state,
              seat = state.playerOrder.indexOf(state.activePlayerId);
            const budget = {
              iterations,
              seed: state.turnSequence * 7919 + seat + 1,
            };
            let plan, decision;
            if (types[seat] === "random")
              plan = rt.simulation.randomPlan(state, random);
            else {
              const result = bots[seat].search({
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
            if (state.turnSequence < openings || random() < noise) {
              plan = rt.simulation.randomPlan(state, random);
              decision = undefined;
            }
            const old = prior[state.turnSequence];
            if (
              old &&
              rt.repository.hash(old.plan) !== rt.repository.hash(plan)
            )
              throw new Error("Resume policy/version mismatch");
            if (old) session = rt.turns.commitPlan(session, old.plan);
            else
              session = repo.append(
                publicId,
                `turn-${state.turnSequence + 1}`,
                state.eventSequence,
                plan,
                decision,
              );
            if (session.state.turnSequence > count * (8 * count + 8))
              throw new Error("Finite game bound exceeded");
          }
          positions += repo.materialize(publicId);
          games++;
          process.stderr.write(
            `Recorded ${games}: ${count} seats, ${session.state.turnSequence} turns\n`,
          );
        }
    console.log(
      JSON.stringify({
        games,
        positions,
        prefix,
        db: args.db ?? ".data/king.sqlite",
      }),
    );
  } else if (command === "materialize") {
    let games = 0,
      positions = 0;
    for (const row of repo.all(
      "SELECT public_id FROM games WHERE status='finished' AND mode='standard' ORDER BY id",
    )) {
      positions += repo.materialize(String(row.public_id));
      games++;
    }
    console.log(JSON.stringify({ games, positions }));
  } else if (command === "dataset") {
    const id = repo.buildDataset(
      args.name ?? "ml-bootstrap-v1",
      args.splitSeed ?? "split-v1",
      args.cohort ?? null,
      args.weighting ?? "equal-game-v1",
    );
    console.log(
      JSON.stringify({
        datasetId: id,
        coverage: repo.all(
          "SELECT split,source_kind,player_count,count(*) AS positions,count(DISTINCT game_id) AS games FROM v_ml_training_samples WHERE dataset_id=? GROUP BY split,source_kind,player_count",
          id,
        ),
      }),
    );
  } else if (command === "export") {
    if (!args.out || existsSync(args.out))
      throw new Error("Supply --out=<new file>");
    const dataset = repo.get(
      "SELECT * FROM ml_datasets WHERE name=? AND status='frozen'",
      args.name ?? "ml-bootstrap-v1",
    );
    if (!dataset) throw new Error("Unknown frozen dataset");
    mkdirSync(dirname(resolve(args.out)), { recursive: true });
    const temp = `${args.out}.partial`;
    if (existsSync(temp))
      throw new Error("Partial export exists; inspect before retrying");
    const out = new DatabaseSync(temp);
    try {
      out.exec(
        readFileSync(resolve("docs/sqlite/training_export.sql"), "utf8"),
      );
      const count = Number(
        repo.get(
          "SELECT count(*) AS n FROM ml_dataset_samples WHERE dataset_id=?",
          Number(dataset.id),
        ).n,
      );
      out.exec("BEGIN");
      out
        .prepare("INSERT INTO manifest VALUES(1,1,?,?,?,'float32-le',?,?,?)")
        .run(
          String(dataset.name),
          String(dataset.feature_version),
          rt.features.FEATURE_COUNT,
          String(dataset.manifest_hash),
          count,
          JSON.stringify({
            schema: rt.features.FEATURE_SCHEMA,
            dataset: JSON.parse(String(dataset.config_json)),
            synthetic: false,
          }),
        );
      const insert = out.prepare(
        "INSERT INTO samples VALUES(?,1,?,?,?,?,?,?,?,?,?,?,?,?)",
      );
      let index = 0;
      const query = repo.db.prepare(
        "SELECT * FROM v_ml_training_samples WHERE dataset_id=? ORDER BY split,ordinal",
      );
      for (const row of query.iterate(Number(dataset.id))) {
        insert.run(
          ++index,
          String(row.split),
          rt.repository.hash([dataset.manifest_hash, row.game_id]),
          String(row.family_hash),
          String(row.source_kind),
          Number(row.player_count),
          Number(row.turn_seq),
          Number(row.feature_count),
          row.features,
          Number(row.target0),
          Number(row.target1),
          Number(row.target2),
          Number(row.sample_weight),
        );
      }
      if (index !== count) throw new Error("Export count mismatch");
      out.exec("COMMIT");
      if (
        out.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
        out.prepare("PRAGMA foreign_key_check").all().length
      )
        throw new Error("Invalid export");
      out.close();
      renameSync(temp, args.out);
      console.log(
        JSON.stringify({
          file: args.out,
          samples: index,
          manifestHash: dataset.manifest_hash,
        }),
      );
    } catch (error) {
      try {
        out.close();
      } catch {}
      if (existsSync(temp)) unlinkSync(temp);
      throw error;
    }
  } else if (command === "init") {
    console.log(
      JSON.stringify({ db: args.db ?? ".data/king.sqlite", version: 2 }),
    );
  } else
    throw new Error("Commands: init, generate, materialize, dataset, export");
} finally {
  repo.close();
  await rt.close();
}
