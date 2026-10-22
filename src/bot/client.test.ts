import { afterEach, describe, expect, it, vi } from "vitest";
import { BotClient } from "./client";
import { getObservation } from "../game/visibility";
import { setupSession } from "../test/turnFixtures";
import { witnessedCards } from "../app/botObservation";
import { passPlan } from "./simulation";
import type { WorkerReply, WorkerRequest } from "./worker";

class FakeWorker {
  onmessage: ((event: { data: WorkerReply }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn<(request: WorkerRequest) => void>();
  terminate = vi.fn();
}
const session = setupSession(2);
const request = {
  observation: getObservation(session.state, session.state.activePlayerId),
  memory: witnessedCards(session),
  budget: { iterations: 1, seed: 1 },
};
const result = {
  plan: passPlan(session.state),
  stats: {
    iterations: 1,
    elapsedMs: 1,
    nodes: 1,
    maxDepth: 3,
    horizon: 5,
    horizonVisits: 0,
    terminalVisits: 0,
    rootChoices: 1,
    reusedVisits: 0,
  },
  explanation: "pass",
};
afterEach(() => vi.useRealTimers());
describe("worker lifecycle", () => {
  it("prepares ML separately from the search watchdog and reuses the ready model", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker(),
      client = new BotClient(() => worker as unknown as Worker);
    const signal = new AbortController().signal;
    const preparing = client.prepare(signal);
    expect(worker.postMessage.mock.calls[0]![0]).toEqual({
      id: 1,
      prepare: { manifestUrl: "/models/linear-v2/manifest.json" },
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.onmessage?.({ data: { id: 1, ready: { modelId: "test-model" } } });
    expect(await preparing).toBe("test-model");
    expect(await client.prepare(signal)).toBe("test-model");
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    client.dispose();
  });
  it("sends only redacted input, ignores stale replies, and keeps a completed worker for tree reuse", async () => {
    const worker = new FakeWorker(),
      factory = vi.fn(() => worker as unknown as Worker),
      client = new BotClient(factory);
    const abort = new AbortController();
    const promise = client.search(request, abort.signal);
    expect(worker.postMessage.mock.calls[0]![0]).toEqual({
      id: 1,
      search: request,
    });
    worker.onmessage?.({ data: { id: 0, result } });
    expect(worker.onmessage).not.toBeNull();
    worker.onmessage?.({ data: { id: 1, result } });
    expect(await promise).toEqual(result);
    abort.abort();
    expect(worker.terminate).not.toHaveBeenCalled();
    const again = client.search(request, new AbortController().signal);
    worker.onmessage?.({ data: { id: 2, result } });
    await again;
    expect(factory).toHaveBeenCalledTimes(1);
    client.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("terminates cancelled work and recreates the worker on retry", async () => {
    const first = new FakeWorker(),
      second = new FakeWorker();
    const factory = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const client = new BotClient(factory),
      abort = new AbortController();
    const promise = client.search(request, abort.signal);
    const lateReply = first.onmessage;
    abort.abort();
    await expect(promise).rejects.toThrow(/cancelled/);
    expect(first.terminate).toHaveBeenCalledOnce();
    const retry = client.search(request, new AbortController().signal);
    // A queued old message cannot settle the new request.
    lateReply?.({ data: { id: 1, result } });
    second.onmessage?.({ data: { id: 2, result } });
    expect(await retry).toEqual(result);
    client.dispose();
  });
  it("has an independent watchdog even when worker JS never responds", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker(),
      client = new BotClient(() => worker as unknown as Worker);
    const promise = client.search(request, new AbortController().signal);
    const rejected = expect(promise).rejects.toThrow(/too long/);
    await vi.advanceTimersByTimeAsync(2500);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    client.dispose();
  });
  it("fails cleanly when workers cannot be constructed", async () => {
    const client = new BotClient(() => {
      throw new Error("Unavailable");
    });
    await expect(
      client.search(request, new AbortController().signal),
    ).rejects.toThrow(/Unavailable/);
    client.dispose();
  });
});
