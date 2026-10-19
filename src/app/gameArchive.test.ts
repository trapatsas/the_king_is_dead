// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { setupSession, pass } from "../test/turnFixtures";
import { play } from "../test/standardFixtures";
import {
  ARCHIVE_PREFIX,
  archiveSnapshot,
  newGameId,
  readArchives,
  saveArchive,
  serializeArchive,
} from "./gameArchive";

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
const createdAt = "2026-10-19T10:00:00.000Z";
describe("public game archive", () => {
  it("exports only the public schema, retaining game identity and witnessed moves", () => {
    const session = play(
      setupSession(3, "standard", "private-export-seed"),
      "assemble",
    );
    const snapshot = archiveSnapshot(newGameId(), createdAt, session);
    const withExtraFields = {
      ...snapshot,
      privateState: session.state,
      entries: snapshot.entries.map((entry) => ({
        ...entry,
        privateState: session.state,
      })),
    };
    const exported = serializeArchive(withExtraFields);
    expect(JSON.parse(exported)).toEqual(snapshot);
    expect(exported).toContain("played Assemble");
    expect(exported).not.toContain("private-export-seed");
    for (const field of [
      "privateState",
      "rngState",
      "undealtCunningCards",
      '"hand"',
    ])
      expect(exported).not.toContain(field);
  });
  it("keeps unique games with the same seed separate and replaces only their own log", () => {
    const session = setupSession(),
      first = newGameId(),
      second = newGameId();
    expect(first).not.toBe(second);
    expect(saveArchive(archiveSnapshot(first, createdAt, session))).toBe(true);
    expect(saveArchive(archiveSnapshot(second, createdAt, session))).toBe(true);
    expect(saveArchive(archiveSnapshot(first, createdAt, pass(session)))).toBe(
      true,
    );
    const games = readArchives().games;
    expect(games).toHaveLength(2);
    expect(games.find((g) => g.id === first)?.turns).toBe(1);
    expect(games.find((g) => g.id === second)?.turns).toBe(0);
    expect(
      games.find((g) => g.id === first)?.entries.at(-1)?.heading,
    ).toContain("passed");
  });
  it("generates UUIDs on local HTTP origins without randomUUID", () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal("crypto", { getRandomValues });
    const first = newGameId(),
      second = newGameId();
    expect(first).toMatch(
      /^king-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
    expect(first).not.toBe(second);
  });
  it("handles a blocked browser storage accessor", () => {
    const snapshot = archiveSnapshot(newGameId(), createdAt, setupSession());
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(saveArchive(snapshot)).toBe(false);
    expect(readArchives()).toMatchObject({ games: [], unavailable: true });
  });
  it("persists setup, accepted moves and final scoring without setup hands or live seed", () => {
    let session = play(setupSession(2), "assemble");
    const id = newGameId();
    expect(saveArchive(archiveSnapshot(id, createdAt, session))).toBe(true);
    const live = localStorage.getItem(ARCHIVE_PREFIX + id)!;
    expect(live).toContain("played Assemble");
    expect(live).not.toContain(session.state.initialSeed);
    for (const secret of [
      "initialRngState",
      "rngState",
      "undealtCunningCards",
      '"hand"',
      '"discards"',
    ])
      expect(live).not.toContain(secret);
    while (session.state.phase === "turn") session = pass(session);
    saveArchive(archiveSnapshot(id, createdAt, session));
    const game = readArchives().games[0]!;
    expect(game.status).toBe("finished");
    expect(game.entries[0]!.details.join(" ")).toContain(
      session.state.initialSeed,
    );
    expect(game.entries.at(-1)?.label).toBe("Final result");
  });
  it("never archives hidden Advanced cards or seed in an unfinished game", () => {
    const session = setupSession(3, "advanced", "archive-private");
    const snapshot = archiveSnapshot(newGameId(), createdAt, session),
      text = JSON.stringify(snapshot);
    expect(text).not.toContain("archive-private");
    for (const card of [
      ...Object.values(session.state.players).flatMap((p) => p.hand),
      ...session.state.undealtCunningCards,
    ])
      expect(text).not.toContain(card.id);
    expect(snapshot.entries[0]?.followers?.rows.length).toBeGreaterThan(8);
  });
  it("isolates corrupt or incompatible records without deleting other games", () => {
    const snapshot = archiveSnapshot(newGameId(), createdAt, setupSession());
    saveArchive(snapshot);
    localStorage.setItem(ARCHIVE_PREFIX + newGameId(), "{broken");
    const corruptId = newGameId();
    localStorage.setItem(
      ARCHIVE_PREFIX + corruptId,
      JSON.stringify({
        ...snapshot,
        id: corruptId,
        entries: [
          {
            sequence: 0,
            heading: "bad",
            label: "bad",
            details: [],
            followers: {
              caption: "bad",
              rows: [{ label: "bad", counts: null }],
            },
          },
        ],
      }),
    );
    const wrongVersion = newGameId();
    localStorage.setItem(
      ARCHIVE_PREFIX + wrongVersion,
      JSON.stringify({ ...snapshot, id: wrongVersion, version: 2 }),
    );
    const result = readArchives();
    expect(result.games).toHaveLength(1);
    expect(result.invalid).toBe(3);
    expect(localStorage.length).toBe(4);
  });
  it("reports storage failures while preserving an earlier saved log", () => {
    const snapshot = archiveSnapshot(newGameId(), createdAt, setupSession());
    saveArchive(snapshot);
    const original = localStorage.getItem(ARCHIVE_PREFIX + snapshot.id);
    const blocked = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });
    expect(saveArchive({ ...snapshot, turns: 1 })).toBe(false);
    expect(localStorage.getItem(ARCHIVE_PREFIX + snapshot.id)).toBe(original);
    blocked.mockRestore();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readArchives().invalid).toBe(1);
  });
});
