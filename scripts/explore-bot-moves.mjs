import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Read-only investigation: load the existing TS engine, without an HTTP server,
// bot implementation, new dependencies, or changes to game/session state.
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true, hmr: false, watch: null },
});

try {
  const [setup, turns, effects, summons] = await Promise.all([
    server.ssrLoadModule("/src/game/setup.ts"),
    server.ssrLoadModule("/src/game/turns.ts"),
    server.ssrLoadModule("/src/game/effects/execute.ts"),
    server.ssrLoadModule("/src/game/summons.ts"),
  ]);
  const engine = turns.turnEngine;
  const measurements = [];
  let profileState;
  for (const count of [2, 3]) {
    for (let seedIndex = 0; seedIndex < 4; seedIndex += 1) {
      const seed = `bot-exploration-${count}-${seedIndex}`;
      const { state } = setup.createGame({
        seed,
        mode: "standard",
        players: Array.from({ length: count }, (_, index) => ({
          id: `p${index + 1}`,
          controller: "human",
        })),
      });
      const start = performance.now();
      const byCard = [];
      let completePlans = 1; // Passing is a separate legal turn.
      for (const card of engine.getAvailableCards(
        state,
        state.activePlayerId,
      )) {
        const plans = engine.enumerateEffectPlans(
          state,
          state.activePlayerId,
          card.id,
        );
        let completeCardPlans = 0;
        for (const effect of plans) {
          const afterEffect = effects.applyEffectOperations(
            state,
            state.activePlayerId,
            effect.operations,
          );
          completeCardPlans +=
            summons.enumerateSummonChoices(afterEffect).length;
        }
        completePlans += completeCardPlans;
        byCard.push({
          type: card.type,
          effects: plans.length,
          completePlans: completeCardPlans,
        });
      }
      measurements.push({
        players: count,
        seed,
        completePlans,
        countEnumerationMs: Number((performance.now() - start).toFixed(2)),
        byCard,
      });
      if (count === 3 && seedIndex === 0) profileState = state;
    }
  }

  if (!profileState) throw new Error("Missing profile position");
  const actor = profileState.activePlayerId;
  const card = engine
    .getAvailableCards(profileState, actor)
    .find((item) => item.type === "assemble");
  if (!card) throw new Error("Missing Assemble profile card");
  const effectPlans = engine.enumerateEffectPlans(profileState, actor, card.id);
  const samples = effectPlans.slice(0, 32).map((effect) => ({
    playerId: actor,
    baseTurnSequence: profileState.turnSequence,
    selection: { kind: "card", cardId: card.id, effect, summon: null },
  }));
  // Warm the existing API paths before timing a bounded sample.
  for (const sample of samples.slice(0, 4))
    engine.previewTurn(profileState, sample);
  const previewStart = performance.now();
  const previews = samples.map((sample) =>
    engine.previewTurn(profileState, sample),
  );
  const previewMs = performance.now() - previewStart;
  const completeSamples = samples.map((sample, index) => ({
    playerId: actor,
    baseTurnSequence: profileState.turnSequence,
    kind: "card",
    cardId: card.id,
    effect: sample.selection.effect,
    summon: previews[index].summonChoices[0],
  }));
  for (const plan of completeSamples.slice(0, 4))
    engine.commitTurn(profileState, plan);
  const commitStart = performance.now();
  for (const plan of completeSamples) engine.commitTurn(profileState, plan);
  const commitMs = performance.now() - commitStart;
  console.log(
    JSON.stringify(
      {
        note: "Node/container timings; initial Standard positions only. Counting uses existing engine effect/summon helpers and does not materialize, evaluate, or commit every complete plan. Public API timings use 32 Assemble samples; no playing-strength result is measured.",
        measurements,
        publicApiProfile: {
          seed: profileState.initialSeed,
          assembleEffects: effectPlans.length,
          sampledEffects: samples.length,
          averageEffectPreviewMs: Number(
            (previewMs / samples.length).toFixed(3),
          ),
          averageCompleteCommitMs: Number(
            (commitMs / samples.length).toFixed(3),
          ),
        },
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
