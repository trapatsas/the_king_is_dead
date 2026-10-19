import { StandardBot } from "./search";
import type { SearchRequest, SearchResult } from "./search";

export interface WorkerRequest {
  readonly id: number;
  readonly search: SearchRequest;
}
export type WorkerReply =
  | { readonly id: number; readonly result: SearchResult }
  | { readonly id: number; readonly error: string };
const bot = new StandardBot();
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, search } = event.data;
  let reply: WorkerReply;
  try {
    reply = { id, result: bot.search(search) };
  } catch {
    reply = { id, error: "The bot could not complete this turn. Try again." };
  }
  self.postMessage(reply);
};
