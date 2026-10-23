import type { GameSession } from "../game/events";
import { sameChoice } from "../game/plans";
import { createGame } from "../game/setup";
import { commitPlan } from "./session";

export const ACTIVE_GAME_KEY = "king-is-dead:active-game:v1";
export const SAVED_GAME_PREFIX = "king-is-dead:saved-game:v1:";
export interface SavedGame {
  readonly version: 1;
  readonly id: string;
  readonly createdAt: string;
  readonly session: GameSession;
}

/** Private saved positions are separate from public log exports. Rebuild every
 * accepted turn rather than trusting a stored checkpoint. */
export function parseSavedGame(text: string): SavedGame {
  if (text.length > 2_000_000) throw new Error("Saved position is too large");
  const saved = JSON.parse(text) as SavedGame;
  if (
    saved?.version !== 1 ||
    typeof saved.id !== "string" ||
    !/^king-[a-f0-9-]{36}$/.test(saved.id) ||
    typeof saved.createdAt !== "string" ||
    !Number.isFinite(Date.parse(saved.createdAt)) ||
    !Array.isArray(saved.session?.events) ||
    saved.session.events.length > 256
  )
    throw new Error("Invalid saved position");
  const first = saved.session.events[0];
  if (first?.type !== "GameCreated" || first.config.mode !== "standard")
    throw new Error("Resume requires a Standard game");
  let replay: GameSession = createGame(first.config);
  for (const event of saved.session.events) {
    if (event.type === "TurnCommitted") replay = commitPlan(replay, event.plan);
  }
  if (!sameChoice(replay, saved.session))
    throw new Error("Recovery replay mismatch");
  return {
    version: 1,
    id: saved.id,
    createdAt: saved.createdAt,
    session: replay,
  };
}

/** Tab-local storage survives refresh without replacing another tab's game. */
export function loadActiveGame(): { game: SavedGame | null; error: boolean } {
  try {
    const text = sessionStorage.getItem(ACTIVE_GAME_KEY);
    const active = text ? parseSavedGame(text) : null;
    const saved = active ? loadGamePosition(active.id).game : null;
    return {
      game:
        saved &&
        active &&
        saved.session.state.eventSequence > active.session.state.eventSequence
          ? saved
          : active,
      error: false,
    };
  } catch {
    return { game: null, error: true };
  }
}
export function saveActiveGame(game: SavedGame): boolean {
  const saved = saveGamePosition(game);
  try {
    sessionStorage.setItem(
      ACTIVE_GAME_KEY,
      JSON.stringify({
        version: 1,
        id: game.id,
        createdAt: game.createdAt,
        session: game.session,
      }),
    );
    return saved;
  } catch {
    return false;
  }
}

/** Each game keeps its own browser-owned position after leaving or closing a
 * tab. The public log and its exports never include this private snapshot. */
export function saveGamePosition(game: SavedGame): boolean {
  try {
    const key = SAVED_GAME_PREFIX + game.id;
    const old = localStorage.getItem(key);
    if (old) {
      const previous = parseSavedGame(old);
      if (
        previous.session.state.eventSequence >
          game.session.state.eventSequence ||
        !sameChoice(
          previous.session.events,
          game.session.events.slice(0, previous.session.events.length),
        )
      )
        return false;
    }
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        id: game.id,
        createdAt: game.createdAt,
        session: game.session,
      }),
    );
    return true;
  } catch {
    return false;
  }
}
export function loadGamePosition(id: string): {
  game: SavedGame | null;
  error: boolean;
} {
  try {
    const text = localStorage.getItem(SAVED_GAME_PREFIX + id);
    const game = text ? parseSavedGame(text) : null;
    if (game && game.id !== id) throw new Error("Saved game ID mismatch");
    return { game, error: false };
  } catch {
    return { game: null, error: true };
  }
}
export function hasGamePosition(id: string): boolean {
  try {
    return localStorage.getItem(SAVED_GAME_PREFIX + id) !== null;
  } catch {
    return false;
  }
}
export function clearActiveGame(): boolean {
  try {
    sessionStorage.removeItem(ACTIVE_GAME_KEY);
    return true;
  } catch {
    return false;
  }
}
