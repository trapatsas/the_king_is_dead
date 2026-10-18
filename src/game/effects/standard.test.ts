import { describe, expect, it } from "vitest";
import { beginTurn, draftCard, draftEffect } from "../../app/draft";
import { endTurn } from "../../app/session";
import { setupSession, withBoard } from "../../test/turnFixtures";
import {
  cardId,
  editFixture,
  plans,
  play,
  resolvedFixture,
  standardDraft,
  supplyFixture,
} from "../../test/standardFixtures";
import { FACTIONS, STANDARD_CARD_TYPES } from "../domain";
import type { Faction, RegionId, StandardCardType } from "../domain";
import type { EffectPlan } from "../turnTypes";
import { assertGameInvariants } from "../invariants";
import { turnEngine } from "../turns";
import { applyEffectOperations } from "./execute";

function destinations(options: readonly EffectPlan[]): RegionId[] {
  return options
    .flatMap((plan) =>
      plan.operations.flatMap((operation) =>
        operation.kind === "transfer" && operation.to.kind === "region"
          ? [operation.to.regionId]
          : [],
      ),
    )
    .sort();
}

const supportCases: readonly {
  faction: Faction;
  type: StandardCardType;
  home: RegionId;
  targets: RegionId[];
}[] = [
  {
    faction: "scottish",
    type: "scottish-support",
    home: "moray",
    targets: ["strathclyde"],
  },
  {
    faction: "welsh",
    type: "welsh-support",
    home: "gwynedd",
    targets: ["devon", "lancaster", "warwick"],
  },
  {
    faction: "english",
    type: "english-support",
    home: "essex",
    targets: ["devon", "northumbria", "warwick"],
  },
];

describe.each(supportCases)("$type", ({ faction, type, home, targets }) => {
  it("uses the unresolved home border even when that home is empty", () => {
    const { state } = withBoard(setupSession(), {});
    const options = plans(state, type);
    expect(destinations(options)).toEqual(targets);
    for (const option of options)
      expect(option).toMatchObject({
        kind: "effect",
        tier: 2,
        operations: [
          { kind: "transfer", faction, count: 2, from: { kind: "supply" } },
        ],
      });
  });

  it("places one with low supply and explicitly does nothing with zero supply", () => {
    const session = withBoard(setupSession(), {});
    const low = supplyFixture(session, { [faction]: 1 });
    expect(
      plans(low.state, type).every(
        (plan) =>
          plan.tier === 1 &&
          plan.operations.every(
            (op) => op.kind === "transfer" && op.count === 1,
          ),
      ),
    ).toBe(true);
    const empty = supplyFixture(session, { [faction]: 0 });
    expect(plans(empty.state, type)).toMatchObject([
      { kind: "no-effect", tier: 0, operations: [] },
    ]);
    const next = play(empty, type);
    expect(next.state.actionSequence).toBe(1);
    expect(next.events.at(-1)).toMatchObject({
      plan: { effect: { kind: "no-effect" }, summon: { kind: "follower" } },
    });
  });

  it("does not place into resolved target regions", () => {
    const target = targets[0];
    if (!target) throw new Error("fixture");
    const session = resolvedFixture(withBoard(setupSession(), {}), {
      [target]: "unstable",
    });
    expect(destinations(plans(session.state, type))).toEqual(
      targets.filter((id) => id !== target),
    );
  });

  it("disables the home fallback when a foreign faction or instability controls home", () => {
    const foreign = faction === "english" ? "welsh" : "english";
    for (const control of [foreign, "unstable"] as const) {
      const session = resolvedFixture(withBoard(setupSession(), {}), {
        [home]: control,
      });
      expect(plans(session.state, type)).toMatchObject([{ kind: "no-effect" }]);
    }
  });

  it("uses a faction's remote controlled region when home is lost", () => {
    const foreign = faction === "english" ? "welsh" : "english";
    const session = resolvedFixture(withBoard(setupSession(), {}), {
      [home]: foreign,
      warwick: faction,
    });
    const expected = ["devon", "essex", "gwynedd", "lancaster", "northumbria"]
      .filter((id) => id !== home)
      .sort();
    expect(destinations(plans(session.state, type))).toEqual(expected);
  });
});

