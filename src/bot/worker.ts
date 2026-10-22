import { InformedBot } from "./informed";
import { PatientBot } from "./patient";
import { StandardBot } from "./search";
import type { SearchRequest, SearchResult } from "./search";
import type { MlBot } from "./ml/mlBot";

export type WorkerRequest =
  | { readonly id: number; readonly search: SearchRequest }
  | { readonly id: number; readonly prepare: { readonly manifestUrl: string } };
export type WorkerReply =
  | { readonly id: number; readonly result: SearchResult }
  | { readonly id: number; readonly ready: { readonly modelId: string } }
  | { readonly id: number; readonly error: string };
const reference = new StandardBot();
const patient = new PatientBot();
const informed = new InformedBot();
let ml: MlBot | null = null;
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  let reply: WorkerReply;
  try {
    if ("prepare" in request) {
      const url = new URL(request.prepare.manifestUrl, self.location.href);
      if (url.origin !== self.location.origin)
        throw new Error("Model must be same-origin");
      const [{ fetchValueModel }, { MlBot }] = await Promise.all([
        import("./ml/model"),
        import("./ml/mlBot"),
      ]);
      ml = new MlBot(await fetchValueModel(url.href));
      reply = { id: request.id, ready: { modelId: ml.modelId } };
    } else {
      const search = request.search;
      const seat = search.observation.players.find(
        (p) => p.id === search.observation.viewer,
      );
      const bot =
        seat?.botStrategy === "ml"
          ? ml
          : seat?.botStrategy === "informed"
            ? informed
            : seat?.botStrategy === "patient"
              ? patient
              : reference;
      if (!bot) throw new Error("ML model has not been prepared");
      reply = { id: request.id, result: bot.search(search) };
    }
  } catch {
    reply = {
      id: request.id,
      error: "The bot could not complete this turn. Try again.",
    };
  }
  self.postMessage(reply);
};
