import { describe, expect, it } from "vitest";
import {
  beginTurn,
  draftCard,
  draftEffect,
  draftSummon,
  resetTurn,
} from "../../app/draft";
import { endTurn } from "../../app/session";
import {
  followers,
  pass,
  setupSession,
  withBoard,
} from "../../test/turnFixtures";
import {
  cardId,
  editFixture,
  plans,
  play,
  resolvedFixture,
  summonDevon,
} from "../../test/standardFixtures";
import type { GameSession } from "../events";
import type { RegionId, SwapTransfer } from "../domain";
import type { EffectPlan } from "../turnTypes";
import { assertGameInvariants } from "../invariants";
import { createTurnEngine, turnEngine } from "../turns";
import { applyEffectOperations } from "./execute";
import { STANDARD_EFFECTS } from "./standard";
import { swapTransfers, transferSignature } from "./swaps";

const movement = (
  from: RegionId,
  to: RegionId,
  faction: SwapTransfer["faction"],
  count = 1,
): SwapTransfer => ({ from, to, faction, count });
const reverse = (transfers: readonly SwapTransfer[]): SwapTransfer[] =>
  transfers.map((transfer) => ({
    ...transfer,
    from: transfer.to,
    to: transfer.from,
  }));
const matching =
  (transfers: readonly SwapTransfer[]) =>
  (options: readonly EffectPlan[]): EffectPlan | undefined =>
    options.find(
      (plan) =>
        transferSignature(swapTransfers(plan)) === transferSignature(transfers),
    );

describe("Manoeuvre", () => {
  it("swaps any two distinct uncontrolled regions, including non-neighbours", () => {
    const { state } = withBoard(setupSession(), {
      moray: followers(1),
      devon: followers(0, 1),
    });
    const options = plans(state, "manoeuvre");
    expect(options).toHaveLength(1);
    const option = options[0];
    if (!option) throw new Error("fixture");
    expect(swapTransfers(option)).toEqual([
      movement("moray", "devon", "scottish"),
      movement("devon", "moray", "welsh"),
    ]);
    const after = applyEffectOperations(
      state,
      state.activePlayerId,
      option.operations,
    );
    expect(after.regions.moray.followers).toEqual(followers(0, 1));
    expect(after.regions.devon.followers).toEqual(followers(1));
  });

  it("offers all faction combinations exactly once", () => {
    const { state } = withBoard(setupSession(), {
      moray: followers(1, 1),
      devon: followers(0, 1, 1),
      warwick: followers(1),
    });
    const options = plans(state, "manoeuvre");
    expect(options).toHaveLength(8); // 2×2 + 2×1 + 2×1, independent of duplicate cube identities.
    expect(new Set(options.map((plan) => JSON.stringify(plan))).size).toBe(8);
  });

  it("allows same-faction swaps and keeps their two transfers even with no board delta", () => {
    const session = withBoard(setupSession(), {
      moray: followers(2),
      devon: followers(2),
    });
    const effect = plans(session.state, "manoeuvre")[0];
    if (!effect) throw new Error("fixture");
    expect(effect.kind).toBe("effect");
    expect(effect.operations).toHaveLength(2);
    expect(
      applyEffectOperations(
        session.state,
        session.state.activePlayerId,
        effect.operations,
      ).regions,
    ).toEqual(session.state.regions);
    const next = play(session, "manoeuvre");
    expect(next.state.actionSequence).toBe(1);
    expect(next.state.lastSwap?.transfers).toHaveLength(2);
    expect(next.events.at(-1)).toMatchObject({
      plan: {
        effect: { operations: effect.operations },
        summon: { kind: "follower" },
      },
    });
  });

  it("has no effect with fewer than two populated regions and never swaps within one region", () => {
    for (const board of [{}, { moray: followers(3, 2, 1) }]) {
      const { state } = withBoard(setupSession(), board);
      expect(plans(state, "manoeuvre")).toMatchObject([
        { kind: "no-effect", operations: [] },
      ]);
    }
  });

  it("never uses a resolved region as either half of the swap", () => {
    const session = resolvedFixture(
      withBoard(setupSession(), {
        moray: followers(1),
        strathclyde: followers(0, 1),
        devon: followers(0, 0, 1),
      }),
      { devon: "english" },
    );
    expect(plans(session.state, "manoeuvre")).toHaveLength(1);
    expect(
      swapTransfers(plans(session.state, "manoeuvre")[0]!).every(
        (transfer) => transfer.from !== "devon" && transfer.to !== "devon",
      ),
    ).toBe(true);
  });
});

