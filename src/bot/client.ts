import type { SearchRequest, SearchResult } from "./search";
import type { WorkerReply, WorkerRequest } from "./worker";

/** One live request per game. Cancellation/watchdog terminate busy JS instead
 * of queuing an abort message the worker could only read after search ends.
 */
export class BotClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private cancel: (() => void) | null = null;
  constructor(
    private readonly createWorker = () =>
      new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
  ) {}
  search(search: SearchRequest, signal: AbortSignal): Promise<SearchResult> {
    this.cancel?.();
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error("Bot request cancelled"));
        return;
      }
      const worker = (this.worker ??= this.createWorker());
      const id = ++this.sequence;
      let settled = false;
      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        this.cancel = null;
      };
      const fail = (message: string) => {
        if (settled) return;
        cleanup();
        worker.terminate();
        this.worker = null;
        reject(new Error(message));
      };
      const abort = () => fail("Bot request cancelled");
      const timer = setTimeout(
        () => fail("The bot took too long. Try again."),
        2500,
      );
      this.cancel = abort;
      signal.addEventListener("abort", abort, { once: true });
      worker.onerror = () => fail("The bot worker stopped. Try again.");
      worker.onmessageerror = () =>
        fail("The bot reply could not be read. Try again.");
      worker.onmessage = (event: MessageEvent<WorkerReply>) => {
        const reply = event.data;
        if (settled || !reply || reply.id !== id) return;
        cleanup();
        if ("result" in reply) resolve(reply.result);
        else reject(new Error(reply.error));
      };
      const request: WorkerRequest = { id, search };
      try {
        worker.postMessage(request);
      } catch {
        fail("The bot request could not be sent. Try again.");
      }
    });
  }
  dispose(): void {
    this.cancel?.();
    this.worker?.terminate();
    this.worker = null;
  }
}
