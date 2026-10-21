import { createServer } from "vite";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";

export function argumentsOf(items) {
  const args = {};
  for (const item of items) {
    const match = /^--([A-Za-z][A-Za-z0-9]*)=(.+)$/.exec(item);
    if (!match || args[match[1]] !== undefined)
      throw new Error(`Expected unique --name=value option: ${item}`);
    args[match[1]] = match[2];
  }
  return args;
}
export function integer(value, fallback, min = 1, max = 100000) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max)
    throw new Error("Invalid integer option");
  return number;
}
export async function runtime() {
  const server = await createServer({
    root: resolve(import.meta.dirname, "../.."),
    configFile: false,
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  });
  const modules = {};
  for (const [name, path] of Object.entries({
    repository: "server/repository",
    setup: "game/setup",
    turns: "app/session",
    observation: "game/visibility",
    memory: "app/botObservation",
    simulation: "bot/simulation",
    search: "bot/search",
    patient: "bot/patient",
    informed: "bot/informed",
    ml: "bot/ml/mlBot",
    model: "bot/ml/model",
    features: "bot/ml/features",
  }))
    modules[name] = await server.ssrLoadModule(`/src/${path}.ts`);
  return { ...modules, close: () => server.close() };
}
export async function loadModel(path, modelModule) {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  if (
    typeof manifest.weightsFile !== "string" ||
    !/^[a-zA-Z0-9_.-]+\.bin$/.test(manifest.weightsFile)
  )
    throw new Error("Invalid weights file");
  const binary = await readFile(resolve(dirname(path), manifest.weightsFile));
  return modelModule.createValueModel(manifest, binary);
}
