import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")),
);
const count = Number(args.seats ?? 2),
  seeds = Number(args.seeds ?? 4),
  iterations = Number(args.iterations ?? 64);
const policy = args.bot ?? "mcts",
  opponent = args.opponent ?? "one-ply",
  prefix = args.prefix ?? "heldout-bot-v1";
if (
  ![2, 3].includes(count) ||
  !Number.isSafeInteger(seeds) ||
  seeds < 1 ||
  seeds > 10000 ||
  !["mcts", "reference", "patient", "one-ply", "random"].includes(policy) ||
  !["mcts", "reference", "patient", "random", "one-ply"].includes(opponent)
)
  throw new Error("Invalid benchmark options");
const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: false,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
});
try {
  const [setup, turns, visibility, memory, search, simulation, patient] =
    await Promise.all(
      [
        "/src/game/setup.ts",
        "/src/game/turns.ts",
        "/src/game/visibility.ts",
        "/src/app/botObservation.ts",
        "/src/bot/search.ts",
        "/src/bot/simulation.ts",
        "/src/bot/patient.ts",
      ].map((path) => server.ssrLoadModule(path)),
    );
  const games = [];
  for (let seed = 0; seed < seeds; seed++) {
    for (let seat = 0; seat < count; seat++) {
      const bot = new search.StandardBot(),
        patientBot = new patient.PatientBot(),
        random = simulation.seededRandom(seed * 100 + seat + 1);
      let session = setup.createGame({
        seed: `${prefix}-${seed}`,
        mode: "standard",
        players: Array.from({ length: count }, (_, i) => {
          const strategy = i === seat ? policy : opponent;
          return {
            id: `p${i}`,
            controller: ["mcts", "reference", "patient"].includes(strategy)
              ? "algorithmic"
              : "human",
            ...(["mcts", "reference", "patient"].includes(strategy)
              ? {
                  botStrategy: strategy === "patient" ? "patient" : "reference",
                }
              : {}),
          };
        }),
      });
      const stats = [];
      let policyMs = 0;
      let opening = null;
      while (session.state.phase === "turn") {
        if (session.state.turnSequence > count * (8 * count + 8))
          throw new Error("Game exceeded finite turn bound");
        const state = session.state,
          isBot = state.activePlayerId === `p${seat}`,
          strategy = isBot ? policy : opponent;
        let plan;
        const start = performance.now();
        if (["mcts", "reference", "patient"].includes(strategy)) {
          const result = (strategy === "patient" ? patientBot : bot).search({
            observation: visibility.getObservation(state, state.activePlayerId),
            memory: memory.witnessedCards(session),
            budget: { iterations, seed: Math.floor(random() * 2 ** 32) },
          });
          plan = result.plan;
          if (isBot) stats.push(result.stats);
        } else if (strategy === "one-ply") plan = search.onePly(state, random);
        else plan = simulation.randomPlan(state, random);
        if (isBot) policyMs += performance.now() - start;
        // Every submitted move independently checked by the public engine.
        const commit = turns.turnEngine.commitTurn(state, plan);
        if (
          opening === null &&
          commit.events.some((event) => event.type === "PowerStruggleResolved")
        ) {
          opening = {
            firstStruggleTurn: commit.state.turnSequence,
            hands: Object.fromEntries(
              Object.values(commit.state.players).map((player) => [
                player.id,
                player.hand.length,
              ]),
            ),
          };
        }
        session = {
          state: commit.state,
          events: [...session.events, ...commit.events],
        };
      }
      const result = session.state.result;
      const score =
        result.kind === "win"
          ? Number(result.winner === `p${seat}`)
          : result.contenders.includes(`p${seat}`)
            ? 1 / result.contenders.length
            : 0;
      games.push({
        seed,
        seat,
        score,
        opening,
        outcome: result.kind,
        winner: result.kind === "win" ? result.winner : null,
        contenders:
          result.kind === "draw" ? result.contenders : [result.winner],
        turns: session.state.turnSequence,
        method: result.method,
        policyMs,
        searches: stats.length,
        iterations: stats.reduce((s, x) => s + x.iterations, 0),
        horizonVisits: stats.reduce((s, x) => s + x.horizonVisits, 0),
        terminalVisits: stats.reduce((s, x) => s + x.terminalVisits, 0),
        maxDepth: Math.max(0, ...stats.map((x) => x.maxDepth)),
      });
    }
    if (args.progress)
      process.stderr.write(`Completed seed ${seed + 1}/${seeds}\n`);
  }
  const paired = Array.from(
    { length: seeds },
    (_, s) =>
      games.filter((g) => g.seed === s).reduce((sum, g) => sum + g.score, 0) /
      count,
  );
  const mean = paired.reduce((a, b) => a + b, 0) / seeds;
  // Bootstrap whole seed clusters; seat rotations of a setup are dependent.
  const rng = simulation.seededRandom(8527),
    boot = Array.from(
      { length: 5000 },
      () =>
        Array.from(
          { length: seeds },
          () => paired[Math.floor(rng() * seeds)],
        ).reduce((a, b) => a + b, 0) / seeds,
    ).sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        version:
          policy === "patient"
            ? patient.PATIENT_BOT_VERSION
            : search.BOT_VERSION,
        policyVersions: {
          reference: search.BOT_VERSION,
          patient: patient.PATIENT_BOT_VERSION,
        },
        policy,
        opponent,
        count,
        seeds,
        iterations,
        prefix,
        note: "Node timings, fixed iterations. Draws share one point. CI resamples paired setup seeds; tiny samples are exploratory, not a release gate.",
        score: mean,
        seedBootstrap95: [boot[125], boot[4874]],
        games,
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
