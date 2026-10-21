// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageClient } from "./storageClient";
import { createGame } from "../game/setup";
import { commitPlan } from "./session";
import { passPlan } from "../bot/simulation";
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
beforeEach(() => localStorage.clear());
describe("durable SQLite delivery outbox", () => {
  it("sends setup then typed accepted turns once, including passes", async () => {
    const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue({ ok: true } as Response),
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
      .mockResolvedValue({ ok: true } as Response);
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
        .mockResolvedValue({ ok: true } as Response),
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
      .mockResolvedValue({ ok: true } as Response);
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
