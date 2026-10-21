import { request } from "node:http";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GameRepository } from "./repository";
import { gameApi } from "./api";
import { passPlan } from "../bot/simulation";
let repo: GameRepository, server: Server, base: string;
const id = "king-00000000-0000-0000-0000-000000000123";
const config = {
  mode: "standard",
  seed: "private-api-setup",
  players: [
    { id: "A", controller: "human" },
    { id: "B", controller: "human" },
  ],
};
beforeEach(async () => {
  repo = new GameRepository(":memory:");
  const handler = gameApi(repo);
  server = createServer((req, res) => {
    void handler(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((done, reject) =>
    server.close((e) => (e ? reject(e) : done())),
  );
  repo.close();
});
async function post(path: string, data: unknown) {
  return fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}
describe("same-origin SQLite capture API", () => {
  it("captures idempotent commands and serves only public observations", async () => {
    expect((await post("/api/games", { id, config })).status).toBe(200);
    const state = repo.session(id).state;
    const command = {
      requestId: "turn-1",
      baseEventSequence: 0,
      plan: passPlan(state),
    };
    expect((await post(`/api/games/${id}/commands`, command)).status).toBe(200);
    expect((await post(`/api/games/${id}/commands`, command)).status).toBe(200);
    expect(repo.all("SELECT * FROM turns")).toHaveLength(1);
    const response = await fetch(`${base}/api/games/${id}`),
      json = await response.json();
    expect(json.observation.own).toBeNull();
    expect(json.observation.seed).toBeNull();
    expect(JSON.stringify(json)).not.toContain(config.seed);
    expect(JSON.stringify(json)).not.toContain("rngState");
  });
  it("preserves UTF-8 player names split across transport chunks", async () => {
    const greek = {
      ...config,
      players: [
        { id: "Αλέξης", controller: "human" },
        { id: "Βάσω", controller: "human" },
      ],
    };
    const bytes = Buffer.from(JSON.stringify({ id, config: greek }));
    const split = bytes.indexOf(Buffer.from("Α")) + 1;
    const status = await new Promise<number>((done, reject) => {
      const req = request(
        base + "/api/games",
        { method: "POST", headers: { "Content-Type": "application/json" } },
        (res) => {
          res.resume();
          res.on("end", () => done(res.statusCode!));
        },
      );
      req.on("error", reject);
      req.write(bytes.subarray(0, split));
      setImmediate(() => req.end(bytes.subarray(split)));
    });
    expect(status).toBe(200);
    expect(repo.session(id).state.playerOrder).toEqual(["Αλέξης", "Βάσω"]);
  });
  it("rejects cross-origin writes and invalid commands without leaking internals", async () => {
    const cross = await fetch(`${base}/api/games`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://other.invalid",
      },
      body: JSON.stringify({ id, config }),
    });
    expect(cross.status).toBe(403);
    expect(repo.all("SELECT * FROM games")).toHaveLength(0);
    await post("/api/games", { id, config });
    const failed = await post(`/api/games/${id}/commands`, {
      requestId: "bad",
      baseEventSequence: 0,
      plan: { kind: "card" },
    });
    expect(failed.status).toBe(409);
    expect(JSON.stringify(await failed.json())).not.toContain(config.seed);
    expect(repo.all("SELECT * FROM turns")).toHaveLength(0);
  });
});
