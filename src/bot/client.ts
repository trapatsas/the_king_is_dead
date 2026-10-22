import type { SearchRequest, SearchResult } from "./search";
import type { WorkerReply, WorkerRequest } from "./worker";
import { ML_MANIFEST_URL } from "./ml/deployment";

/** One operation per Worker. Loading has its own timeout; warm search preserves
 * the original watchdog, cancellation and stale-reply protections. */
export class BotClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private cancel: (() => void) | null = null;
  private readyModel: string | null = null;
  constructor(
    private readonly createWorker = () =>
      new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
  ) {}

  async prepare(signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw new Error("Bot request cancelled");
    if (this.readyModel) return this.readyModel;
    const reply = await this.exchange(
      { prepare: { manifestUrl: ML_MANIFEST_URL } },
      signal,
      15000,
    );
    if (!("ready" in reply)) throw new Error("Unexpected preparation reply");
    this.readyModel = reply.ready.modelId;
    return this.readyModel;
  }
  async search(
    search: SearchRequest,
    signal: AbortSignal,
  ): Promise<SearchResult> {
    const reply = await this.exchange({ search }, signal, 2500);
    if (!("result" in reply)) throw new Error("Unexpected search reply");
    return reply.result;
  }
  private exchange(
    payload: { search: SearchRequest } | { prepare: { manifestUrl: string } },
    signal: AbortSignal,
    timeout: number,
  ): Promise<WorkerReply> {
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
        this.readyModel = null;
        reject(new Error(message));
      };
      const abort = () => fail("Bot request cancelled");
      const timer = setTimeout(
        () => fail("The bot took too long. Try again."),
        timeout,
      );
      this.cancel = abort;
      signal.addEventListener("abort", abort, { once: true });
      worker.onerror = () => fail("The bot worker stopped. Try again.");
      worker.onmessageerror = () =>
        fail("The bot reply could not be read. Try again.");
      worker.onmessage = (event: MessageEvent<WorkerReply>) => {
        const reply = event.data;
        if (settled || !reply || reply.id !== id) return;
        if ("error" in reply) {
          fail(reply.error);
          return;
        }
        cleanup();
        resolve(reply);
      };
      const request: WorkerRequest = { id, ...payload };
      try {
        worker.postMessage(request);
      } catch {
        fail("The bot request could not be sent. Try again.");
      }
    });
  }
  dispose() {
    this.cancel?.();
    this.worker?.terminate();
    this.worker = null;
    this.readyModel = null;
  }
}
