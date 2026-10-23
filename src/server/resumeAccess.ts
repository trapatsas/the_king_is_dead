import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Operator-issued recovery for legacy games without a browser snapshot.
 * A game ID is never permission to read its private state. Only the random,
 * expiring secret issued on the local server grants access to one game. */
export class ResumeAccess {
  constructor(private readonly directory: string) {}
  private path(token: string) {
    return join(
      this.directory,
      createHash("sha256").update(token).digest("hex") + ".json",
    );
  }
  issue(gameId: string, lifetimeMs = 2 * 60 * 60 * 1000): string {
    if (
      !/^king-[a-f0-9-]{36}$/.test(gameId) ||
      !Number.isFinite(lifetimeMs) ||
      lifetimeMs <= 0
    )
      throw new Error("Invalid recovery grant");
    const token = randomBytes(32).toString("hex");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    writeFileSync(
      this.path(token),
      JSON.stringify({ gameId, expiresAt: Date.now() + lifetimeMs }),
      { flag: "wx", mode: 0o600 },
    );
    return token;
  }
  game(token: unknown): string | null {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
    try {
      const grant = JSON.parse(readFileSync(this.path(token), "utf8"));
      return typeof grant.gameId === "string" &&
        /^king-[a-f0-9-]{36}$/.test(grant.gameId) &&
        Number.isFinite(grant.expiresAt) &&
        grant.expiresAt > Date.now()
        ? grant.gameId
        : null;
    } catch {
      return null;
    }
  }
}
