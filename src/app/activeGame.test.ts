// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupSession, pass } from "../test/turnFixtures";
import { play } from "../test/standardFixtures";
import { newGameId } from "./gameArchive";
import {
  ACTIVE_GAME_KEY,
  clearActiveGame,
  loadActiveGame,
  parseSavedGame,
  saveActiveGame,
  saveGamePosition,
  loadGamePosition,
  SAVED_GAME_PREFIX,
} from "./activeGame";

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});
function saved() {
  return {
    version: 1 as const,
    id: newGameId(),
    createdAt: new Date().toISOString(),
    session: pass(play(setupSession(3), "assemble"), 2),
  };
}
describe("active game recovery", () => {
  it("restores the exact committed history, state, identity and clocks", () => {
    const game = saved();
    expect(saveActiveGame(game)).toBe(true);
    expect(loadActiveGame()).toEqual({ game, error: false });
    expect(clearActiveGame()).toBe(true);
    expect(loadActiveGame()).toEqual({ game: null, error: false });
  });
  it("rejects tampered checkpoints, altered histories and public log exports", () => {
    const game = saved();
    const tampered = {
      ...game,
      session: {
        ...game.session,
        state: { ...game.session.state, consecutivePasses: 0 },
      },
    };
    expect(() => parseSavedGame(JSON.stringify(tampered))).toThrow(/mismatch/);
    const truncated = {
      ...game,
      session: { ...game.session, events: game.session.events.slice(0, -1) },
    };
    expect(() => parseSavedGame(JSON.stringify(truncated))).toThrow(/mismatch/);
    expect(() =>
      parseSavedGame(JSON.stringify({ version: 1, id: game.id, entries: [] })),
    ).toThrow();
  });
  it("reports corrupt or unavailable storage without crashing the app", () => {
    sessionStorage.setItem(ACTIVE_GAME_KEY, "{broken");
    expect(loadActiveGame()).toEqual({ game: null, error: true });
    const unavailable = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("Quota exceeded");
      });
    expect(saveActiveGame(saved())).toBe(false);
    unavailable.mockRestore();
  });
  it("keeps each position after leaving, and rejects stale or divergent writes", () => {
    const game = saved();
    expect(saveActiveGame(game)).toBe(true);
    clearActiveGame();
    expect(loadGamePosition(game.id)).toEqual({ game, error: false });
    const next = { ...game, session: pass(game.session) };
    expect(saveGamePosition(next)).toBe(true);
    expect(saveGamePosition(game)).toBe(false);
    expect(loadGamePosition(game.id).game).toEqual(next);
    const other = { ...game, id: newGameId() };
    expect(saveGamePosition(other)).toBe(true);
    expect(loadGamePosition(other.id).game).toEqual(other);
    expect(localStorage.getItem(SAVED_GAME_PREFIX + game.id)).not.toBeNull();
  });
});
