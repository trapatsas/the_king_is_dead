// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchRequest, SearchResult } from "../bot/search";
import { passPlan } from "../bot/simulation";
import { setupSession } from "../test/turnFixtures";
import { editFixture } from "../test/standardFixtures";
import { Game } from "./Game";
import { Setup } from "./Setup";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  prepare: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("../bot/client", () => ({
  BotClient: class {
    search = mocks.search;
    prepare = mocks.prepare;
    dispose = mocks.dispose;
  },
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
});
function botSession() {
  return editFixture(setupSession(2), (state) => {
    state.players[state.activePlayerId]!.controller = "algorithmic";
  });
}
function result(session = botSession()): SearchResult {
  return {
    plan: passPlan(session.state),
    explanation: "pass",
    stats: {
      iterations: 1,
      elapsedMs: 1,
      nodes: 1,
      maxDepth: 5,
      horizon: 5,
      horizonVisits: 1,
      terminalVisits: 0,
      rootChoices: 1,
      reusedVisits: 0,
    },
  };
}

describe("bot orchestration", () => {
  it("prepares the Hard model before searching and displays its underlying agent", async () => {
    let ready!: (id: string) => void;
    mocks.prepare.mockImplementation(
      () =>
        new Promise((resolve) => {
          ready = resolve;
        }),
    );
    mocks.search.mockImplementation(() => new Promise(() => {}));
    const session = editFixture(botSession(), (state) => {
      state.players[state.activePlayerId]!.botStrategy = "ml";
    });
    render(<Game initialSession={session} />);
    expect(screen.getByText("Loading learned model")).toBeDefined();
    expect(
      screen.getByRole("region", { name: "Bot turn" }).textContent,
    ).toContain("Hard bot");
    expect(
      within(screen.getByRole("region", { name: "Bot turn" })).getByText(
        "Agent: ML v2 · linear value model",
      ),
    ).toBeDefined();
    expect(mocks.search).not.toHaveBeenCalled();
    await act(() => ready("ml-pilot-69f477be34b9"));
    expect(mocks.search).toHaveBeenCalledOnce();
    const [req] = mocks.search.mock.calls[0]! as [SearchRequest, AbortSignal];
    expect(
      req.observation.players.find((p) => p.id === req.observation.viewer)
        ?.botStrategy,
    ).toBe("ml");
    expect(screen.queryByRole("button", { name: /^Play / })).toBeNull();
  });
  it("sends the patient profile to its worker without exposing a bot hand", () => {
    mocks.search.mockImplementation(() => new Promise(() => {}));
    const session = editFixture(botSession(), (state) => {
      state.players[state.activePlayerId]!.botStrategy = "patient";
    });
    render(<Game initialSession={session} />);
    const [req] = mocks.search.mock.calls[0]! as [SearchRequest, AbortSignal];
    expect(
      req.observation.players.find(
        (player) => player.id === session.state.activePlayerId,
      )?.botStrategy,
    ).toBe("patient");
    expect(
      screen.getByRole("region", { name: "Bot turn" }).textContent,
    ).toContain("Easy bot");
    expect(screen.queryByRole("button", { name: /^Play / })).toBeNull();
  });
  it("routes the informed profile to the worker and labels the thinking panel", () => {
    mocks.search.mockImplementation(() => new Promise(() => {}));
    const session = editFixture(botSession(), (state) => {
      state.players[state.activePlayerId]!.botStrategy = "informed";
    });
    render(<Game initialSession={session} />);
    const [req] = mocks.search.mock.calls[0]! as [SearchRequest, AbortSignal];
    expect(
      req.observation.players.find(
        (player) => player.id === session.state.activePlayerId,
      )?.botStrategy,
    ).toBe("informed");
    expect(
      screen.getByRole("region", { name: "Bot turn" }).textContent,
    ).toContain("Medium bot");
    expect(screen.queryByRole("button", { name: /^Play / })).toBeNull();
  });
  it("shows thinking with no hand or human controls, then validates and hands over", async () => {
    let resolve!: (result: SearchResult) => void;
    mocks.search.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const session = botSession(),
      onCommit = vi.fn();
    render(<Game initialSession={session} onCommit={onCommit} />);
    expect(screen.getByRole("region", { name: "Bot turn" })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Reveal .* hand/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Play / })).toBeNull();
    expect(screen.queryByRole("button", { name: "End Turn" })).toBeNull();
    const [req] = mocks.search.mock.calls[0]! as [SearchRequest, AbortSignal];
    expect(req.observation.viewer).toBe(session.state.activePlayerId);
    expect(JSON.stringify(req)).not.toContain(session.state.initialSeed);
    await act(() => resolve(result(session)));
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit.mock.calls[0]![0].state.turnSequence).toBe(1);
    expect(
      screen.getByRole("button", { name: "Play Scottish Support" }),
    ).toBeDefined();
  });
  it("rejects stale replies without changing history and supports retry", async () => {
    const session = botSession(),
      bad = result(session),
      onCommit = vi.fn();
    mocks.search.mockResolvedValue({
      ...bad,
      plan: { ...bad.plan, baseTurnSequence: 999 },
    });
    const user = userEvent.setup();
    render(<Game initialSession={session} onCommit={onCommit} />);
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(onCommit).not.toHaveBeenCalled();
    mocks.search.mockResolvedValue(result(session));
    await user.click(screen.getByRole("button", { name: "Retry bot turn" }));
    expect(
      await screen.findByRole("button", { name: "Play Scottish Support" }),
    ).toBeDefined();
    expect(onCommit).toHaveBeenCalledOnce();
  });
  it("cancels the old game and ignores replies arriving after unmount", async () => {
    let resolve!: (result: SearchResult) => void;
    mocks.search.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const onCommit = vi.fn(),
      session = botSession();
    const view = render(<Game initialSession={session} onCommit={onCommit} />);
    const signal = mocks.search.mock.calls[0]![1] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    expect(mocks.dispose).toHaveBeenCalledOnce();
    await act(() => resolve(result(session)));
    expect(onCommit).not.toHaveBeenCalled();
  });
  it.each(["patient", "informed", "ml"])(
    "starts %s from normal setup in production mode",
    async (strategy) => {
      vi.stubEnv("DEV", false);
      window.history.replaceState(null, "", "/");
      const user = userEvent.setup();
      const start = vi.fn();
      render(<Setup onStart={start} />);
      await user.selectOptions(
        screen.getByLabelText("Player 2 type"),
        strategy,
      );
      expect(
        screen.queryByText(/Algorithmic opponents are in development/),
      ).toBeNull();
      expect(
        screen.queryByText(/Experimental Standard bot preview/),
      ).toBeNull();
      await user.click(screen.getByRole("button", { name: /Begin game/ }));
      expect(start.mock.calls[0]![0].players[1]).toMatchObject({
        controller: "algorithmic",
        botStrategy: strategy,
      });
    },
  );
});
