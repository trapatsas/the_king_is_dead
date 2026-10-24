// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { FACTIONS } from "../game/domain";
import { copyChoice } from "../game/plans";
import { findPlotHolder } from "../game/scoring";
import { turnEngine } from "../game/turns";
import type { EffectPlan } from "../game/turnTypes";
import { pass, setupSession, withBoard } from "../test/turnFixtures";
import { App, Game } from "./App";
import { describeEffect, projectTable, title } from "./presentation";
import {
  beginEffectChoice,
  completedEffect,
  effectDecision,
  pickEffectOption,
} from "./effectChoices";
import type { EffectChoice } from "./effectChoices";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

async function completeEffect(user: ReturnType<typeof userEvent.setup>) {
  for (let guard = 0; guard < 20; guard += 1) {
    if (screen.queryByRole("region", { name: "Summon a follower" })) return;
    const panel = screen.getByRole("region", { name: "Card effect" });
    const alternatives = within(panel)
      .getByText("Choose from a list")
      .closest("details")!;
    if (!alternatives.open)
      await user.click(within(panel).getByText("Choose from a list"));
    const button = within(panel).getAllByRole("button")[0];
    if (!button) throw new Error("No effect choice");
    await user.click(button);
  }
  throw new Error("Effect chooser did not finish");
}

