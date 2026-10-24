// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { followers, pass, setupSession, withBoard } from "../test/turnFixtures";
import { App, Game } from "./App";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
});

const step = () =>
  within(screen.getByRole("list", { name: "Turn progress" }))
    .getAllByRole("listitem")
    .find((item) => item.getAttribute("aria-current") === "step")?.textContent;

describe("table layout", () => {
  it("shows the turn status in the app header while a game is mounted", () => {
    const session = setupSession();
    render(<App initialSession={session} />);
    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("heading", { level: 1 }).textContent).toBe(
      `${session.state.activePlayerId}’s turn`,
    );
    expect(within(banner).getByText(/TURN 1/)).toBeDefined();
  });

  it("tracks the turn steps and switches cards with a single click", async () => {
    const user = userEvent.setup();
    render(<Game initialSession={setupSession()} />);
    expect(step()).toContain("Card");

    await user.click(screen.getByRole("button", { name: "Play Negotiate" }));
    expect(step()).toContain("Effect");
    expect(
      screen.getByRole("heading", { name: "Choose either region card" }),
    ).toBeDefined();

    const assemble = screen.getByRole("button", { name: "Play Assemble 1" });
    await user.click(assemble);
    expect(assemble.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Play Negotiate" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen.getByRole("heading", { name: "Place 1 Scottish" }),
    ).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Reset Turn" }));
    await user.click(screen.getByRole("button", { name: "Pass" }));
    expect(step()).toContain("End turn");
  });

  it("forecasts the next struggle on the map and when a pass would trigger it", async () => {
    const user = userEvent.setup();
    const base = setupSession(2);
    const next = base.state.regionCards.find((card) => card.faceUp)!.regionId;
    const session = pass(withBoard(base, { [next]: followers(0, 2, 1) }));
    render(<Game initialSession={session} />);
    expect(screen.getByText(/Next struggle:/).textContent).toContain(
      "Welsh would take control",
    );

    await user.click(screen.getByRole("button", { name: "Pass" }));
    expect(
      screen.getByRole("status", { name: "Turn preview" }).textContent,
    ).toMatch(
      /resolves the next power struggle: .+ — Welsh would take control\./,
    );
  });

  it("reports regions won by each faction alongside the shared supply", () => {
    render(<Game initialSession={setupSession()} />);
    const won = screen.getByRole("group", {
      name: "Regions controlled by faction",
    });
    expect(
      within(won)
        .getAllByRole("img")
        .map((count) => count.getAttribute("aria-label")),
    ).toEqual(["Scottish 0", "Welsh 0", "English 0"]);
  });
});
