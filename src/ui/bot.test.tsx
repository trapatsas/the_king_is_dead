// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchRequest, SearchResult } from "../bot/search";
import { passPlan } from "../bot/simulation";
import { setupSession } from "../test/turnFixtures";
import { editFixture } from "../test/standardFixtures";
import { Game } from "./Game";
import { Setup } from "./Setup";

const mocks = vi.hoisted(() => ({ search: vi.fn(), dispose: vi.fn() }));
vi.mock("../bot/client", () => ({
  BotClient: class {
    search = mocks.search;
    dispose = mocks.dispose;
  },
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
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
      screen.getByRole("button", { name: /Reveal .* hand/ }),
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
      await screen.findByRole("button", { name: /Reveal .* hand/ }),
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
  it("keeps the research release gate closed and permits explicit development preview", async () => {
    const user = userEvent.setup();
    const view = render(<Setup onStart={vi.fn()} />);
    await user.selectOptions(
      screen.getByLabelText("Player 2 controller"),
      "algorithmic",
    );
    expect(
      (screen.getByRole("button", { name: /Begin game/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    view.unmount();
    window.history.replaceState(null, "", "/?bots=experimental");
    const start = vi.fn();
    render(<Setup onStart={start} />);
    await user.selectOptions(
      screen.getByLabelText("Player 2 controller"),
      "algorithmic",
    );
    await user.click(screen.getByRole("button", { name: /Begin game/ }));
    expect(start.mock.calls[0]![0].players[1].controller).toBe("algorithmic");
  });
});
