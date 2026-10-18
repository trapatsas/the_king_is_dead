import { describe, expect, it } from "vitest";
import { choosePlot } from "../app/session";
import { REGION_IDS } from "../game/domain";
import type { GameSession } from "../game/events";
import { findPlotHolder } from "../game/scoring";
import { editFixture, play } from "../test/standardFixtures";
import { followers, pass, setupSession, withBoard } from "../test/turnFixtures";
import { projectFinishedLog } from "./finishedLog";
import { title } from "./presentation";

function finishNormalPlay(session: GameSession): GameSession {
  let next = session;
  for (let guard = 0; next.state.phase === "turn" && guard < 24; guard += 1)
    next = pass(next);
  if (next.state.phase === "turn") throw new Error("Fixture did not finish");
  return next;
}

describe("finished game log projection", () => {
  it.each([2, 3])(
    "records the original %i-player follower setup rather than the final board",
    (count) => {
      const initial = setupSession(count);
      const completed = finishNormalPlay(initial);
      const before = JSON.stringify(completed);
      const entries = projectFinishedLog(completed);
      const setup = entries[0]!;
      expect(setup.heading).toBe("The kingdom is prepared");
      expect(setup.details).toContain(
        `Starting player: ${initial.state.startingPlayerId}.`,
      );
      expect(setup.details.join(" ")).toContain(
        `Seed: ${initial.state.initialSeed}`,
      );
      expect(setup.details.join(" ")).toContain(
        initial.state.playerOrder.join(" → "),
      );
      expect(setup.details.join(" ")).toContain(
        initial.state.regionCards
          .map((card) => `${card.slot}. ${title(card.regionId)}`)
          .join(" → "),
      );
      expect(setup.followers?.rows).toHaveLength(8 + count + 2);
      for (const region of REGION_IDS)
        expect(
          setup.followers?.rows.find((row) => row.label === title(region))
            ?.counts,
        ).toEqual(initial.state.regions[region].followers);
      for (const player of initial.state.playerOrder)
        expect(
          setup.followers?.rows.find((row) => row.label === `${player} court`)
            ?.counts,
        ).toEqual(initial.state.players[player]!.court);
      expect(
        setup.followers?.rows.find((row) => row.label === "Common supply")
          ?.counts,
      ).toEqual(initial.state.supply);
      expect(
        setup.followers?.rows.find((row) => row.label === "Removed to the box")
          ?.counts,
      ).toEqual(count === 2 ? followers(2, 2, 2) : followers());
      expect(entries.map((entry) => entry.sequence)).toEqual(
        completed.events.map((event) => event.eventSequence),
      );
      expect(entries.at(-1)?.label).toBe("Final result");
      expect(JSON.stringify(completed)).toBe(before);
    },
  );

  it("records committed effects in order, summons, negotiation discs, and passes", () => {
    const initial = withBoard(setupSession(), {});
    const first = play(initial, "scottish-support");
    const second = play(first, "negotiate", (options) =>
      options.find((plan) =>
        plan.operations.some(
          (op) =>
            op.kind === "swap-region-cards" &&
            op.first === "moray" &&
            op.second === "devon" &&
            op.negotiationDiscOn === "devon",
        ),
      ),
    );
    const entries = projectFinishedLog(finishNormalPlay(second));
    expect(entries[1]).toMatchObject({
      label: "Turn 1 · Action 1",
      heading: `${initial.state.activePlayerId} played Scottish Support`,
      details: [
        "Effect 1: Move 2 Scottish from supply to Strathclyde.",
        `Summon: ${initial.state.activePlayerId} took 1 Scottish from Strathclyde into their court.`,
      ],
    });
    expect(entries[2]).toMatchObject({
      label: "Turn 2 · Action 2",
      heading: `${first.state.activePlayerId} played Negotiate`,
    });
    expect(entries[2]!.details[0]).toBe(
      "Effect 1: Exchange Moray and Devon cards; place your disc on Devon.",
    );
    expect(entries[3]).toMatchObject({
      label: "Turn 3",
      heading: `${second.state.activePlayerId} passed`,
      details: ["No card played; no follower summoned."],
    });
    expect(
      entries.filter((entry) => entry.heading.includes("played")),
    ).toHaveLength(2);
  });

  it("keeps ordered transfers and a zero summon when a card cannot act", () => {
    const swap = play(setupSession(), "outmanoeuvre");
    const swapEvent = swap.events[1];
    if (swapEvent?.type !== "TurnCommitted" || swapEvent.plan.kind !== "card")
      throw new Error("Missing action");
    const details = projectFinishedLog(finishNormalPlay(swap))[1]!.details;
    expect(details.slice(0, -1).map((line) => line.split(":")[0])).toEqual(
      swapEvent.plan.effect.operations.map((_, index) => `Effect ${index + 1}`),
    );
    const empty = play(withBoard(setupSession(), {}), "manoeuvre");
    const noEffect = projectFinishedLog(finishNormalPlay(empty))[1]!;
    expect(noEffect.details).toEqual([
      "No card effect: No legal two-region follower swap",
      "Summon: zero — no followers remain in uncontrolled regions.",
    ]);
  });

  it("explains control, tied and empty struggles with their recorded follower counts", () => {
    const initial = editFixture(
      withBoard(setupSession(), {
        moray: followers(2, 1, 1),
        strathclyde: followers(1, 1),
      }),
      (state) => {
        state.regionCards = REGION_IDS.map((regionId, index) => ({
          slot: index + 1,
          regionId,
          faceUp: true,
          negotiationDiscOwner: null,
        }));
      },
    );
    const entries = projectFinishedLog(finishNormalPlay(initial));
    const controlled = entries.find(
      (entry) => entry.heading === "Power struggle 1 · Moray",
    )!;
    expect(controlled.details[0]).toContain(
      "Scottish had more followers than each other faction and gained control",
    );
    expect(controlled.followers?.rows[0]?.counts).toEqual(followers(2, 1, 1));
    expect(
      entries.find(
        (entry) => entry.heading === "Power struggle 2 · Strathclyde",
      )?.details[0],
    ).toContain("counts were tied");
    expect(
      entries.find((entry) => entry.heading === "Power struggle 3 · Lancaster")
        ?.details[0],
    ).toContain("region was empty");
    expect(entries.at(-2)?.heading).toBe("Invasion · normal play ends");
    expect(entries.at(-2)?.details[0]).toContain("third instability disc");
    expect(entries.at(-1)?.details.join(" ")).toContain(
      "Invasion court comparison:",
    );
  });

  it("waits for final Plot scoring and never includes hidden setup hands, undealt cards, or raw state", () => {
    let initial = setupSession(3, "advanced", "history-secret-0");
    for (
      let index = 1;
      !findPlotHolder(initial.state) && index < 100;
      index += 1
    )
      initial = setupSession(3, "advanced", `history-secret-${index}`);
    expect(projectFinishedLog(initial)).toEqual([]);
    const pending = finishNormalPlay(withBoard(initial, {}));
    expect(pending.state.phase).toBe("plot-choice");
    expect(projectFinishedLog(pending)).toEqual([]);
    const completed = choosePlot(pending, {
      playerId: pending.state.plot!.playerId,
      faction: "welsh",
      baseEventSequence: pending.state.eventSequence,
    });
    const entries = projectFinishedLog(completed);
    expect(entries.slice(-3).map((entry) => entry.heading)).toEqual([
      `${pending.state.plot!.playerId} revealed Plot`,
      `${pending.state.plot!.playerId} chose Welsh for Plot`,
      entries.at(-1)!.heading,
    ]);
    const text = JSON.stringify(entries);
    for (const card of [
      ...Object.values(initial.state.players).flatMap((player) => player.hand),
      ...initial.state.undealtCunningCards,
    ]) {
      expect(text).not.toContain(card.id);
      if (card.id.startsWith("cunning:") && card.type !== "plot")
        expect(text).not.toContain(title(card.type));
    }
    for (const field of [
      "hand",
      "discards",
      "undealtCunningCards",
      "rngState",
      "initialRngState",
    ])
      expect(text).not.toContain(`"${field}":`);
  });
});
