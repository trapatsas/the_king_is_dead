import { BOT_STRATEGIES } from "../game/domain";
import type { BotStrategy, ControllerKind, GameMode } from "../game/domain";
import type { GameSession } from "../game/events";
import { projectPublicLog } from "../ui/finishedLog";
import type { GameLogEntry } from "../ui/finishedLog";

export const ARCHIVE_PREFIX = "king-is-dead:public-log:v1:";
export interface ArchivedGame {
  readonly version: 1;
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly mode: GameMode;
  readonly players: readonly {
    readonly name: string;
    readonly controller: ControllerKind;
    readonly botStrategy?: BotStrategy;
  }[];
  readonly status: "partial" | "finished";
  readonly turns: number;
  readonly entries: readonly GameLogEntry[];
}
export function newGameId(): string {
  if (typeof crypto.randomUUID === "function")
    return `king-${crypto.randomUUID()}`;
  // getRandomValues also works on a local network's HTTP origin, where
  // randomUUID may be unavailable because it requires a secure context.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `king-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function archiveSnapshot(
  id: string,
  createdAt: string,
  session: GameSession,
): ArchivedGame {
  return {
    version: 1,
    id,
    createdAt,
    updatedAt: new Date().toISOString(),
    mode: session.state.mode,
    players: session.state.playerOrder.map((id) => ({
      name: id,
      controller: session.state.players[id]!.controller,
      ...(session.state.players[id]!.botStrategy
        ? { botStrategy: session.state.players[id]!.botStrategy }
        : {}),
    })),
    status: session.state.phase === "finished" ? "finished" : "partial",
    turns: session.state.turnSequence,
    entries: projectPublicLog(session),
  };
}
/** Each game has its own storage key so different tabs cannot overwrite an
 * unrelated game. A failed save never drops old archives or interrupts play.
 * Only the public projection is saved; this is not a resumable engine snapshot.
 */
export function saveArchive(game: ArchivedGame, storage?: Storage): boolean {
  try {
    const target = storage ?? localStorage;
    target.setItem(ARCHIVE_PREFIX + game.id, JSON.stringify(game));
    return true;
  } catch {
    return false;
  }
}

/** Export the public schema explicitly, even if a stored record has additional
 * fields. This never serializes an internal session or hidden setup data. */
export function serializeArchive(game: ArchivedGame): string {
  const payload: ArchivedGame = {
    version: game.version,
    id: game.id,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
    mode: game.mode,
    players: game.players.map((player) => ({
      name: player.name,
      controller: player.controller,
      ...(player.botStrategy ? { botStrategy: player.botStrategy } : {}),
    })),
    status: game.status,
    turns: game.turns,
    entries: game.entries.map((entry) => ({
      sequence: entry.sequence,
      label: entry.label,
      heading: entry.heading,
      details: [...entry.details],
      ...(entry.followers
        ? {
            followers: {
              caption: entry.followers.caption,
              rows: entry.followers.rows.map((row) => ({
                label: row.label,
                counts: {
                  scottish: row.counts.scottish,
                  welsh: row.counts.welsh,
                  english: row.counts.english,
                },
              })),
            },
          }
        : {}),
    })),
  };
  return JSON.stringify(payload, null, 2);
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length <= 20000;
}
function counter(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 1024 && value.every(text);
}
function validEntry(value: unknown): value is GameLogEntry {
  if (
    !object(value) ||
    !counter(value.sequence) ||
    !text(value.label) ||
    !text(value.heading) ||
    !strings(value.details)
  )
    return false;
  if (value.followers === undefined) return true;
  const followers = value.followers;
  return (
    object(followers) &&
    text(followers.caption) &&
    Array.isArray(followers.rows) &&
    followers.rows.length <= 64 &&
    followers.rows.every(
      (row) =>
        object(row) &&
        text(row.label) &&
        object(row.counts) &&
        [row.counts.scottish, row.counts.welsh, row.counts.english].every(
          counter,
        ),
    )
  );
}
function validArchive(value: unknown): value is ArchivedGame {
  return (
    object(value) &&
    value.version === 1 &&
    text(value.id) &&
    /^king-[a-f0-9-]{36}$/.test(value.id) &&
    text(value.createdAt) &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    text(value.updatedAt) &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    (value.mode === "standard" || value.mode === "advanced") &&
    (value.status === "partial" || value.status === "finished") &&
    counter(value.turns) &&
    Array.isArray(value.players) &&
    [2, 3].includes(value.players.length) &&
    value.players.every(
      (player) =>
        object(player) &&
        text(player.name) &&
        ["human", "algorithmic", "llm"].includes(player.controller as string) &&
        (player.botStrategy === undefined ||
          (player.controller === "algorithmic" &&
            BOT_STRATEGIES.includes(player.botStrategy as BotStrategy))),
    ) &&
    Array.isArray(value.entries) &&
    value.entries.length > 0 &&
    value.entries.length <= 2048 &&
    value.entries.every(validEntry) &&
    value.entries.every((entry, index) => entry.sequence === index)
  );
}
export function readArchives(storage?: Storage): {
  games: ArchivedGame[];
  unavailable: boolean;
  invalid: number;
} {
  const games: ArchivedGame[] = [];
  let invalid = 0;
  try {
    const source = storage ?? localStorage;
    for (let i = 0; i < source.length; i++) {
      const key = source.key(i);
      if (!key?.startsWith(ARCHIVE_PREFIX)) continue;
      try {
        const value: unknown = JSON.parse(source.getItem(key) ?? "null");
        if (validArchive(value) && key === ARCHIVE_PREFIX + value.id)
          games.push(value);
        else invalid++;
      } catch {
        invalid++;
      }
    }
    games.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { games, invalid, unavailable: false };
  } catch {
    return { games, invalid, unavailable: true };
  }
}
