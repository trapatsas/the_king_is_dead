import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResumeAccess } from "./resumeAccess";

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
describe("scoped legacy resume access", () => {
  it("requires a random secret, scopes it to one game, and expires it", () => {
    const directory = mkdtempSync(join(tmpdir(), "king-resume-"));
    directories.push(directory);
    const store = new ResumeAccess(directory);
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const id = "king-00000000-0000-0000-0000-000000000123";
    const token = store.issue(id, 100);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(store.game(token)).toBe(id);
    expect(store.game(id)).toBeNull();
    expect(store.game("../private")).toBeNull();
    expect(store.game("a".repeat(64))).toBeNull();
    now.mockReturnValue(1100);
    expect(store.game(token)).toBeNull();
  });
});
