// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupSession } from "../test/turnFixtures";
import { App, Game } from "./App";
import { GameErrorBoundary } from "./ErrorBoundary";
import { CARD_TEXT } from "./presentation";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe("keyboard focus and accessible names", () => {
  it("keeps focus on the board after a board pick disables the used control", async () => {
    const user = userEvent.setup();
    render(<Game initialSession={setupSession()} />);

    await user.click(
      screen.getByRole("button", { name: "Play Scottish Support" }),
    );
    const target = screen.getByRole("button", {
      name: /^Strathclyde: .*legal choice$/,
    });
    target.focus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("region", { name: "Summon a follower" }),
    ).toBeDefined();
    expect((target as HTMLButtonElement).disabled).toBe(true);
    const active = document.activeElement as HTMLButtonElement;
    expect(active).not.toBe(document.body);
    expect(active.disabled).toBe(false);
    expect(active.className).toContain("follower-token");
  });

  it("names every faction count and the instability readout", () => {
    render(<Game initialSession={setupSession()} />);
    const supply = screen.getByRole("group", { name: "Followers in supply" });
    expect(
      within(supply)
        .getAllByRole("img")
        .map((count) => count.getAttribute("aria-label")),
    ).toEqual([
      expect.stringMatching(/^Scottish \d+$/),
      expect.stringMatching(/^Welsh \d+$/),
      expect.stringMatching(/^English \d+$/),
    ]);
    expect(
      screen.getByRole("img", { name: "0 of 3 instability discs placed" }),
    ).toBeDefined();
  });

  it("describes each hand card with its rule text", () => {
    render(<Game initialSession={setupSession()} />);

    const card = screen.getByRole("button", { name: "Play Negotiate" });
    const description = document.getElementById(
      card.getAttribute("aria-describedby")!,
    );
    expect(description?.textContent).toBe(CARD_TEXT.negotiate);
  });

  it("prints each card's rules on the card so hovering never selects or hides them", async () => {
    const user = userEvent.setup();
    render(<Game initialSession={setupSession()} />);
    const card = screen.getByRole("button", { name: "Play Negotiate" });
    expect(card.textContent).toContain(CARD_TEXT.negotiate);
    await user.hover(card);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(card.getAttribute("aria-pressed")).toBe("false");
  });

  it("opens How to play with every Standard card and returns focus on close", async () => {
    const user = userEvent.setup();
    render(<App initialSession={setupSession()} />);
    const help = screen.getByRole("button", { name: "How to play" });
    await user.click(help);
    const dialog = screen.getByRole("dialog", { name: "How to play" });
    for (const text of Object.values(CARD_TEXT).filter(
      (rule) => rule !== CARD_TEXT.plot,
    ))
      expect(dialog.textContent).toContain(text);
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Close how to play" }),
    );
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(help);
  });

  it("uses no dead links and returns focus to New game when leaving is cancelled", async () => {
    const user = userEvent.setup();
    render(<App initialSession={setupSession()} />);
    expect(screen.queryByRole("link")).toBeNull();
    const newGame = screen.getByRole("button", { name: "New game" });
    await user.click(newGame);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Keep playing" }),
    );
    await user.click(screen.getByRole("button", { name: "Keep playing" }));
    expect(document.activeElement).toBe(newGame);
  });
});

describe("recovery and game identity", () => {
  it("recovers from a render failure without showing the raw error", async () => {
    const user = userEvent.setup();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const onRetry = vi.fn();
    function Broken(): never {
      throw new Error("Duplicate card ID: cunning:spy");
    }
    render(
      <GameErrorBoundary onRetry={onRetry} onLeave={() => {}}>
        <Broken />
      </GameErrorBoundary>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Every committed turn is intact");
    expect(alert.textContent).not.toContain("cunning:spy");
    await user.click(screen.getByRole("button", { name: "Restart this turn" }));
    expect(onRetry).toHaveBeenCalledOnce();
    quiet.mockRestore();
  });

  it("starts a fresh game when the same seed is chosen again", async () => {
    const user = userEvent.setup();
    render(<App />);
    async function begin() {
      await user.click(screen.getByText("Reproducible setup"));
      await user.type(screen.getByLabelText("Setup seed"), "same-seed");
      await user.click(screen.getByRole("button", { name: /Begin game/ }));
    }
    await begin();

    await user.click(screen.getByRole("button", { name: "Pass" }));
    await user.click(screen.getByRole("button", { name: "End Turn" }));
    expect(screen.getByText(/TURN 2/)).toBeDefined();
    await user.click(screen.getByRole("button", { name: "New game" }));
    await user.click(screen.getByRole("button", { name: "Leave game" }));
    await begin();
    expect(screen.getByText(/TURN 1/)).toBeDefined();
  });
});
