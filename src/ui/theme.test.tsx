// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupSession } from "../test/turnFixtures";
import { App } from "./App";
import { ThemeToggle } from "./ThemeToggle";
import { THEME_STORAGE_KEY } from "./theme";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty("color-scheme");
  document.querySelector('meta[name="theme-color"]')?.remove();
});

describe("appearance preference", () => {
  it("remembers the selected palette across remounts and can restore light mode", async () => {
    const user = userEvent.setup();
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
    localStorage.setItem(THEME_STORAGE_KEY, "invalid-preference");
    const first = render(<ThemeToggle />);
    await user.click(
      screen.getByRole("button", { name: "Switch to dark mode" }),
    );
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(meta.content).toBe("#111c19");
    first.unmount();
    delete document.documentElement.dataset.theme;
    document.documentElement.style.removeProperty("color-scheme");
    render(<ThemeToggle />);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    await user.click(
      screen.getByRole("button", { name: "Switch to light mode" }),
    );
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(meta.content).toBe("#f3f0e8");
  });

  it.each(["getItem", "setItem"] as const)(
    "keeps appearance usable when storage %s is blocked",
    async (method) => {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new DOMException("Storage blocked", "SecurityError");
      });
      const user = userEvent.setup();
      render(<App />);
      await user.click(
        screen.getByRole("button", { name: "Switch to dark mode" }),
      );
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(screen.getByRole("button", { name: /Begin game/ })).toBeDefined();
      await user.click(
        screen.getByRole("button", { name: "Switch to light mode" }),
      );
      expect(document.documentElement.dataset.theme).toBe("light");
    },
  );

  it("preserves the active hand and uncommitted turn when changing palettes", async () => {
    const user = userEvent.setup();
    render(<App initialSession={setupSession()} />);

    await user.click(screen.getByRole("button", { name: "Pass" }));
    const summary = screen.getByRole("region", {
      name: "Final turn summary",
    }).textContent;
    await user.click(
      screen.getByRole("button", { name: "Switch to dark mode" }),
    );
    expect(
      screen.getByRole("region", { name: "Final turn summary" }).textContent,
    ).toBe(summary);
    expect(screen.getAllByRole("button", { name: /^Play / })).toHaveLength(8);
    await user.click(screen.getByRole("button", { name: "End Turn" }));
    expect(screen.getByText(/TURN 2/)).toBeDefined();
    expect(screen.getAllByRole("button", { name: /^Play / })).toHaveLength(8);
    expect(document.documentElement.dataset.theme).toBe("dark");
    await user.click(
      screen.getByRole("button", { name: "Switch to light mode" }),
    );
    expect(
      screen.getByRole("button", { name: "Play Scottish Support" }),
    ).toBeDefined();
  });
});
