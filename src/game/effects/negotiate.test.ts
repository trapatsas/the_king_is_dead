import { describe, expect, it } from "vitest";
import { beginTurn, draftCard, draftEffect, resetTurn } from "../../app/draft";
import { endTurn } from "../../app/session";
import { followers, setupSession, withBoard } from "../../test/turnFixtures";
import {
  cardId,
  editFixture,
  plans,
  play,
  resolvedFixture,
  standardDraft,
} from "../../test/standardFixtures";
import { REGION_IDS } from "../domain";
import type { Faction, RegionId } from "../domain";
import type { EffectPlan, RegionCardSwap } from "../turnTypes";
import { assertGameInvariants } from "../invariants";
import { turnEngine } from "../turns";
import { applyRegionCardSwap } from "./regionCards";

function swapOperation(effect: EffectPlan): RegionCardSwap {
  const operation = effect.operations[0];
  if (operation?.kind !== "swap-region-cards") throw new Error("fixture");
  return operation;
}

describe("Negotiate", () => {
  it("offers each pair once with both legal choices for the owner's personal disc", () => {
    const { state } = setupSession();
    const options = plans(state, "negotiate");
    expect(options).toHaveLength(56);
    expect(new Set(options.map((plan) => JSON.stringify(plan))).size).toBe(56);
    for (const option of options) {
      const operation = swapOperation(option);
      expect([operation.first, operation.second]).toContain(
        operation.negotiationDiscOn,
      );
      expect(operation.first).not.toBe(operation.second);
    }
  });

  it("swaps positions atomically and puts the personal marker on the chosen card at its new slot", () => {
    const session = withBoard(setupSession(), { devon: followers(1) });
    const firstSlot = session.state.regionCards.find(
      (card) => card.regionId === "moray",
    )?.slot;
    const secondSlot = session.state.regionCards.find(
      (card) => card.regionId === "devon",
    )?.slot;
    const selected = plans(session.state, "negotiate").find((plan) => {
      const operation = swapOperation(plan);
      return (
        operation.first === "moray" &&
        operation.second === "devon" &&
        operation.negotiationDiscOn === "moray"
      );
    });
    if (!selected) throw new Error("fixture");
    const next = play(session, "negotiate", () => selected);
    expect(
      next.state.regionCards.find((card) => card.regionId === "moray"),
    ).toMatchObject({
      slot: secondSlot,
      negotiationDiscOwner: session.state.activePlayerId,
    });
    expect(
      next.state.regionCards.find((card) => card.regionId === "devon"),
    ).toMatchObject({ slot: firstSlot, negotiationDiscOwner: null });
    expect(
      next.state.players[session.state.activePlayerId]?.negotiationDiscLocation,
    ).toBe("moray");
    expect(next.events.at(-1)).toMatchObject({
      plan: { effect: selected, summon: { regionId: "devon" } },
    });
    assertGameInvariants(next.state);
  });

  it("excludes resolved and marked cards while retaining all eligible pairs", () => {
    let session = resolvedFixture(withBoard(setupSession(), {}), {
      moray: "scottish",
      devon: "english",
    });
    const opponent = session.state.playerOrder.find(
      (id) => id !== session.state.activePlayerId,
    );
    if (!opponent) throw new Error("fixture");
    session = editFixture(session, (state) => {
      const card = state.regionCards.find(
        (candidate) => candidate.regionId === "strathclyde",
      );
      const owner = state.players[opponent];
      if (!card || !owner) throw new Error("fixture");
      card.negotiationDiscOwner = owner.id;
      owner.negotiationDiscLocation = card.regionId;
    });
    const options = plans(session.state, "negotiate");
    expect(options).toHaveLength(20); // Five eligible cards; ten pairs, two disc choices.
    for (const option of options) {
      const operation = swapOperation(option);
      expect(
        [operation.first, operation.second].some((id) =>
          ["moray", "devon", "strathclyde"].includes(id),
        ),
      ).toBe(false);
    }
  });

  it.each([false, true])(
    "swaps without a new marker when the owner's disc is already spent (resolved marker: %s)",
    (resolved) => {
      let session = withBoard(setupSession(), { devon: followers(1) });
      if (resolved)
        session = resolvedFixture(session, { strathclyde: "scottish" });
      const actorId = session.state.activePlayerId;
      session = editFixture(session, (state) => {
        const actor = state.players[actorId];
        const card = state.regionCards.find(
          (candidate) => candidate.regionId === "strathclyde",
        );
        if (!actor || !card) throw new Error("fixture");
        actor.negotiationDiscLocation = "strathclyde";
        card.negotiationDiscOwner = actorId;
      });
      const options = plans(session.state, "negotiate");
      expect(options).toHaveLength(21);
      expect(
        options.every((plan) => swapOperation(plan).negotiationDiscOn === null),
      ).toBe(true);
      const beforeMarker = session.state.regionCards.find(
        (card) => card.regionId === "strathclyde",
      );
      const next = play(session, "negotiate");
      expect(next.state.regionCards).not.toEqual(session.state.regionCards);
      expect(
        next.state.regionCards.find((card) => card.regionId === "strathclyde"),
      ).toEqual(beforeMarker);
      expect(next.state.players[actorId]?.negotiationDiscLocation).toBe(
        "strathclyde",
      );
      expect(
        next.state.regionCards.filter(
          (card) => card.negotiationDiscOwner === actorId,
        ),
      ).toHaveLength(1);
    },
  );

  it.each([0, 1])(
    "has explicit no-effect with %i eligible cards while still summoning",
    (eligibleCount) => {
      const controls = Object.fromEntries(
        REGION_IDS.slice(0, eligibleCount === 0 ? 6 : 5).map((id) => [
          id,
          "scottish",
        ]),
      ) as Partial<Record<RegionId, Faction>>;
      let session = resolvedFixture(
        withBoard(setupSession(), { devon: followers(0, 0, 1) }),
        controls,
      );
      const opponents = session.state.playerOrder.filter(
        (id) => id !== session.state.activePlayerId,
      );
      session = editFixture(session, (state) => {
        state.regionCards
          .filter((card) => card.faceUp)
          .slice(0, 2)
          .forEach((card, index) => {
            const ownerId = opponents[index];
            const owner = ownerId ? state.players[ownerId] : undefined;
            if (!owner) throw new Error("fixture");
            card.negotiationDiscOwner = owner.id;
            owner.negotiationDiscLocation = card.regionId;
          });
      });
      expect(plans(session.state, "negotiate")).toMatchObject([
        { kind: "no-effect", tier: 0, operations: [] },
      ]);
      const next = play(session, "negotiate");
      expect(next.state.regionCards).toEqual(session.state.regionCards);
      expect(
        next.state.players[session.state.activePlayerId]
          ?.negotiationDiscLocation,
      ).toBeNull();
      expect(next.events.at(-1)).toMatchObject({
        plan: { summon: { regionId: "devon", faction: "english" } },
      });
    },
  );

  it("previews and resets the swap, marker, hand, and summon without accepting anything", () => {
    const session = setupSession();
    const before = JSON.stringify(session);
    const draft = standardDraft(session.state, "negotiate");
    const preview = turnEngine.previewTurn(session.state, draft);
    expect(preview.state.regionCards).not.toEqual(session.state.regionCards);
    expect(
      preview.state.players[session.state.activePlayerId]
        ?.negotiationDiscLocation,
    ).not.toBeNull();
    expect(resetTurn(session.state, draft)).toEqual(beginTurn(session.state));
    expect(JSON.stringify(session)).toBe(before);
    const committed = endTurn(session, draft);
    expect(
      committed.state.players[session.state.activePlayerId]?.hand,
    ).toHaveLength(7);
    expect(() => resetTurn(committed.state, draft)).toThrow("Stale");
  });

  it("rejects a forged disc target or an attempt to mark a second time", () => {
    const { state } = setupSession();
    const effect = plans(state, "negotiate")[0];
    if (!effect) throw new Error("fixture");
    const operation = swapOperation(effect);
    const third = REGION_IDS.find(
      (id) => id !== operation.first && id !== operation.second,
    );
    if (!third) throw new Error("fixture");
    const forged: EffectPlan = {
      kind: "effect",
      effectiveCard: "negotiate",
      tier: 1,
      operations: [{ ...operation, negotiationDiscOn: third }],
    };
    expect(() =>
      turnEngine.previewTurn(
        state,
        draftEffect(
          draftCard(beginTurn(state), cardId(state, "negotiate")),
          forged,
        ),
      ),
    ).toThrow("maximum-tier");
    expect(() =>
      applyRegionCardSwap(state, state.activePlayerId, {
        ...operation,
        negotiationDiscOn: null,
      }),
    ).toThrow("personal negotiation disc");
    const after = applyRegionCardSwap(state, state.activePlayerId, operation);
    expect(() =>
      applyRegionCardSwap(after, state.activePlayerId, operation),
    ).toThrow("unmarked");
  });
});
