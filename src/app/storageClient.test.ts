// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageClient } from "./storageClient";
import { createGame } from "../game/setup";
import { commitPlan } from "./session";
import { passPlan } from "../bot/simulation";
import { rememberBotTelemetry } from "./botTelemetry";
import { copyChoice } from "../game/plans";
import type { GameSession } from "../game/events";
const id = "king-00000000-0000-0000-0000-000000000011";
const initial = () =>
  createGame({
    mode: "standard",
    seed: "capture-human",
    players: [
      { id: "Human", controller: "human" },
      { id: "Bot", controller: "algorithmic", botStrategy: "patient" },
    ],
  });
function acknowledgement(eventSequence = 999) {
  return new Response(JSON.stringify({ eventSequence }), {
    headers: { "Content-Type": "application/json" },
  });
}
beforeEach(() => localStorage.clear());
describe("durable SQLite delivery outbox", () => {
  it("recaptures reloaded history without replacing queued bot telemetry", async () => {
    let s: GameSession = initial();
    if (s.state.players[s.state.activePlayerId]!.controller === "human")
      s = commitPlan(s, passPlan(s.state));
    const plan = passPlan(s.state),
      accepted = commitPlan(s, plan);
    const telemetry = {
      runtime: "original-worker",
      budget: { iterations: 8, seed: 12 },
      result: {
        plan,
        explanation: "original decision",
        stats: {
          iterations: 8,
          elapsedMs: 42,
          nodes: 8,
          maxDepth: 5,
          horizon: 5,
          horizonVisits: 8,
          terminalVisits: 0,
          rootChoices: 2,
          reusedVisits: 0,
        },
      },
    };
    rememberBotTelemetry(accepted, telemetry);
    const offline = vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error("offline")),
      oldStatus = vi.fn();
    new StorageClient(oldStatus, offline, localStorage).capture(id, accepted);
    await vi.waitFor(() => expect(oldStatus).toHaveBeenLastCalledWith("error"));
    const request = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => acknowledgement()),
      status = vi.fn();
    new StorageClient(status, request, localStorage).capture(
      id,
      copyChoice(accepted),
    );
    await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith("saved"));
    expect(request).toHaveBeenCalledTimes(accepted.state.turnSequence + 1);
    const bodies = request.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)),
    );
    expect(bodies.at(-1).decision).toEqual(telemetry);
    expect(localStorage.length).toBe(0);
  });
  it("preserves unacknowledged HTML responses and saves after the API returns", async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response("<!doctype html><html>App</html>", {
          headers: { "Content-Type": "text/html" },
        }),
    );
    const status = vi.fn(),
      client = new StorageClient(status, request, localStorage);
    client.capture(id, initial());
    await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith("error"));
    expect(
      localStorage.getItem(`king:sqlite-outbox:v1:${id}:setup`),
    ).not.toBeNull();
    request.mockImplementation(async () => acknowledgement());
    await client.flush();
    expect(status).toHaveBeenLastCalledWith("saved");
    expect(localStorage.length).toBe(0);
  });
  it("requires an event cursor acknowledging the accepted command", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => acknowledgement(0));
    const status = vi.fn(),
      client = new StorageClient(status, request, localStorage),
      s = initial();
    client.capture(id, commitPlan(s, passPlan(s.state)));
    await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith("error"));
    expect(
      localStorage.getItem(`king:sqlite-outbox:v1:${id}:setup`),
    ).toBeNull();
    expect(
      localStorage.getItem(`king:sqlite-outbox:v1:${id}:turn-1`),
    ).not.toBeNull();
    request.mockImplementation(async () => acknowledgement(1));
    await client.flush();
    expect(status).toHaveBeenLastCalledWith("saved");
    expect(localStorage.length).toBe(0);
  });
  it("saves a new game past an older rejected command without reordering or deleting old moves", async () => {
    const offline = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("offline"));
    const firstStatus = vi.fn(),
      old = new StorageClient(firstStatus, offline, localStorage),
      s = initial();
    const next = commitPlan(s, passPlan(s.state));
    old.capture(id, commitPlan(next, passPlan(next.state)));
    await vi.waitFor(() =>
      expect(firstStatus).toHaveBeenLastCalledWith("error"),
    );
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).includes(`/${id}/commands`)
          ? new Response("{}", { status: 409 })
          : acknowledgement(),
      );
    const status = vi.fn(),
      reloaded = new StorageClient(status, request, localStorage);
    const other = "king-00000000-0000-0000-0000-000000000012";
    reloaded.capture(other, next);
    await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith("error"));
    expect(
      request.mock.calls.filter(([url]) =>
        String(url).includes(`/${id}/commands`),
      ),
    ).toHaveLength(1);
    expect(
      request.mock.calls.some(
        ([url]) => url === `/api/games/${other}/commands`,
      ),
    ).toBe(true);
    expect(localStorage.length).toBe(2);
    expect(
      localStorage.getItem(`king:sqlite-outbox:v1:${id}:turn-1`),
    ).not.toBeNull();
    expect(
      localStorage.getItem(`king:sqlite-outbox:v1:${id}:turn-2`),
    ).not.toBeNull();
    request.mockImplementation(async () => acknowledgement());
    await reloaded.flush();
    expect(status).toHaveBeenLastCalledWith("saved");
    expect(localStorage.length).toBe(0);
  });
  it("times out a stalled request and permits a later retry", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn<typeof fetch>().mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new Error("timeout")),
              { once: true },
            );
          }),
      );
      const status = vi.fn(),
        client = new StorageClient(status, request, localStorage);
      client.capture(id, initial());
      await vi.advanceTimersByTimeAsync(10000);
      expect(status).toHaveBeenLastCalledWith("error");
      expect(localStorage.length).toBe(1);
      request.mockImplementation(async () => acknowledgement());
      await client.flush();
      expect(status).toHaveBeenLastCalledWith("saved");
    } finally {
      vi.useRealTimers();
    }
  });
  it("sends setup then typed accepted turns once, including passes", async () => {
    const request = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => acknowledgement()),
      status = vi.fn();
    const client = new StorageClient(status, request, localStorage);
    const s = initial();
    client.capture(id, s);
    const next = commitPlan(s, passPlan(s.state));
    client.capture(id, next);
    client.capture(id, next);
    await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith("saved"));
    expect(request).toHaveBeenCalledTimes(2);
    const body = JSON.parse(String(request.mock.calls[1]![1]?.body));
    expect(body.plan).toEqual(passPlan(s.state));
    expect(body.baseEventSequence).toBe(0);
    expect(body.requestId).toBe("turn-1");
    expect(localStorage.length).toBe(0);
  });
  it("keeps failed saves across reload and retries exact envelopes in order", async () => {
    const failed = vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error("offline")),
      status = vi.fn();
    const first = new StorageClient(status, failed, localStorage),
      s = initial();
    first.capture(id, commitPlan(s, passPlan(s.state)));
    await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith("error"));
    expect(localStorage.length).toBe(2);
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => acknowledgement());
    const retry = new StorageClient(status, request, localStorage);
    await retry.flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenLastCalledWith("saved");
    expect(
      JSON.parse(String(request.mock.calls[0]![1]?.body)).config.seed,
    ).toBe("capture-human");
  });
  it("still saves to SQLite when browser storage is full", async () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
      key: () => null,
      clear: () => {},
      length: 0,
    } as Storage;
    const request = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => acknowledgement()),
      status = vi.fn();
    const client = new StorageClient(status, request, full);
    client.capture(id, initial());
    await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith("saved"));
    expect(request).toHaveBeenCalledOnce();
  });
  it("preserves a conflicting pending setup instead of sending a fork", async () => {
    const offline = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("offline"));
    const first = new StorageClient(vi.fn(), offline, localStorage);
    first.capture(id, initial());
    await vi.waitFor(() => expect(offline).toHaveBeenCalledOnce());
    const saved = localStorage.getItem(`king:sqlite-outbox:v1:${id}:setup`);
    const request = vi.fn<typeof fetch>();
    const second = new StorageClient(vi.fn(), request, localStorage);
    const alternate = createGame({
      mode: "standard",
      seed: "other",
      players: [
        { id: "A", controller: "human" },
        { id: "B", controller: "human" },
      ],
    });
    second.capture(id, alternate);
    await second.flush();
    expect(request).not.toHaveBeenCalled();
    expect(localStorage.getItem(`king:sqlite-outbox:v1:${id}:setup`)).toBe(
      saved,
    );
  });
  it("does not overwrite another tab's pending games", async () => {
    const fail = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    const a = new StorageClient(vi.fn(), fail, localStorage),
      b = new StorageClient(vi.fn(), fail, localStorage);
    a.capture(id, initial());
    const other = "king-00000000-0000-0000-0000-000000000012";
    b.capture(other, initial());
    await vi.waitFor(() => expect(fail).toHaveBeenCalledTimes(2));
    expect(localStorage.length).toBe(2);
    const success = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => acknowledgement());
    await new StorageClient(vi.fn(), success, localStorage).flush();
    expect(success).toHaveBeenCalledTimes(2);
    expect(localStorage.length).toBe(0);
  });
  it("does not erase a malformed outbox or send its contents", async () => {
    localStorage.setItem("king:sqlite-outbox:v1", '{"bad":true}');
    const request = vi.fn<typeof fetch>(),
      status = vi.fn();
    const client = new StorageClient(status, request, localStorage);
    client.capture(id, initial());
    await client.flush();
    expect(request).not.toHaveBeenCalled();
    expect(status).toHaveBeenLastCalledWith("error");
    expect(localStorage.getItem("king:sqlite-outbox:v1")).toBe('{"bad":true}');
  });
});