describe("Assemble", () => {
  it("offers all 8^3 full placements, including grouped and split destinations", () => {
    const { state } = withBoard(setupSession(), {});
    const options = plans(state, "assemble");
    expect(options).toHaveLength(512);
    expect(new Set(options.map((plan) => JSON.stringify(plan))).size).toBe(512);
    expect(
      options.some((plan) =>
        plan.operations.every(
          (op) =>
            op.kind === "transfer" &&
            op.to.kind === "region" &&
            op.to.regionId === "devon",
        ),
      ),
    ).toBe(true);
    expect(
      options.some(
        (plan) => destinations([plan]).join("/") === "essex/gwynedd/moray",
      ),
    ).toBe(true);
    for (const option of options) {
      expect(option.tier).toBe(3);
      expect(
        option.operations.map((op) =>
          op.kind === "transfer" ? op.faction : null,
        ),
      ).toEqual(FACTIONS);
    }
  });

  it("skips only the missing faction and requires every other placement", () => {
    const { state } = supplyFixture(withBoard(setupSession(), {}), {
      welsh: 0,
    });
    const options = plans(state, "assemble");
    expect(options).toHaveLength(64);
    expect(
      options.every((plan) => plan.tier === 2 && plan.operations.length === 2),
    ).toBe(true);
    const full = options[0];
    if (!full) throw new Error("fixture");
    const forged: EffectPlan = {
      ...full,
      operations: full.operations.slice(0, 1),
      kind: "effect",
    };
    expect(() =>
      turnEngine.previewTurn(
        state,
        draftEffect(
          draftCard(beginTurn(state), cardId(state, "assemble")),
          forged,
        ),
      ),
    ).toThrow("maximum-tier");
  });

  it("places all available factions into the sole uncontrolled region", () => {
    const session = resolvedFixture(withBoard(setupSession(), {}), {
      moray: "scottish",
      strathclyde: "scottish",
      lancaster: "scottish",
      northumbria: "scottish",
      gwynedd: "scottish",
      warwick: "scottish",
      essex: "scottish",
    });
    expect(plans(session.state, "assemble")).toHaveLength(1);
    expect(destinations(plans(session.state, "assemble"))).toEqual([
      "devon",
      "devon",
      "devon",
    ]);
  });

  it("uses explicit no-effect and still summons when all three supplies are empty", () => {
    const session = supplyFixture(withBoard(setupSession(), {}), {
      scottish: 0,
      welsh: 0,
      english: 0,
    });
    expect(plans(session.state, "assemble")).toMatchObject([
      { kind: "no-effect", operations: [] },
    ]);
    expect(play(session, "assemble").events.at(-1)).toMatchObject({
      plan: { summon: { kind: "follower", count: 1 } },
    });
  });
});

describe("Standard engine registration and execution", () => {
  it("makes all eight physical Standard cards available through the production engine", () => {
    const { state } = setupSession();
    const cards = turnEngine.getAvailableCards(state, state.activePlayerId);
    expect(cards).toHaveLength(8);
    expect(new Set(cards.map((card) => card.type))).toEqual(
      new Set(STANDARD_CARD_TYPES),
    );
  });

  it("executes every enumerated initial effect without violating physical invariants", () => {
    const { state } = setupSession();
    for (const type of STANDARD_CARD_TYPES) {
      const options = plans(state, type);
      expect(options.length).toBeGreaterThan(0);
      expect(new Set(options.map((plan) => JSON.stringify(plan))).size).toBe(
        options.length,
      );
      for (const option of options) {
        assertGameInvariants(
          applyEffectOperations(state, state.activePlayerId, option.operations),
        );
      }
    }
  });

  it("commits a real Standard plan with an independently validated summon", () => {
    const session = withBoard(setupSession(), {});
    const draft = standardDraft(session.state, "scottish-support");
    const result = endTurn(session, draft);
    expect(result.state.regions.strathclyde.followers.scottish).toBe(1);
    expect(result.state.supply.scottish).toBe(
      session.state.supply.scottish - 2,
    );
    expect(
      result.state.players[session.state.activePlayerId]?.court.scottish,
    ).toBe(
      (session.state.players[session.state.activePlayerId]?.court.scottish ??
        0) + 1,
    );
    expect(result.events.at(-1)).toMatchObject({
      card: { type: "scottish-support" },
      plan: {
        effect: { effectiveCard: "scottish-support" },
        summon: { regionId: "strathclyde", faction: "scottish" },
      },
    });
  });

  it("rejects corrupted last-swap memory", () => {
    const initial = setupSession();
    expect(() =>
      editFixture(initial, (state) => {
        state.lastSwap = {
          playerId: state.activePlayerId,
          actionSequence: 0,
          effectiveCard: "manoeuvre",
          transfers: [],
        };
      }),
    ).toThrow("Last swap action chronology");
  });
});