describe("Outmanoeuvre", () => {
  it("offers a mixed pair even when two of the same faction can be returned instead", () => {
    const { state } = withBoard(setupSession(), {
      moray: followers(0, 0, 1),
      strathclyde: followers(2, 1),
    });
    const options = plans(state, "outmanoeuvre");
    expect(options).toHaveLength(2);
    expect(options.every((plan) => plan.tier === 2)).toBe(true);
    expect(
      matching([
        movement("moray", "strathclyde", "english"),
        movement("strathclyde", "moray", "scottish", 2),
      ])(options),
    ).toBeDefined();
    expect(
      matching([
        movement("moray", "strathclyde", "english"),
        movement("strathclyde", "moray", "scottish"),
        movement("strathclyde", "moray", "welsh"),
      ])(options),
    ).toBeDefined();
  });
  it("swaps one for two, retaining the mixed pair as ordered count transfers", () => {
    const { state } = withBoard(setupSession(), {
      moray: followers(0, 1),
      strathclyde: followers(1, 0, 1),
    });
    const options = plans(state, "outmanoeuvre");
    expect(options).toHaveLength(1);
    const option = options[0];
    if (!option) throw new Error("fixture");
    expect(option.tier).toBe(2);
    expect(swapTransfers(option)).toEqual([
      movement("moray", "strathclyde", "welsh"),
      movement("strathclyde", "moray", "scottish"),
      movement("strathclyde", "moray", "english"),
    ]);
    const after = applyEffectOperations(
      state,
      state.activePlayerId,
      option.operations,
    );
    expect(after.regions.moray.followers).toEqual(followers(1, 0, 1));
    expect(after.regions.strathclyde.followers).toEqual(followers(0, 1));
  });

  it("combines identical followers into count two and permits same-faction exchanges", () => {
    const { state } = withBoard(setupSession(), {
      moray: followers(1),
      strathclyde: followers(2),
    });
    const options = plans(state, "outmanoeuvre");
    expect(options).toHaveLength(1);
    const option = options[0];
    if (!option) throw new Error("fixture");
    expect(option.operations).toHaveLength(2);
    expect(swapTransfers(option)).toEqual([
      movement("moray", "strathclyde", "scottish"),
      movement("strathclyde", "moray", "scottish", 2),
    ]);
    const after = applyEffectOperations(
      state,
      state.activePlayerId,
      option.operations,
    );
    expect(after.regions.moray.followers.scottish).toBe(2);
    expect(after.regions.strathclyde.followers.scottish).toBe(1);
  });

  it("requires the full tier globally even if a deficient pair elsewhere allows only 1-for-1", () => {
    const partial = withBoard(setupSession(), {
      moray: followers(1),
      strathclyde: followers(0, 1),
    });
    const deficient = plans(partial.state, "outmanoeuvre")[0];
    const { state } = withBoard(setupSession(), {
      moray: followers(1),
      strathclyde: followers(0, 1),
      essex: followers(0, 0, 1),
      devon: followers(2),
    });
    const options = plans(state, "outmanoeuvre");
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((plan) => plan.tier === 2)).toBe(true);
    expect(
      options.every((plan) =>
        swapTransfers(plan).every((transfer) =>
          ["essex", "devon"].includes(transfer.from),
        ),
      ),
    ).toBe(true);
    if (!deficient) throw new Error("fixture");
    expect(() =>
      turnEngine.previewTurn(
        state,
        draftEffect(
          draftCard(beginTurn(state), cardId(state, "outmanoeuvre")),
          deficient,
        ),
      ),
    ).toThrow("maximum-tier");
  });

  it("falls back to 1-for-1 without counting a just-transferred cube as an original second cube", () => {
    const { state } = withBoard(setupSession(), {
      moray: followers(1),
      strathclyde: followers(1),
    });
    const options = plans(state, "outmanoeuvre");
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ kind: "effect", tier: 1 });
    expect(
      options[0]?.operations.every(
        (op) => op.kind === "transfer" && op.count === 1,
      ),
    ).toBe(true);
  });

  it.each([
    {},
    { moray: followers(1), devon: followers(2) },
    { moray: followers(3) },
  ])("has no effect without a populated bordering pair: %j", (board) => {
    expect(
      plans(withBoard(setupSession(), board).state, "outmanoeuvre"),
    ).toMatchObject([{ kind: "no-effect", tier: 0 }]);
  });

  it("does not count follower identity or pair order as different legal plans", () => {
    const { state } = withBoard(setupSession(), {
      moray: followers(2, 1),
      strathclyde: followers(1, 2, 1),
    });
    const options = plans(state, "outmanoeuvre");
    expect(
      new Set(options.map((plan) => transferSignature(swapTransfers(plan))))
        .size,
    ).toBe(options.length);
    expect(options.every((plan) => plan.tier === 2)).toBe(true);
  });
});

