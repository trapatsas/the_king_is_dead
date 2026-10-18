import { describe, expect, it } from "vitest";
import { createGame } from "./setup";
import { assertGameInvariants } from "./invariants";
import {
  CUNNING_CARD_TYPES,
  FACTIONS,
  REGION_IDS,
  totalFollowers,
} from "./domain";
import type { GameMode, SetupConfig } from "./domain";
import type { SetupResult } from "./events";
import { createRng, nextUint32 } from "./rng";

function configFor(
  count: number,
  mode: GameMode = "standard",
  seed = "king-is-dead",
): SetupConfig {
  return {
    seed,
    mode,
    players: Array.from({ length: count }, (_, index) => ({
      id: `p${index + 1}`,
      controller: "human" as const,
    })),
  };
}

describe.each([2, 3])("%i-player setup", (count) => {
  describe.each(["standard", "advanced"] as const)("%s rules", (mode) => {
    it("conserves 18 followers per faction including the removed-to-box pool", () => {
      const { state } = createGame(configFor(count, mode));
      expect(state.playerOrder).toEqual(
        count === 2 ? ["p1", "p2"] : ["p1", "p2", "p3"],
      );
      expect(Object.keys(state.players)).toHaveLength(count);
      expect(totalFollowers(state.supply)).toBe(count === 2 ? 12 : 16);
      for (const faction of FACTIONS) {
        const active =
          state.supply[faction] +
          REGION_IDS.reduce(
            (sum, region) => sum + state.regions[region].followers[faction],
            0,
          ) +
          Object.values(state.players).reduce(
            (sum, player) => sum + player.court[faction],
            0,
          );
        expect(active).toBe(count === 2 ? 16 : 18);
        expect(state.removedFromGame[faction]).toBe(count === 2 ? 2 : 0);
        expect(active + state.removedFromGame[faction]).toBe(18);
      }
      for (const region of Object.values(state.regions)) {
        expect(totalFollowers(region.followers)).toBe(4);
        expect(region.control).toEqual({ kind: "unresolved" });
      }
      expect(state.regions.moray.followers.scottish).toBeGreaterThanOrEqual(2);
      expect(state.regions.gwynedd.followers.welsh).toBeGreaterThanOrEqual(2);
      expect(state.regions.essex.followers.english).toBeGreaterThanOrEqual(2);
      for (const player of Object.values(state.players))
        expect(totalFollowers(player.court)).toBe(2);
      expect(() => assertGameInvariants(state)).not.toThrow();
    });

    it("creates eight ordered face-up region slots, all discs, and an initial turn", () => {
      const { state } = createGame(configFor(count, mode));
      expect(state.regionCards.map((card) => card.slot)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8,
      ]);
      expect(state.regionCards.map((card) => card.regionId).sort()).toEqual(
        [...REGION_IDS].sort(),
      );
      expect(
        state.regionCards.every(
          (card) => card.faceUp && card.negotiationDiscOwner === null,
        ),
      ).toBe(true);
      expect(state.controlDiscsInSupply).toEqual({
        scottish: 8,
        welsh: 8,
        english: 8,
      });
      expect(state.instabilityDiscsInFrance).toBe(3);
      expect(state.phase).toBe("turn");
      expect(state.result).toBeNull();
      expect(state.consecutivePasses).toBe(0);
      expect(state.turnSequence).toBe(0);
      expect(state.actionSequence).toBe(0);
      expect(state.playerOrder).toContain(state.startingPlayerId);
      expect(state.activePlayerId).toBe(state.startingPlayerId);
      for (const player of Object.values(state.players)) {
        expect(player.negotiationDiscLocation).toBeNull();
        expect(player.discards).toEqual([]);
        expect(player.lastActionSequence).toBeNull();
      }
    });

    it("deals the exact eight-card composition with distinct physical IDs", () => {
      const { state } = createGame(configFor(count, mode));
      const allCards = Object.values(state.players).flatMap(
        (player) => player.hand,
      );
      expect(new Set(allCards.map((card) => card.id)).size).toBe(8 * count);
      for (const player of Object.values(state.players)) {
        expect(player.hand).toHaveLength(8);
        const types = player.hand.map((card) => card.type);
        expect(types.filter((type) => type === "assemble")).toHaveLength(2);
        expect(types.filter((type) => type === "negotiate")).toHaveLength(1);
        expect(types.filter((type) => type === "manoeuvre")).toHaveLength(1);
        expect(types.filter((type) => type === "outmanoeuvre")).toHaveLength(1);
        expect(types.filter((type) => type.endsWith("-support"))).toHaveLength(
          mode === "standard" ? 3 : 0,
        );
        if (mode === "standard") {
          expect([...types].sort()).toEqual(
            [
              "scottish-support",
              "welsh-support",
              "english-support",
              "negotiate",
              "manoeuvre",
              "outmanoeuvre",
              "assemble",
              "assemble",
            ].sort(),
          );
        }
      }
      if (mode === "advanced") {
        const cunning = allCards.filter((card) =>
          CUNNING_CARD_TYPES.some((type) => type === card.type),
        );
        expect(cunning).toHaveLength(3 * count);
        expect(new Set(cunning.map((card) => card.type)).size).toBe(3 * count);
        expect(state.undealtCunningCards).toHaveLength(12 - 3 * count);
        const deck = [...cunning, ...state.undealtCunningCards];
        expect(deck.map((card) => card.type).sort()).toEqual(
          [...CUNNING_CARD_TYPES].sort(),
        );
        expect(new Set(deck.map((card) => card.id)).size).toBe(12);
        expect(
          allCards.some((card) =>
            state.undealtCunningCards.some((unused) => unused.id === card.id),
          ),
        ).toBe(false);
      } else expect(state.undealtCunningCards).toEqual([]);
    });

    it("reproduces the entire setup and log for the same seed/settings", () => {
      const config = configFor(count, mode);
      const first = createGame(config);
      expect(createGame(config)).toEqual(first);
      expect(createGame({ ...config, seed: "different" })).not.toEqual(first);
      const restored: SetupResult = JSON.parse(JSON.stringify(first));
      expect(restored).toEqual(first);
      expect(restored.state.startingPlayerId).toBe(
        first.state.startingPlayerId,
      );
      expect(restored.events).toHaveLength(1);
      expect(restored.events[0]).toMatchObject({
        type: "GameCreated",
        eventSequence: 0,
        turnSequence: 0,
        actionSequence: 0,
        config,
        initialRngState: createRng(config.seed),
        state: first.state,
      });
      // Reproduction from accepted setup metadata is separate from loading it.
      expect(
        createGame(
          restored.events[0].config,
          restored.events[0].initialRngState,
        ),
      ).toEqual(first);
      expect(() => assertGameInvariants(restored.state)).not.toThrow();
    });

    it("satisfies invariants across 100 deterministic setup seeds", () => {
      const startingPlayers = new Set<string>();
      for (let index = 0; index < 100; index += 1) {
        const { state } = createGame(configFor(count, mode, `setup-${index}`));
        assertGameInvariants(state);
        startingPlayers.add(state.startingPlayerId);
      }
      // Guards against a fixed first seat without a probabilistic fairness claim.
      expect(startingPlayers.size).toBe(count);
    });
  });
});

