import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { argumentsOf, loadModel, runtime } from "./runtime.mjs";
const args = argumentsOf(process.argv.slice(2));
const rt = await runtime();
try {
  const file = args.model ?? "public/models/pilot/manifest.json";
  const model = await loadModel(file, rt.model);
  const fixture = JSON.parse(
    await readFile(resolve(dirname(file), "parity.json"), "utf8"),
  );
  if (fixture.modelId !== model.manifest.modelId)
    throw new Error("Parity fixture identity mismatch");
  const input = Float32Array.from(fixture.inputs.flat());
  const output = model.predictBatch(input, fixture.inputs.length);
  let maxAbsoluteError = 0;
  fixture.logits.flat().forEach((expected, i) => {
    const error = Math.abs(expected - output[i]);
    maxAbsoluteError = Math.max(maxAbsoluteError, error);
    if (error > 1e-5 + 1e-4 * Math.abs(expected))
      throw new Error(`Python/TypeScript parity failed at ${i}: ${error}`);
  });
  const batches = [];
  for (const count of [1, 16, 64, 512]) {
    const features = new Float32Array(count * model.manifest.inputSize);
    for (let i = 0; i < count; i++)
      features.set(fixture.inputs[0], i * model.manifest.inputSize);
    model.predictBatch(features, count);
    const times = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      model.predictBatch(features, count);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    batches.push({ batchSize: count, medianMs: times[2], maxMs: times[4] });
  }
  console.log(
    JSON.stringify(
      { modelId: model.manifest.modelId, maxAbsoluteError, batches },
      null,
      2,
    ),
  );
} finally {
  await rt.close();
}