describe("hotseat game UI", () => {
  it("focuses the first card immediately and advances through each turn", async () => {
    const user = userEvent.setup();
    render(<Game initialSession={setupSession()} />);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Play Scottish Support" }),
    );
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(
      document.querySelector(
        ".region-track button:not(:disabled), .map button:not(:disabled)",
      ),
    );
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(
      document.querySelector(".map .follower-eligible"),
    );
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "End Turn" }),
    );
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Play Scottish Support" }),
    );
  });

  it("restores the committed board and court when a complete preview is reset", async () => {
    const user = userEvent.setup();
    const session = setupSession();
    render(<Game initialSession={session} />);

    const courtName = `${session.state.activePlayerId} court`;
    const committedCourt = screen.getByLabelText(courtName).textContent;
    const committedRegions = screen
      .getAllByRole("button", { name: /: Uncontrolled/ })
      .map((button) => button.getAttribute("aria-label"));
    await user.click(screen.getByRole("button", { name: "Play Assemble 1" }));
    await completeEffect(user);
    await user.click(
      document.querySelector<HTMLButtonElement>(".map .follower-eligible")!,
    );
    expect(screen.getByLabelText(courtName).textContent).not.toBe(
      committedCourt,
    );
    await user.click(screen.getByRole("button", { name: "Reset Turn" }));
    expect(screen.getByLabelText(courtName).textContent).toBe(committedCourt);
    expect(
      screen
        .getAllByRole("button", { name: /: Uncontrolled/ })
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(committedRegions);
    expect(screen.queryByText(/Preview shown/)).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Play / })).toHaveLength(8);
  });

  it("shows only the active player's Cunning cards and switches hands on commit", async () => {
    const session = setupSession(3, "advanced", "ui-private-cunning");
    const viewer = session.state.activePlayerId;
    const secretCards = [
      ...session.state.playerOrder
        .filter((id) => id !== viewer)
        .flatMap((id) => session.state.players[id]!.hand),
      ...session.state.undealtCunningCards,
    ].filter((card) => card.id.startsWith("cunning:"));
    const ownCards = session.state.players[viewer]!.hand.filter((card) =>
      card.id.startsWith("cunning:"),
    );
    const user = userEvent.setup();
    render(<Game initialSession={session} />);

    for (const card of secretCards)
      expect(screen.queryByText(title(card.type), { exact: true })).toBeNull();
    for (const card of ownCards)
      expect(
        screen.getByRole("button", { name: `Play ${title(card.type)}` }),
      ).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Pass" }));
    await user.click(screen.getByRole("button", { name: "End Turn" }));
    for (const card of ownCards)
      expect(
        screen.queryByRole("button", { name: `Play ${title(card.type)}` }),
      ).toBeNull();
  });

  it("starts only configured Standard human games and supports a reproducible seed", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByLabelText("Rules"), "advanced");
    expect(
      (screen.getByRole("button", { name: /Begin game/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByRole("status").textContent).toContain(
      "Advanced cards are coming soon",
    );
    await user.selectOptions(screen.getByLabelText("Rules"), "standard");
    expect(
      within(screen.getByLabelText("Player 2 type"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Human", "Easy bot", "Medium bot", "Hard bot"]);
    await user.selectOptions(screen.getByLabelText("Players"), "2");
    await user.click(screen.getByText("Reproducible setup"));
    await user.type(screen.getByLabelText("Setup seed"), "ui-seed");
    await user.click(screen.getByRole("button", { name: /Begin game/ }));
    // The seed could be used to recompute hidden deals, so it stays hidden
    // until the game is finished.
    expect(screen.getByText(/^Standard kingdom$/)).toBeDefined();
    expect(screen.queryByText(/ui-seed/)).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Slot / })).toHaveLength(8);
    expect(screen.getAllByRole("button", { name: /^Play / })).toHaveLength(8);
  });

  it("shows cards immediately and changes to the next human hand without a curtain", async () => {
    const session = setupSession();
    const user = userEvent.setup();
    render(<Game initialSession={session} />);
    expect(screen.getAllByRole("button", { name: /^Play / })).toHaveLength(8);
    expect(screen.queryByText("Private court")).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide hand" })).toBeNull();
    const oldCard =
      session.state.players[session.state.activePlayerId]!.hand[0]!;

    const turnButton = screen.getByRole("button", { name: "Pass" });
    await user.click(turnButton);
    expect(screen.getByRole("button", { name: "End Turn" })).toBe(turnButton);
    expect(screen.queryByRole("button", { name: "Pass" })).toBeNull();
    expect(screen.queryByText("Ready to commit")).toBeNull();
    expect(
      screen.getByRole("status", { name: "Turn preview" }).textContent,
    ).toContain("Pass selected");
    await user.click(screen.getByRole("button", { name: "End Turn" }));
    expect(screen.getAllByRole("button", { name: /^Play / })).toHaveLength(8);
    expect(document.getElementById(`card-text-${oldCard.id}`)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Reveal / })).toBeNull();
    expect(screen.queryByRole("button", { name: "End Turn" })).toBeNull();
    expect(screen.getByRole("button", { name: "Pass" })).toBeDefined();
  });

  it("resets a selected card and a pass without consuming cards or changing the table", async () => {
    const user = userEvent.setup();
    const session = setupSession();
    const before = JSON.stringify(session);
    render(<Game initialSession={session} />);

    await user.click(screen.getByRole("button", { name: "Play Assemble 1" }));
    expect(screen.getByRole("region", { name: "Card effect" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Reset Turn" }));
    expect(screen.queryByRole("region", { name: "Card effect" })).toBeNull();
    expect(screen.queryByRole("button", { name: "End Turn" })).toBeNull();
    expect(screen.getByRole("button", { name: "Pass" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Pass" }));
    await user.click(screen.getByRole("button", { name: "Reset Turn" }));
    expect(
      screen.queryByRole("region", { name: "Final turn summary" }),
    ).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Play / })).toHaveLength(8);
    expect(JSON.stringify(session)).toBe(before);
  });

  it("stages legal effect choices, requires a summon, previews, and commits exactly one physical card", async () => {
    const user = userEvent.setup();
    const session = setupSession();
    const before = JSON.stringify(session);
    render(<Game initialSession={session} />);

    await user.click(screen.getByRole("button", { name: "Play Assemble 1" }));
    expect(
      screen.getAllByRole("button", { name: /, legal choice$/ }).length,
    ).toBeGreaterThan(0);
    await completeEffect(user);
    expect(
      screen.getByRole("region", { name: "Summon a follower" }),
    ).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "End Turn" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    const summon = document.querySelector<HTMLButtonElement>(
      ".map .follower-eligible",
    )!;
    await user.click(summon);
    expect(
      screen.getByRole("status", { name: "Turn preview" }).textContent,
    ).toContain("Summon 1");
    expect(
      screen.getByRole("button", { name: "End Turn" }).hasAttribute("disabled"),
    ).toBe(false);
    expect(JSON.stringify(session)).toBe(before);
    await user.click(screen.getByRole("button", { name: "End Turn" }));
    const court = screen
      .getByRole("heading", { name: session.state.activePlayerId })
      .closest("article")!;
    expect(within(court).getByText("7 cards")).toBeDefined();
    expect(within(court).getByText("Assemble")).toBeDefined();
    expect(
      screen.queryByRole("region", { name: "Final turn summary" }),
    ).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Play / })).toHaveLength(8);
    expect(screen.getByText(/TURN 2/)).toBeDefined();
  });

  it("offers explicit zero summons on an empty uncontrolled board", async () => {
    const user = userEvent.setup();
    const session = withBoard(setupSession(), {});
    render(<Game initialSession={session} />);

    await user.click(screen.getByRole("button", { name: "Play Manoeuvre" }));
    await completeEffect(user);
    expect(
      screen
        .getAllByRole("status")
        .some((status) =>
          status.textContent?.includes(
            "No followers remain; confirm zero summon",
          ),
        ),
    ).toBe(true);
    await user.click(
      screen.getByRole("button", {
        name: "Confirm zero summon — no eligible followers",
      }),
    );
    expect(
      screen.getByRole("status", { name: "Turn preview" }).textContent,
    ).toContain("No followers available to summon");
    await user.click(screen.getByRole("button", { name: "End Turn" }));
    expect(screen.getByText(/TURN 2/)).toBeDefined();
  });

  it.each([2, 3])(
    "finishes a %i-player pass game with struggle reports and a real result",
    async (count) => {
      const user = userEvent.setup();
      render(<Game initialSession={withBoard(setupSession(count), {})} />);
      for (let index = 0; index < count * 3; index += 1) {
        await user.click(screen.getByRole("button", { name: "Pass" }));
        await user.click(screen.getByRole("button", { name: "End Turn" }));
      }
      const result = screen.getByRole("region", { name: "Game result" });
      expect(screen.getByText(/kingdom · seed turn-fixture/)).toBeDefined();
      expect(result.textContent).toContain("Invasion");
      expect(result.textContent).toContain("Draw between");
      expect(
        screen.getByRole("region", { name: "Power struggle report" })
          .textContent,
      ).toContain("Struggle 3");
      expect(screen.queryByRole("button", { name: "End Turn" })).toBeNull();
      await user.click(screen.getByText("How the result was decided"));
      expect(screen.getByRole("table")).toBeDefined();
      expect(screen.queryByRole("button", { name: /^Play / })).toBeNull();
    },
  );

  it("opens the Plot choice immediately and accepts the owner's faction", async () => {
    let session = setupSession(3, "advanced", "ui-plot-0");
    for (let index = 1; !findPlotHolder(session.state); index += 1)
      session = setupSession(3, "advanced", `ui-plot-${index}`);
    session = withBoard(session, {});
    session = pass(session, 9);
    expect(session.state.phase).toBe("plot-choice");
    const user = userEvent.setup();
    render(<Game initialSession={session} />);
    expect(
      screen.getByRole("button", { name: "Support Scottish" }),
    ).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Support Scottish" }));
    expect(screen.getByRole("region", { name: "Game result" })).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Support Scottish" }),
    ).toBeNull();
  });

  it("cancels leaving a game, then returns safely to fresh setup", async () => {
    const user = userEvent.setup();
    render(<App initialSession={setupSession()} />);
    await user.click(screen.getByRole("button", { name: "New game" }));
    await user.click(screen.getByRole("button", { name: "Keep playing" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Play Scottish Support" }),
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: "New game" }));
    await user.click(screen.getByRole("button", { name: "Leave game" }));
    expect(screen.getByRole("button", { name: /Begin game/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Play / })).toBeNull();
  });

  it("offers a collapsible actual game log only after the final result", async () => {
    const user = userEvent.setup();
    const initial = withBoard(setupSession(2), {});
    render(<Game initialSession={pass(initial, 5)} />);
    expect(screen.queryByRole("region", { name: "Game log" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Pass" }));
    await user.click(screen.getByRole("button", { name: "Reset Turn" }));
    await user.click(screen.getByRole("button", { name: "Pass" }));
    await user.click(screen.getByRole("button", { name: "End Turn" }));
    const toggle = screen.getByRole("button", { name: "View game log" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.queryByRole("list", { name: "Recorded game events" }),
    ).toBeNull();
    toggle.focus();
    await user.keyboard("{Enter}");
    const log = screen.getByRole("list", { name: "Recorded game events" });
    expect(
      within(log).getByRole("table", { name: "Initial follower allocation" }),
    ).toBeDefined();
    expect(
      within(log).getAllByRole("heading", { name: /passed$/ }),
    ).toHaveLength(6);
    expect(
      within(log).getAllByRole("heading", { name: /^Power struggle/ }),
    ).toHaveLength(3);
    expect(
      within(log).getByRole("heading", { name: "Invasion · normal play ends" }),
    ).toBeDefined();
    expect(
      within(log).getByRole("heading", { name: "Invasion ends in a draw" }),
    ).toBeDefined();
    expect(log.textContent).not.toContain("Reset");
    expect(
      screen
        .getByRole("button", { name: "Hide game log" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    await user.keyboard("{Enter}");
    expect(
      screen.queryByRole("list", { name: "Recorded game events" }),
    ).toBeNull();
  });
});

describe("presentation privacy and legal plan wizard", () => {
  it("projects only the chosen hand and each public discard top", () => {
    const session = copyChoice(setupSession(3, "advanced"));
    const viewer = session.state.activePlayerId;
    const opponent = session.state.playerOrder.find((id) => id !== viewer)!;
    const original = session.state.players[opponent]!;
    const altered = {
      ...session.state,
      players: {
        ...session.state.players,
        [opponent]: {
          ...original,
          hand: original.hand.slice(2),
          discards: original.hand.slice(0, 2),
        },
      },
    };
    const view = projectTable(altered, viewer);
    const serialized = JSON.stringify(view);
    expect(view.hand).toEqual(altered.players[viewer]!.hand);
    expect(serialized).not.toContain(original.hand[0]!.id);
    expect(serialized).toContain(original.hand[1]!.id);
    for (const card of original.hand.slice(2))
      expect(serialized).not.toContain(card.id);
    for (const card of altered.undealtCunningCards)
      expect(serialized).not.toContain(card.id);
    expect(projectTable(altered, null).hand).toEqual([]);
  });

  it("can reach every legal Standard effect by narrowing only engine-produced candidates", () => {
    const state = setupSession().state;
    for (const card of turnEngine.getAvailableCards(
      state,
      state.activePlayerId,
    )) {
      const all = turnEngine.enumerateEffectPlans(
        state,
        state.activePlayerId,
        card.id,
      );
      const leaves: EffectPlan[] = [];
      function visit(choice: EffectChoice, depth: number) {
        expect(depth).toBeLessThan(20);
        const leaf = completedEffect(choice);
        if (leaf) {
          expect(describeEffect(leaf).length).toBeGreaterThan(0);
          leaves.push(leaf);
          return;
        }
        const decision = effectDecision(choice);
        if (!decision) throw new Error("Unreachable legal effect");
        for (const option of decision.options) {
          visit(pickEffectOption(choice, option.key), depth + 1);
        }
      }
      visit(beginEffectChoice(all), 0);
      expect(leaves.length).toBeGreaterThanOrEqual(all.length);
      expect(new Set(leaves.map((plan) => JSON.stringify(plan)))).toEqual(
        new Set(all.map((plan) => JSON.stringify(plan))),
      );
    }
    expect(FACTIONS.map(title)).toEqual(["Scottish", "Welsh", "English"]);
  });
});
