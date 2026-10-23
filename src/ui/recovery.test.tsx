// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newGameId, readArchives } from "../app/gameArchive";
import {
  loadActiveGame,
  saveGamePosition,
  SAVED_GAME_PREFIX,
} from "../app/activeGame";
import { archiveSnapshot, saveArchive } from "../app/gameArchive";
import { setupSession, pass } from "../test/turnFixtures";
import { App } from "./App";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});
describe("recovering an interrupted game", () => {
  it("resumes after reload at the last committed turn, discarding draft changes", async () => {
    const user = userEvent.setup();
    const view = render(<App initialSession={setupSession(2)} />);
    const id = readArchives().games[0]!.id;
    await user.click(screen.getByRole("button", { name: "Pass" }));
    await user.click(screen.getByRole("button", { name: "End Turn" }));
    await user.click(
      screen.getByRole("button", { name: "Play Scottish Support" }),
    );
    view.unmount();
    render(<App />);
    expect(screen.getByText(/TURN 2/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Pass" })).toBeDefined();
    expect(loadActiveGame().game?.id).toBe(id);
    expect(readArchives().games).toHaveLength(1);
    expect(
      Object.keys(localStorage).filter((key) =>
        key.startsWith("king:sqlite-outbox:v1:"),
      ),
    ).toHaveLength(2);
    expect(loadActiveGame().game?.session.state.turnSequence).toBe(1);
  });
  it("resumes from Game history after a tab is closed, retaining the ID and history", async () => {
    const user = userEvent.setup();
    const game = {
      version: 1,
      id: newGameId(),
      createdAt: new Date().toISOString(),
      session: pass(setupSession(2), 3),
    };
    saveGamePosition({ ...game, version: 1 });
    saveArchive(archiveSnapshot(game.id, game.createdAt, game.session));
    render(<App />);
    expect(document.querySelector('input[type="file"]')).toBeNull();
    await user.click(screen.getByRole("button", { name: "Game history" }));
    await user.click(screen.getByRole("button", { name: new RegExp(game.id) }));
    await user.click(screen.getByRole("button", { name: "Resume game" }));
    expect(await screen.findByText(/TURN 4/)).toBeDefined();
    expect(loadActiveGame().game?.id).toBe(game.id);
    await user.click(screen.getByRole("button", { name: "Pass" }));
    await user.click(screen.getByRole("button", { name: "End Turn" }));
    expect(loadActiveGame().game?.session.state.turnSequence).toBe(4);
  });
  it("confirms switching games and leaves the other position available to resume", async () => {
    const user = userEvent.setup();
    const saved = {
      version: 1 as const,
      id: newGameId(),
      createdAt: new Date().toISOString(),
      session: pass(setupSession(2), 3),
    };
    saveGamePosition(saved);
    saveArchive(archiveSnapshot(saved.id, saved.createdAt, saved.session));
    render(<App initialSession={setupSession(2)} />);
    const original = loadActiveGame().game!;
    await user.click(screen.getByRole("button", { name: "Game history" }));
    await user.click(
      screen.getByRole("button", { name: new RegExp(saved.id) }),
    );
    await user.click(screen.getByRole("button", { name: "Resume game" }));
    expect(
      screen.getByRole("dialog", { name: "Resume saved game" }),
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Keep playing" }));
    expect(loadActiveGame().game?.id).toBe(original.id);
    await user.click(screen.getByRole("button", { name: "Game history" }));
    await user.click(
      screen.getByRole("button", { name: new RegExp(saved.id) }),
    );
    await user.click(screen.getByRole("button", { name: "Resume game" }));
    await user.click(screen.getByRole("button", { name: "Resume saved game" }));
    expect(loadActiveGame().game?.id).toBe(saved.id);
    expect(
      localStorage.getItem(SAVED_GAME_PREFIX + original.id),
    ).not.toBeNull();
  });
  it("reports a corrupt position without replacing the current game", async () => {
    const user = userEvent.setup();
    const id = newGameId();
    saveArchive(archiveSnapshot(id, new Date().toISOString(), setupSession(2)));
    localStorage.setItem(SAVED_GAME_PREFIX + id, "{broken");
    render(<App initialSession={setupSession(2)} />);
    const original = loadActiveGame().game!.id;
    await user.click(screen.getByRole("button", { name: "Game history" }));
    await user.click(screen.getByRole("button", { name: new RegExp(id) }));
    await user.click(screen.getByRole("button", { name: "Resume game" }));
    expect(screen.getByRole("alert").textContent).toContain(
      "could not be resumed",
    );
    expect(loadActiveGame().game?.id).toBe(original);
  });
  it("opens the newer position when the same game advanced in another tab", async () => {
    const user = userEvent.setup();
    render(<App initialSession={setupSession(2)} />);
    const current = loadActiveGame().game!;
    const newer = { ...current, session: pass(current.session, 3) };
    saveGamePosition(newer);
    saveArchive(archiveSnapshot(newer.id, newer.createdAt, newer.session));
    await user.click(screen.getByRole("button", { name: "Game history" }));
    await user.click(
      within(screen.getByRole("navigation", { name: "Saved games" })).getByRole(
        "button",
        { name: new RegExp(current.id) },
      ),
    );
    await user.click(screen.getByRole("button", { name: "Resume game" }));
    expect(screen.getByText(/TURN 4/)).toBeDefined();
    expect(loadActiveGame().game?.id).toBe(current.id);
  });
  it("places a legacy server recovery into history without uploading a file", async () => {
    const user = userEvent.setup();
    const saved = {
      version: 1,
      id: newGameId(),
      createdAt: new Date().toISOString(),
      session: pass(setupSession(2), 3),
    };
    const token = "a".repeat(64);
    window.history.replaceState(null, "", "/#resume=" + token);
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(saved), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", request);
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(
      await screen.findByRole("button", { name: "Resume game" }),
    ).toBeDefined();
    expect(window.location.hash).toBe("");
    await user.click(screen.getByRole("button", { name: "Resume game" }));
    expect(await screen.findByText(/TURN 4/)).toBeDefined();
    expect(loadActiveGame().game?.id).toBe(saved.id);
    expect(request.mock.calls[0]).toEqual([
      "/api/resume",
      expect.objectContaining({ body: JSON.stringify({ token }) }),
    ]);
    expect(
      request.mock.calls.filter(([url]) => url === "/api/resume"),
    ).toHaveLength(1);
  });
  it("does not resume again after explicitly leaving the game", async () => {
    const user = userEvent.setup();
    const view = render(<App initialSession={setupSession(2)} />);
    await user.click(screen.getByRole("button", { name: "New game" }));
    await user.click(screen.getByRole("button", { name: "Leave game" }));
    view.unmount();
    render(<App />);
    expect(screen.getByRole("button", { name: /Begin game/ })).toBeDefined();
    expect(loadActiveGame().game).toBeNull();
  });
});