describe("setup API boundaries", () => {
  it("rejects unsupported mode/controller values received at runtime", () => {
    const wrongMode = configFor(2);
    Reflect.set(wrongMode, "mode", "teams");
    expect(() => createGame(wrongMode)).toThrow("standard or advanced");
    const wrongController = configFor(2);
    const player = wrongController.players[0];
    if (!player) throw new Error("Invalid fixture");
    Reflect.set(player, "controller", "connected-llm");
    expect(() => createGame(wrongController)).toThrow(
      "Unknown player controller",
    );
  });

  it("accepts already frozen configuration and RNG inputs", () => {
    const config = configFor(3, "advanced");
    for (const player of config.players) Object.freeze(player);
    Object.freeze(config.players);
    Object.freeze(config);
    const rng = Object.freeze(createRng(config.seed));
    expect(() => createGame(config, rng)).not.toThrow();
  });

  it("does not mutate or freeze the caller's configuration or injected RNG", () => {
    const config = configFor(3, "advanced");
    const rng = nextUint32(createRng(config.seed)).rng;
    const before = JSON.stringify({ config, rng });
    const result = createGame(config, rng);
    expect(JSON.stringify({ config, rng })).toBe(before);
    expect(Object.isFrozen(config)).toBe(false);
    expect(Object.isFrozen(config.players[0])).toBe(false);
    expect(Object.isFrozen(rng)).toBe(false);
    expect(result.state.initialRngState).toEqual(rng);
    expect(result.state.initialRngState).not.toBe(rng);
    expect(result.events[0].config).not.toBe(config);
    expect(result.state.rngState.draws).toBeGreaterThan(rng.draws);
    expect(createGame(config, rng)).toEqual(result);
  });

  it("freezes nested committed state and the accepted setup event", () => {
    const result = createGame(configFor(3, "advanced"));
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(Object.isFrozen(result.events)).toBe(true);
    expect(Object.isFrozen(result.events[0])).toBe(true);
    expect(Object.isFrozen(result.state.regions.moray.followers)).toBe(true);
    expect(Object.isFrozen(result.state.players.p1?.hand[0])).toBe(true);
    expect(Reflect.set(result.state.supply, "english", 999)).toBe(false);
    expect(Reflect.set(result.events, 0, null)).toBe(false);
    expect(() => assertGameInvariants(result.state)).not.toThrow();
  });

  it("retains each configured controller kind without substituting an LLM", () => {
    const config: SetupConfig = {
      seed: "controllers",
      mode: "advanced",
      players: [
        { id: "human", controller: "human" },
        { id: "bot", controller: "algorithmic" },
        { id: "stub", controller: "llm" },
      ],
    };
    const { state } = createGame(config);
    expect(state.players.human?.controller).toBe("human");
    expect(state.players.bot?.controller).toBe("algorithmic");
    expect(state.players.stub?.controller).toBe("llm");
  });

  it("handles player IDs that are special JavaScript property names", () => {
    const config: SetupConfig = {
      seed: "ids",
      mode: "advanced",
      players: [
        { id: "__proto__", controller: "human" },
        { id: "constructor", controller: "human" },
      ],
    };
    const { state } = createGame(config);
    expect(Object.keys(state.players)).toEqual(["__proto__", "constructor"]);
    expect(state.players.__proto__?.id).toBe("__proto__");
    assertGameInvariants(state);
  });

  it.each([0, 1, 4, 5])("rejects unsupported player count %i", (count) => {
    expect(() => createGame(configFor(count))).toThrow("exactly 2 or 3");
  });

  it("rejects duplicate/empty IDs and mismatched injected seeds", () => {
    const config = configFor(2);
    expect(() =>
      createGame({
        ...config,
        players: [
          { id: "same", controller: "human" },
          { id: "same", controller: "human" },
        ],
      }),
    ).toThrow("unique");
    expect(() =>
      createGame({
        ...config,
        players: [
          { id: " ", controller: "human" },
          { id: "valid", controller: "human" },
        ],
      }),
    ).toThrow("nonempty");
    expect(() => createGame(config, createRng("wrong"))).toThrow(
      "seed must match",
    );
  });
});
