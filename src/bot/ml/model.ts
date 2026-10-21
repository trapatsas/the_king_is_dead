import { FEATURE_COUNT, FEATURE_VERSION } from "./features";

export interface ModelManifest {
  readonly formatVersion: 1;
  readonly modelId: string;
  readonly featureVersion: string;
  readonly inputSize: number;
  readonly supportedSeats: readonly number[];
  readonly weightsFile: string;
  readonly weightsSha256: string;
  readonly layers: readonly {
    readonly input: number;
    readonly output: number;
    readonly activation: "relu" | "linear";
  }[];
  readonly learnedWeight: number;
  readonly training: Readonly<Record<string, unknown>>;
}
export interface ValueModel {
  readonly manifest: ModelManifest;
  predictBatch(features: Float32Array, batchSize: number): Float32Array;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(hash)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}

/** Artifacts are data, not executable graphs. Only this bounded MLP is accepted. */
export async function createValueModel(
  input: unknown,
  binary: Uint8Array,
): Promise<ValueModel> {
  if (!input || typeof input !== "object")
    throw new Error("Invalid ML manifest");
  const m = input as ModelManifest;
  if (
    m.formatVersion !== 1 ||
    m.featureVersion !== FEATURE_VERSION ||
    m.inputSize !== FEATURE_COUNT ||
    typeof m.modelId !== "string" ||
    !/^[a-zA-Z0-9_.-]{1,100}$/.test(m.modelId) ||
    typeof m.weightsFile !== "string" ||
    !/^[a-zA-Z0-9_.-]+\.bin$/.test(m.weightsFile) ||
    !/^[a-f0-9]{64}$/.test(m.weightsSha256) ||
    !Array.isArray(m.supportedSeats) ||
    !m.supportedSeats.length ||
    m.supportedSeats.some((n) => n !== 2 && n !== 3) ||
    !Number.isFinite(m.learnedWeight) ||
    m.learnedWeight < 0 ||
    m.learnedWeight > 1 ||
    !Array.isArray(m.layers) ||
    m.layers.length < 1 ||
    m.layers.length > 8
  )
    throw new Error("Unsupported ML manifest");
  let width = FEATURE_COUNT,
    size = 0;
  for (const [index, layer] of m.layers.entries()) {
    if (
      !layer ||
      layer.input !== width ||
      !Number.isInteger(layer.output) ||
      layer.output < 1 ||
      layer.output > 512 ||
      layer.activation !== (index === m.layers.length - 1 ? "linear" : "relu")
    )
      throw new Error("Invalid ML layer layout");
    size += layer.input * layer.output + layer.output;
    width = layer.output;
  }
  if (
    width !== 3 ||
    size > 2_000_000 ||
    binary.byteLength !== size * 4 ||
    (await sha256(binary)) !== m.weightsSha256
  )
    throw new Error("ML weights failed integrity validation");
  const data = new Float32Array(size);
  const view = new DataView(
    binary.buffer,
    binary.byteOffset,
    binary.byteLength,
  );
  for (let i = 0; i < size; i++) {
    const value = view.getFloat32(i * 4, true);
    if (!Number.isFinite(value)) throw new Error("Nonfinite ML weight");
    data[i] = value;
  }
  // Detach all caller-owned objects/buffers so identity and weights cannot drift.
  const manifest = structuredClone(m);
  for (const layer of manifest.layers) Object.freeze(layer);
  Object.freeze(manifest.layers);
  Object.freeze(manifest.supportedSeats);
  Object.freeze(manifest);
  return {
    manifest,
    predictBatch(features, batchSize) {
      if (
        !Number.isInteger(batchSize) ||
        batchSize < 1 ||
        batchSize > 512 ||
        features.length !== batchSize * FEATURE_COUNT ||
        features.some((v) => !Number.isFinite(v))
      )
        throw new Error("Invalid ML batch");
      let current = features;
      let offset = 0;
      for (const layer of manifest.layers) {
        const next = new Float32Array(batchSize * layer.output);
        const bias = offset + layer.input * layer.output;
        for (let batch = 0; batch < batchSize; batch++) {
          for (let out = 0; out < layer.output; out++) {
            let sum = data[bias + out]!;
            for (let k = 0; k < layer.input; k++)
              sum +=
                current[batch * layer.input + k]! *
                data[offset + out * layer.input + k]!;
            next[batch * layer.output + out] =
              layer.activation === "relu" ? Math.max(0, sum) : sum;
          }
        }
        if (next.some((v) => !Number.isFinite(v)))
          throw new Error("Nonfinite ML prediction");
        offset = bias + layer.output;
        current = next;
      }
      return current;
    },
  };
}

export function maskedValues(
  logits: ArrayLike<number>,
  count: number,
): number[] {
  if ((count !== 2 && count !== 3) || logits.length !== 3)
    throw new Error("Invalid utility layout");
  const max = Math.max(...Array.from(logits).slice(0, count));
  const scores = [0, 1, 2].map((i) =>
    i < count ? Math.exp(logits[i]! - max) : 0,
  );
  const sum = scores.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sum) || sum <= 0)
    throw new Error("Invalid model utility");
  return scores.map((v) => v / sum);
}

export async function fetchValueModel(
  manifestUrl: string,
): Promise<ValueModel> {
  const url = new URL(manifestUrl, globalThis.location?.href);
  const response = await fetch(url);
  if (!response.ok) throw new Error("ML model could not be loaded");
  const raw: unknown = await response.json();
  const file = (raw as ModelManifest)?.weightsFile;
  if (typeof file !== "string" || !/^[a-zA-Z0-9_.-]+\.bin$/.test(file))
    throw new Error("Invalid model asset");
  const weights = await fetch(new URL(file, url));
  if (!weights.ok) throw new Error("ML weights could not be loaded");
  return createValueModel(raw, new Uint8Array(await weights.arrayBuffer()));
}
