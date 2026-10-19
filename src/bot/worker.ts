import { PatientBot } from "./patient";
import { StandardBot } from "./search";
import type { SearchRequest, SearchResult } from "./search";

export interface WorkerRequest {
  readonly id: number;
  readonly search: SearchRequest;
}
export type WorkerReply =
  | { readonly id: number; readonly result: SearchResult }
  | { readonly id: number; readonly error: string };
const reference = new StandardBot();
const patient = new PatientBot();
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, search } = event.data;
  let reply: WorkerReply;
  try {
    const seat = search.observation.players.find(
      (player) => player.id === search.observation.viewer,
    );
    const bot = seat?.botStrategy === "patient" ? patient : reference;
    reply = { id, result: bot.search(search) };
  } catch {
    reply = { id, error: "The bot could not complete this turn. Try again." };
  }
  self.postMessage(reply);
};
