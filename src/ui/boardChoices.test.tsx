// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { Faction, RegionId } from "../game/domain";
import { followers, setupSession, withBoard } from "../test/turnFixtures";
import { Game } from "./App";
import { title } from "./presentation";

afterEach(cleanup);
// Enabled tokens say "Select …"; disabled ones only report the count.
const token = (region: RegionId, faction: Faction) =>
  screen.getByRole("button", {
    name: new RegExp(
      `^(?:Select ${title(faction)} follower in ${title(region)} |${title(faction)} followers in ${title(region)}:)`,
    ),
  });
const slot = (region: RegionId) =>
  screen.getByRole("button", {
    name: new RegExp(`^Slot \\d+: ${title(region)}(?:,|$)`),
  });
const disabled = (element: HTMLElement) =>
  (element as HTMLButtonElement).disabled;

describe("direct board choices", () => {
  it.each([
    ["moray", "devon"],
    ["devon", "moray"],
  ] as const)(
    "negotiates %s then %s without imposing canonical endpoint order",
    async (first, second) => {
      const initial = setupSession();
      const user = userEvent.setup();
      render(<Game initialSession={initial} />);

      await user.click(screen.getByRole("button", { name: "Play Negotiate" }));
      expect(disabled(slot(first))).toBe(false);
      await user.click(slot(first));
      expect(disabled(slot(second))).toBe(false);
      await user.click(slot(second));
      expect(
        screen.getByRole("heading", { name: "Place your negotiation disc" }),
      ).toBeDefined();
      await user.click(slot("devon"));
      expect(
        screen.getByRole("region", { name: "Summon a follower" }),
      ).toBeDefined();
      expect(
        screen.queryByRole("button", { name: "Use this effect" }),
      ).toBeNull();
      expect(
        screen.getByRole("region", { name: "Card effect" }).textContent,
      ).toContain("place your disc on Devon");
      const originalDevonSlot = initial.state.regionCards.find(
        (card) => card.regionId === "devon",
      )!.slot;
      expect(slot("moray").getAttribute("aria-label")).toContain(
        `Slot ${originalDevonSlot}: Moray`,
      );
      expect(disabled(screen.getByRole("button", { name: "End Turn" }))).toBe(
        true,
      );
      await user.click(screen.getByRole("button", { name: "Reset Turn" }));
      expect(slot("devon").getAttribute("aria-label")).toContain(
        `Slot ${originalDevonSlot}: Devon`,
      );
      expect(initial.events).toHaveLength(1);
    },
  );

  it.each([
    ["scottish", "welsh"],
    ["welsh", "scottish"],
  ] as const)(
    "selects a mixed Outmanoeuvre pair %s then %s while two Scottish are also available",
    async (first, second) => {
      const initial = withBoard(setupSession(), {
        moray: followers(0, 0, 1),
        strathclyde: followers(2, 1),
      });
      const user = userEvent.setup();
      const { container } = render(<Game initialSession={initial} />);

      await user.click(
        screen.getByRole("button", { name: "Play Outmanoeuvre" }),
      );
      await user.click(token("moray", "english"));
      expect(disabled(token("strathclyde", "scottish"))).toBe(false);
      expect(disabled(token("strathclyde", "welsh"))).toBe(false);
      await user.click(token("strathclyde", first));
      expect(token("strathclyde", first).getAttribute("aria-label")).toContain(
        "1 selected",
      );
      expect(disabled(token("strathclyde", second))).toBe(false);
      await user.click(token("strathclyde", second));
      expect(
        screen.getByRole("region", { name: "Summon a follower" }),
      ).toBeDefined();
      const effect = screen.getByRole("region", {
        name: "Card effect",
      }).textContent;
      expect(effect).toContain("Move 1 Scottish from Strathclyde to Moray");
      expect(effect).toContain("Move 1 Welsh from Strathclyde to Moray");
      expect(token("moray", "scottish").getAttribute("aria-label")).toContain(
        "1 available",
      );
      expect(
        token("strathclyde", "english").getAttribute("aria-label"),
      ).toContain("1 available");
      expect(container.querySelectorAll("button button")).toHaveLength(0);
      await user.click(token("strathclyde", "english"));
      expect(
        screen.getByRole("status", { name: "Turn preview" }).textContent,
      ).toContain("Summon 1 English from Strathclyde");
      await user.click(screen.getByRole("button", { name: "End Turn" }));
      expect(screen.getAllByRole("button", { name: /^Play / })).toHaveLength(8);
      expect(token("strathclyde", "english").getAttribute("aria-label")).toBe(
        "English followers in Strathclyde: 0",
      );
      expect(initial.events).toHaveLength(1);
    },
  );

  it("selects two followers of the same faction by clicking that token twice", async () => {
    const initial = withBoard(setupSession(), {
      moray: followers(0, 0, 1),
      strathclyde: followers(2, 1),
    });
    const user = userEvent.setup();
    render(<Game initialSession={initial} />);

    await user.click(screen.getByRole("button", { name: "Play Outmanoeuvre" }));
    await user.click(token("moray", "english"));
    await user.click(token("strathclyde", "scottish"));
    expect(disabled(token("strathclyde", "scottish"))).toBe(false);
    await user.click(token("strathclyde", "scottish"));
    expect(
      screen.getByRole("region", { name: "Card effect" }).textContent,
    ).toContain("Move 2 Scottish from Strathclyde to Moray");
    expect(
      screen.getByRole("region", { name: "Summon a follower" }),
    ).toBeDefined();
  });

  it("keeps globally deficient Outmanoeuvre targets disabled, and offers 1-for-1 only when no full swap exists", async () => {
    const initial = withBoard(setupSession(), {
      moray: followers(1),
      strathclyde: followers(0, 1),
      essex: followers(0, 0, 1),
      devon: followers(2),
    });
    const user = userEvent.setup();
    const first = render(<Game initialSession={initial} />);

    await user.click(screen.getByRole("button", { name: "Play Outmanoeuvre" }));
    expect(disabled(token("moray", "scottish"))).toBe(true);
    expect(disabled(token("strathclyde", "welsh"))).toBe(true);
    expect(disabled(token("essex", "english"))).toBe(false);
    await user.click(token("essex", "english"));
    expect(disabled(token("devon", "scottish"))).toBe(false);
    first.unmount();
    render(
      <Game
        initialSession={withBoard(setupSession(), {
          moray: followers(1),
          strathclyde: followers(0, 1),
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Play Outmanoeuvre" }));
    await user.click(token("strathclyde", "welsh"));
    await user.click(token("moray", "scottish"));
    expect(
      screen.getByRole("region", { name: "Summon a follower" }),
    ).toBeDefined();
  });

  it("starts Manoeuvre from either endpoint and keeps partial picks visible", async () => {
    const initial = withBoard(setupSession(), {
      moray: followers(1),
      devon: followers(0, 2),
    });
    const user = userEvent.setup();
    const { container } = render(<Game initialSession={initial} />);

    await user.click(screen.getByRole("button", { name: "Play Manoeuvre" }));
    await user.click(token("devon", "welsh"));
    expect(container.querySelectorAll(".follower-selected")).toHaveLength(1);
    expect(disabled(token("moray", "scottish"))).toBe(false);

    await user.click(token("moray", "scottish"));
    expect(
      screen.getByRole("region", { name: "Summon a follower" }),
    ).toBeDefined();
  });

  it("places Assemble followers via region clicks and summons directly from the resulting board", async () => {
    const user = userEvent.setup();
    render(<Game initialSession={setupSession()} />);

    await user.click(screen.getByRole("button", { name: "Play Assemble 1" }));
    for (const faction of ["Scottish", "Welsh", "English"]) {
      expect(
        screen.getByRole("heading", { name: `Place 1 ${faction}` }),
      ).toBeDefined();
      await user.click(
        screen.getByRole("button", { name: /^Moray:.*legal choice$/ }),
      );
    }
    await user.click(token("moray", "welsh"));
    expect(
      screen.getByRole("status", { name: "Turn preview" }).textContent,
    ).toContain("Summon 1 Welsh from Moray");
    expect(
      screen.queryByRole("button", { name: "Use this effect" }),
    ).toBeNull();
  });

  it("undoes a partial choice without excluding the previous alternatives", async () => {
    const user = userEvent.setup();
    render(<Game initialSession={setupSession()} />);

    await user.click(screen.getByRole("button", { name: "Play Negotiate" }));
    await user.click(slot("devon"));
    await user.click(
      screen.getByRole("button", { name: "Undo last selection" }),
    );
    expect(disabled(slot("moray"))).toBe(false);
    expect(disabled(slot("devon"))).toBe(false);
    const panel = screen.getByRole("region", { name: "Card effect" });
    expect(
      within(panel).getByRole("heading", { name: "Choose either region card" }),
    ).toBeDefined();
  });
});
