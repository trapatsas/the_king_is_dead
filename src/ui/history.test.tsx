// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupSession, pass } from "../test/turnFixtures";
import { play } from "../test/standardFixtures";
import {
  archiveSnapshot,
  newGameId,
  readArchives,
  saveArchive,
} from "../app/gameArchive";
import { projectLastMoves, projectPublicLog } from "./finishedLog";
import { App, Game } from "./App";
import { Setup } from "./Setup";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});
describe("visible last moves", () => {
  it("keeps the last committed card and effect/summon details visible behind handoff", () => {
    const session = setupSession(),
      after = play(session, "scottish-support");
    render(<Game initialSession={after} />);
    const move = screen.getByRole("region", {
      name: `${session.state.activePlayerId} last move`,
    });
    expect(move.textContent).toContain("Turn 1");
    expect(move.textContent).toContain("Played Scottish Support");
    expect(move.textContent).toContain("Summon:");
    expect(screen.queryByRole("button", { name: /^Play / })).toBeNull();
  });
  it("replaces a card with Passed on that player's next turn and retains other seats' latest moves", () => {
    const initial = setupSession(2),
      played = play(initial, "assemble"),
      opponent = pass(played),
      next = pass(opponent);
    const moves = projectLastMoves(next.events);
    expect(moves[initial.state.activePlayerId]).toMatchObject({
      turn: 3,
      summary: "Passed",
    });
    expect(moves[played.state.activePlayerId]).toMatchObject({
      turn: 2,
      summary: "Passed",
    });
    render(<Game initialSession={next} />);
    expect(
      screen.getByRole("region", {
        name: `${initial.state.activePlayerId} last move`,
      }).textContent,
    ).toContain("Passed");
  });
  it("does not publish draft passes as last moves or into saved history", async () => {
    const user = userEvent.setup();
    render(<App initialSession={setupSession(2)} />);
    const archived = readArchives().games[0]!;
    await user.click(screen.getByRole("button", { name: /^Reveal .* hand$/ }));
    await user.click(screen.getByRole("button", { name: "Pass" }));
    expect(screen.getAllByText("Has not played yet")).toHaveLength(2);
    expect(readArchives().games[0]!.entries).toEqual(archived.entries);
    await user.click(screen.getByRole("button", { name: "End Turn" }));
    expect(readArchives().games[0]!.entries.at(-1)?.heading).toContain(
      "passed",
    );
  });
});
describe("seat names", () => {
  it("configures humans, the reference bot and the patient bot in the same game", async () => {
    window.history.replaceState(null, "", "/?bots=experimental");
    const user = userEvent.setup(),
      start = vi.fn();
    render(<Setup onStart={start} />);
    await user.selectOptions(
      screen.getByLabelText("Player 2 controller"),
      "algorithmic",
    );
    await user.selectOptions(
      screen.getByLabelText("Player 3 controller"),
      "algorithmic",
    );
    expect(
      (screen.getByLabelText("Player 2 strategy") as HTMLSelectElement).value,
    ).toBe("reference");
    await user.selectOptions(
      screen.getByLabelText("Player 3 strategy"),
      "patient",
    );
    await user.click(screen.getByRole("button", { name: /Begin game/ }));
    expect(start.mock.calls[0]![0].players).toEqual([
      { id: "Player 1", controller: "human" },
      { id: "Bot 2", controller: "algorithmic", botStrategy: "reference" },
      { id: "Bot 3", controller: "algorithmic", botStrategy: "patient" },
    ]);
  });
  it("uses custom human and bot names and rejects ambiguous duplicates", async () => {
    window.history.replaceState(null, "", "/?bots=experimental");
    const user = userEvent.setup(),
      start = vi.fn();
    render(<Setup onStart={start} />);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Players" }),
      "2",
    );
    await user.type(screen.getByLabelText("Player 1 name"), " Alice ");
    await user.selectOptions(
      screen.getByLabelText("Player 2 controller"),
      "algorithmic",
    );
    await user.type(screen.getByLabelText("Player 2 name"), "alice");
    expect(
      (screen.getByRole("button", { name: /Begin game/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.clear(screen.getByLabelText("Player 2 name"));
    await user.type(screen.getByLabelText("Player 2 name"), "Merlin");
    await user.click(screen.getByRole("button", { name: /Begin game/ }));
    expect(start.mock.calls[0]![0].players).toEqual([
      { id: "Alice", controller: "human" },
      { id: "Merlin", controller: "algorithmic", botStrategy: "reference" },
    ]);
  });
});
describe("game log archive UI", () => {
  it("copies the selected public game log and offers download when clipboard access fails", async () => {
    const user = userEvent.setup();
    const session = pass(setupSession(2));
    const id = newGameId();
    saveArchive(archiveSnapshot(id, new Date().toISOString(), session));
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Game history" }));
    await user.click(screen.getByRole("button", { name: new RegExp(id) }));
    const write = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    await user.click(screen.getByRole("button", { name: "Copy log" }));
    const exported = JSON.parse(write.mock.calls[0]![0]);
    expect(exported.id).toBe(id);
    expect(exported.entries.at(-1).heading).toContain("passed");
    expect(JSON.stringify(exported)).not.toContain(session.state.initialSeed);
    expect(screen.getByRole("status").textContent).toContain("Game log copied");
    write.mockRejectedValue(new DOMException("blocked", "NotAllowedError"));
    await user.click(screen.getByRole("button", { name: "Copy log" }));
    expect(screen.getByRole("status").textContent).toContain(
      "Use Download log",
    );
    expect(screen.getByRole("button", { name: "Download log" })).toBeDefined();
  });
  it("reopens logs by ID after leaving/reloading, without resuming the old game", async () => {
    const user = userEvent.setup();
    const initial = setupSession(2);
    const view = render(<App initialSession={initial} />);
    const id = readArchives().games[0]!.id;
    await user.click(screen.getByRole("button", { name: /^Reveal .* hand$/ }));
    await user.click(screen.getByRole("button", { name: "Pass" }));
    await user.click(screen.getByRole("button", { name: "End Turn" }));
    view.unmount();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Game history" }));
    const dialog = screen.getByRole("dialog", { name: "Saved game logs" });
    await user.type(within(dialog).getByLabelText("Find a game"), id);
    await user.click(
      within(dialog).getByRole("button", { name: new RegExp(id) }),
    );
    expect(
      within(dialog).getByRole("region", { name: "Selected game log" })
        .textContent,
    ).toContain(`${initial.state.activePlayerId} passed`);
    expect(dialog.textContent).toContain("Initial follower allocation");
    expect(dialog.textContent).not.toContain(initial.state.initialSeed);
    await user.click(
      within(dialog).getByRole("button", { name: "Close history" }),
    );
    expect(screen.getByRole("button", { name: /Begin game/ })).toBeDefined();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Game history" }),
    );
  });
  it("opens the current game directly and keeps distinct same-seed games", async () => {
    const user = userEvent.setup();
    const session = pass(setupSession());
    const oldId = newGameId();
    saveArchive(archiveSnapshot(oldId, new Date().toISOString(), session));
    render(<App initialSession={session} />);
    const current = readArchives().games.find((g) => g.id !== oldId)!;
    await user.click(
      screen.getByRole("button", { name: `Open log for game ${current.id}` }),
    );
    const log = screen.getByRole("region", { name: "Selected game log" });
    expect(log.textContent).toContain(current.id);
    expect(log.textContent).toContain("passed");
    expect(readArchives().games).toHaveLength(2);
    expect(projectPublicLog(session)[0]!.details.join(" ")).not.toContain(
      session.state.initialSeed,
    );
  });
});
