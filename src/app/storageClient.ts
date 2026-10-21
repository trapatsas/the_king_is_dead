import { botTelemetry } from "./botTelemetry";
import type { GameSession } from "../game/events";

export type SaveState = "saving" | "saved" | "error";
interface PendingRequest {
  readonly url: string;
  readonly data: Record<string, unknown>;
}

/** Ordered, idempotent delivery of ACCEPTED commands only. Pending data survives
 * reload, even though restoring the UI's active game is a separate feature. */
export class StorageClient {
  private queue: PendingRequest[] = [];
  private running = false;
  private blocked = false;
  private readonly cursors = new Map<string, number>();
  private readonly setup = new Set<string>();
  private readonly key = "king:sqlite-outbox:v1";
  constructor(
    private readonly status: (state: SaveState) => void,
    private readonly request: typeof fetch = (...args) => fetch(...args),
    private readonly storage: Storage | null = typeof localStorage ===
    "undefined"
      ? null
      : localStorage,
  ) {
    try {
      const loaded = new Map<string, PendingRequest>();
      // Migrate the initial single-key format without discarding unsent moves.
      const legacy: unknown = JSON.parse(
        this.storage?.getItem(this.key) ?? "[]",
      );
      if (!Array.isArray(legacy) || legacy.length > 4096)
        throw new Error("Invalid outbox");
      for (const item of legacy) loaded.set(this.itemKey(item), item);
      if (this.storage)
        for (let i = 0; i < this.storage.length; i++) {
          const key = this.storage.key(i);
          if (!key?.startsWith(this.key + ":")) continue;
          const item = JSON.parse(this.storage.getItem(key)!);
          if (this.itemKey(item) !== key)
            throw new Error("Invalid outbox identity");
          loaded.set(key, item);
        }
      this.queue = [...loaded.values()].sort((a, b) => {
        const left = this.itemKey(a).split(":")[3]!,
          right = this.itemKey(b).split(":")[3]!;
        return (
          left.localeCompare(right) ||
          Number(a.data.baseEventSequence ?? -1) -
            Number(b.data.baseEventSequence ?? -1)
        );
      });
      if (this.persist()) this.storage?.removeItem(this.key);
    } catch {
      this.blocked = true;
      this.status("error");
    }
  }
  private itemKey(item: PendingRequest): string {
    if (!item || !item.data || typeof item.data !== "object")
      throw new Error("Invalid pending request");
    const match = /^\/api\/games\/(king-[a-f0-9-]{36})\/commands$/.exec(
      item.url,
    );
    const id = item.url === "/api/games" ? item.data.id : match?.[1];
    const request = item.url === "/api/games" ? "setup" : item.data.requestId;
    if (
      typeof id !== "string" ||
      !/^king-[a-f0-9-]{36}$/.test(id) ||
      typeof request !== "string" ||
      !/^[a-zA-Z0-9:_.-]{1,120}$/.test(request)
    )
      throw new Error("Invalid pending identity");
    return `${this.key}:${id}:${request}`;
  }
  private persist() {
    try {
      for (const item of this.queue) {
        const key = this.itemKey(item),
          data = JSON.stringify(item),
          old = this.storage?.getItem(key);
        if (old && old !== data) {
          this.blocked = true;
          throw new Error("Conflicting pending save");
        }
        this.storage?.setItem(key, data);
      }
      return true;
    } catch {
      this.status("error");
      return false;
    }
  }
  capture(id: string, session: GameSession) {
    if (this.blocked) {
      this.status("error");
      return;
    }
    const first = session.events[0];
    if (first?.type !== "GameCreated" || first.config.mode !== "standard")
      return;
    if (!this.setup.has(id)) {
      this.setup.add(id);
      this.queue.push({
        url: "/api/games",
        data: { id, config: first.config },
      });
    }
    let cursor = this.cursors.get(id) ?? 0;
    for (let i = 1; i < session.events.length; i++) {
      const event = session.events[i]!;
      if (event.type !== "TurnCommitted" || event.eventSequence <= cursor)
        continue;
      this.queue.push({
        url: `/api/games/${id}/commands`,
        data: {
          requestId: `turn-${event.turnSequence}`,
          baseEventSequence: event.eventSequence - 1,
          plan: event.plan,
          decision: botTelemetry(session, event.turnSequence),
        },
      });
      // Mark the last event in this complete command's batch.
      let end = i;
      while (
        end + 1 < session.events.length &&
        session.events[end + 1]!.type !== "TurnCommitted"
      )
        end++;
      cursor = session.events[end]!.eventSequence;
    }
    this.cursors.set(id, cursor);
    // A full browser store must not prevent an available SQLite server from
    // acknowledging the save. If both fail, keep the queued command in memory.
    this.persist();
    void this.flush();
  }
  async flush() {
    if (this.running || this.blocked) return;
    this.running = true;
    try {
      while (this.queue.length) {
        this.status("saving");
        const item = this.queue[0]!;
        const response = await this.request(item.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item.data),
        });
        if (!response.ok) throw new Error("Save rejected");
        const key = this.itemKey(item);
        const saved = this.storage?.getItem(key);
        if (saved && saved !== JSON.stringify(item))
          throw new Error("Conflicting pending save");
        this.storage?.removeItem(key);
        this.queue.shift();
      }
      this.status("saved");
    } catch {
      this.status("error");
    } finally {
      this.running = false;
    }
  }
}