describe("full-reversal anti-undo", () => {
  const manTransfers = [
    movement("moray", "strathclyde", "scottish"),
    movement("strathclyde", "moray", "welsh"),
  ];
  const outTransfers = [
    movement("moray", "strathclyde", "scottish"),
    movement("strathclyde", "moray", "welsh", 2),
  ];

  it("blocks an opponent's full Manoeuvre reversal, independently of the mandatory summon", () => {
    const initial = withBoard(setupSession(), {
      moray: followers(1),
      strathclyde: followers(0, 1),
      devon: followers(0, 0, 2),
    });
    const session = play(
      initial,
      "manoeuvre",
      matching(manTransfers),
      summonDevon,
    );
    expect(session.state.lastSwap).toMatchObject({
      playerId: initial.state.activePlayerId,
      effectiveCard: "manoeuvre",
      actionSequence: 1,
      transfers: manTransfers,
    });
    expect(
      matching(reverse(manTransfers))(plans(session.state, "manoeuvre")),
    ).toBeUndefined();
    expect(
      matching([
        movement("moray", "devon", "welsh"),
        movement("devon", "moray", "english"),
      ])(plans(session.state, "manoeuvre")),
    ).toBeDefined();
    const afterPass = pass(session);
    expect(afterPass.state.lastSwap).toEqual(session.state.lastSwap);
    expect(
      matching(reverse(manTransfers))(plans(afterPass.state, "manoeuvre")),
    ).toBeUndefined();
  });

  it("does not release the restriction on draft edits or Reset Turn", () => {
    const initial = withBoard(setupSession(), {
      moray: followers(1),
      strathclyde: followers(0, 1),
      devon: followers(0, 0, 2),
    });
    const session = play(
      initial,
      "manoeuvre",
      matching(manTransfers),
      summonDevon,
    );
    const draft = draftEffect(
      draftCard(beginTurn(session.state), cardId(session.state, "assemble")),
      plans(session.state, "assemble")[0]!,
    );
    turnEngine.previewTurn(session.state, draft);
    resetTurn(session.state, draft);
    expect(
      matching(reverse(manTransfers))(plans(session.state, "manoeuvre")),
    ).toBeUndefined();
  });

  it("releases the restriction after another committed card action", () => {
    const initial = withBoard(setupSession(), {
      moray: followers(1),
      strathclyde: followers(0, 1),
      devon: followers(0, 0, 2),
    });
    let session = play(
      initial,
      "manoeuvre",
      matching(manTransfers),
      summonDevon,
    );
    session = play(
      session,
      "assemble",
      (options) =>
        options.find((plan) =>
          plan.operations.every(
            (op) =>
              op.kind === "transfer" &&
              op.to.kind === "region" &&
              op.to.regionId === "devon",
          ),
        ),
      summonDevon,
    );
    expect(session.state.lastSwap).toBeNull();
    expect(
      matching(reverse(manTransfers))(plans(session.state, "manoeuvre")),
    ).toBeDefined();
  });

  it("treats same-faction transfers as a real swap when comparing complete reversals", () => {
    const initial = withBoard(setupSession(), {
      moray: followers(2),
      strathclyde: followers(2),
      devon: followers(0, 0, 1),
    });
    const signature = [
      movement("moray", "strathclyde", "scottish"),
      movement("strathclyde", "moray", "scottish"),
    ];
    const session = play(
      initial,
      "manoeuvre",
      matching(signature),
      summonDevon,
    );
    expect(plans(session.state, "manoeuvre")).toMatchObject([
      { kind: "no-effect" },
    ]);
    const next = play(session, "manoeuvre");
    expect(next.state.lastSwap).toBeNull();
    expect(next.events.at(-1)).toMatchObject({
      plan: { effect: { kind: "no-effect" }, summon: { kind: "follower" } },
    });
  });

  it("filters forbidden full Outmanoeuvre reversals before choosing the achievable partial tier", () => {
    const initial = withBoard(setupSession(), {
      moray: followers(1),
      strathclyde: followers(0, 2),
      devon: followers(0, 0, 2),
    });
    const session = play(
      initial,
      "outmanoeuvre",
      matching(outTransfers),
      summonDevon,
    );
    const options = plans(session.state, "outmanoeuvre");
    expect(matching(reverse(outTransfers))(options)).toBeUndefined();
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ kind: "effect", tier: 1 });
    expect(
      matching([
        movement("moray", "strathclyde", "welsh"),
        movement("strathclyde", "moray", "scottish"),
      ])(options),
    ).toBeDefined();
    const passed = pass(session);
    expect(passed.state.lastSwap).toEqual(session.state.lastSwap);
    expect(
      matching(reverse(outTransfers))(plans(passed.state, "outmanoeuvre")),
    ).toBeUndefined();
  });

  it("allows a non-reversing full exchange even when it reuses previously moved followers", () => {
    const initial = withBoard(setupSession(), {
      moray: followers(1),
      strathclyde: followers(0, 2, 1),
      devon: followers(0, 0, 2),
    });
    const session = play(
      initial,
      "outmanoeuvre",
      matching(outTransfers),
      summonDevon,
    );
    const allowed = [
      movement("moray", "strathclyde", "welsh", 2),
      movement("strathclyde", "moray", "english"),
    ];
    expect(
      matching(allowed)(plans(session.state, "outmanoeuvre")),
    ).toBeDefined();
    expect(
      matching(reverse(outTransfers))(plans(session.state, "outmanoeuvre")),
    ).toBeUndefined();
  });

  it("compares transfers before summoning, allowing a smaller non-reversal after a moved follower is summoned", () => {
    const initial = withBoard(setupSession(), {
      moray: followers(1),
      strathclyde: followers(0, 2),
    });
    const session = play(
      initial,
      "outmanoeuvre",
      matching(outTransfers),
      (choices) =>
        choices.find(
          (choice) =>
            choice.kind === "follower" &&
            choice.regionId === "moray" &&
            choice.faction === "welsh",
        ),
    );
    expect(session.state.regions.moray.followers.welsh).toBe(1);
    expect(session.state.lastSwap?.transfers).toEqual(outTransfers);
    expect(plans(session.state, "outmanoeuvre")).toHaveLength(1);
    expect(plans(session.state, "outmanoeuvre")[0]).toMatchObject({
      kind: "effect",
      tier: 1,
    });
  });

  it("keeps the two swap card types separate", () => {
    const initial = withBoard(setupSession(), {
      moray: followers(1),
      strathclyde: followers(0, 1),
      devon: followers(0, 0, 2),
    });
    const session = play(
      initial,
      "manoeuvre",
      matching(manTransfers),
      summonDevon,
    );
    expect(
      matching(reverse(manTransfers))(plans(session.state, "outmanoeuvre")),
    ).toBeDefined();
  });

  it("canonicalizes transfer multisets independently of order and splitting identical counts", () => {
    expect(transferSignature(outTransfers)).toBe(
      transferSignature(
        [
          outTransfers[0]!,
          movement("strathclyde", "moray", "welsh"),
          movement("strathclyde", "moray", "welsh"),
        ].reverse(),
      ),
    );
  });

  it.each(["manoeuvre", "outmanoeuvre"] as const)(
    "records a copied %s by effective type and permits the same actor's later reversal (test-only Spy adapter)",
    (type) => {
      let initial: GameSession | undefined;
      for (let index = 0; index < 100; index += 1) {
        const candidate = setupSession(3, "advanced", `copy-${index}`);
        if (
          candidate.state.players[candidate.state.activePlayerId]?.hand.some(
            (card) => card.type === "spy",
          )
        ) {
          initial = candidate;
          break;
        }
      }
      if (!initial) throw new Error("No Spy fixture");
      initial = withBoard(initial, {
        moray: followers(1),
        strathclyde: followers(0, type === "outmanoeuvre" ? 2 : 1),
        devon: followers(0, 0, 3),
      });
      const definition = STANDARD_EFFECTS[type];
      if (!definition) throw new Error("Missing Standard definition");
      // Copies only the trusted effect for boundary testing; real Spy selection is M7.
      const engine = createTurnEngine({
        ...STANDARD_EFFECTS,
        spy: {
          enumerate: (state, playerId, card) =>
            definition.enumerate(state, playerId, card),
        },
      });
      const spy = initial.state.players[
        initial.state.activePlayerId
      ]?.hand.find((card) => card.type === "spy");
      if (!spy) throw new Error("fixture");
      const transfers = type === "manoeuvre" ? manTransfers : outTransfers;
      const copied = matching(transfers)(
        engine.enumerateEffectPlans(
          initial.state,
          initial.state.activePlayerId,
          spy.id,
        ),
      );
      if (!copied) throw new Error("fixture");
      const draft = draftEffect(
        draftCard(beginTurn(initial.state), spy.id),
        copied,
      );
      const summon = summonDevon(
        engine.previewTurn(initial.state, draft).summonChoices,
      );
      if (!summon) throw new Error("fixture");
      const session = endTurn(initial, draftSummon(draft, summon), engine);
      expect(
        session.state.players[initial.state.activePlayerId]?.discards.at(-1)
          ?.type,
      ).toBe("spy");
      expect(session.state.lastSwap?.effectiveCard).toBe(type);
      expect(
        matching(reverse(transfers))(plans(session.state, type)),
      ).toBeUndefined();
      const actorAgain = pass(session, 2);
      expect(actorAgain.state.activePlayerId).toBe(
        initial.state.activePlayerId,
      );
      expect(
        matching(reverse(transfers))(plans(actorAgain.state, type)),
      ).toBeDefined();
      assertGameInvariants(actorAgain.state);
    },
  );

  it("rejects corrupted swap records while allowing a remembered swap whose region later resolves", () => {
    const initial = withBoard(setupSession(), {
      moray: followers(1),
      strathclyde: followers(0, 1),
      devon: followers(0, 0, 2),
    });
    const session = play(
      initial,
      "manoeuvre",
      matching(manTransfers),
      summonDevon,
    );
    expect(() =>
      editFixture(session, (state) => {
        if (state.lastSwap) state.lastSwap.actionSequence += 1;
      }),
    ).toThrow("chronology");
    expect(() =>
      editFixture(session, (state) => {
        if (state.lastSwap?.transfers[0]) state.lastSwap.transfers[0].count = 2;
      }),
    ).toThrow("exchange shape");
    expect(() =>
      editFixture(session, (state) => {
        if (state.lastSwap?.transfers[0])
          state.lastSwap.transfers[0].to = state.lastSwap.transfers[0].from;
      }),
    ).toThrow("Last swap transfer");
    const afterStruggle = pass(session, 3);
    expect(afterStruggle.state.lastSwap).toEqual(session.state.lastSwap);
    assertGameInvariants(afterStruggle.state);
  });
});
