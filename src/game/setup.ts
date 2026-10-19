import { createHomeRegions } from "./board";
import { dealHands } from "./cards";
import {
  CONTROLLER_KINDS,
  BOT_STRATEGIES,
  FACTIONS,
  REGION_IDS,
  RULES_VERSION,
  STATE_SCHEMA_VERSION,
  emptyFactionCounts,
  totalFollowers,
} from "./domain";
import type {
  Faction,
  GameState,
  PlayerState,
  RegionId,
  RegionState,
  RngState,
  SetupConfig,
} from "./domain";
import type { SetupResult } from "./events";
import { freezeSnapshot } from "./immutable";
import { assertGameInvariants } from "./invariants";
import { assertRngState, createRng, randomInt, shuffle } from "./rng";

function validateConfig(config: SetupConfig): void {
  if (config.mode !== "standard" && config.mode !== "advanced") {
    throw new Error("Setup mode must be standard or advanced");
  }
  if (typeof config.seed !== "string") throw new Error("Seed must be a string");
  if (config.players.length !== 2 && config.players.length !== 3) {
    throw new Error("Setup requires exactly 2 or 3 players");
  }
  const ids = new Set<string>();
  for (const player of config.players) {
    if (typeof player.id !== "string" || player.id.trim().length === 0) {
      throw new Error("Player IDs must be nonempty strings");
    }
    if (ids.has(player.id)) throw new Error("Player IDs must be unique");
    ids.add(player.id);
    if (!CONTROLLER_KINDS.includes(player.controller)) {
      throw new Error("Unknown player controller kind");
    }
    if (
      player.botStrategy !== undefined &&
      (player.controller !== "algorithmic" ||
        !BOT_STRATEGIES.includes(player.botStrategy))
    )
      throw new Error("Invalid bot strategy");
  }
}

/**
 * Resolve every setup random choice once. Inputs are never mutated or frozen.
 * The event stores the explicit accepted state, including private setup data.
 */
export function createGame(
  config: SetupConfig,
  initialRng: RngState = createRng(config.seed),
): SetupResult {
  validateConfig(config);
  assertRngState(initialRng);
  if (initialRng.seed !== config.seed) {
    throw new Error("Injected RNG seed must match the setup seed");
  }
  const playerOrder = config.players.map((player) => player.id);
  const removedPerFaction = playerOrder.length === 2 ? 2 : 0;
  // The six home followers are allocated before the remaining bag is shuffled.
  const homeRegions = createHomeRegions();
  const bag: Faction[] = FACTIONS.flatMap((faction) =>
    Array.from({ length: 18 - removedPerFaction - 2 }, () => faction),
  );
  const shuffledBag = shuffle(bag, initialRng);
  const remaining = shuffledBag.values;
  const draw = (): Faction => {
    const follower = remaining.pop();
    if (follower === undefined)
      throw new Error("Setup bag unexpectedly exhausted");
    return follower;
  };
  const courts = Object.fromEntries(
    playerOrder.map((id) => {
      const court = emptyFactionCounts();
      court[draw()] += 1;
      court[draw()] += 1;
      return [id, court];
    }),
  );
  const regions = Object.fromEntries(
    REGION_IDS.map((id) => {
      const followers = { ...homeRegions[id].followers };
      while (totalFollowers(followers) < 4) followers[draw()] += 1;
      return [id, { id, followers, control: { kind: "unresolved" } }];
    }),
  ) as Record<RegionId, RegionState>;
  const supply = emptyFactionCounts();
  for (const follower of remaining) supply[follower] += 1;

  const cards = dealHands(config.mode, playerOrder, shuffledBag.rng);
  const regionOrder = shuffle(REGION_IDS, cards.rng);
  const firstSeat = randomInt(regionOrder.rng, playerOrder.length);
  const startingPlayerId = playerOrder[firstSeat.value];
  if (startingPlayerId === undefined) throw new Error("Invalid starting seat");
  const players = Object.fromEntries(
    config.players.map((player): [string, PlayerState] => {
      const court = courts[player.id];
      const hand = cards.hands[player.id];
      if (court === undefined || hand === undefined) {
        throw new Error("Missing setup court or hand");
      }
      return [
        player.id,
        {
          ...player,
          court,
          hand,
          discards: [],
          negotiationDiscLocation: null,
          lastActionSequence: null,
        },
      ];
    }),
  );
  const state: GameState = {
    schemaVersion: STATE_SCHEMA_VERSION,
    rulesVersion: RULES_VERSION,
    mode: config.mode,
    initialSeed: config.seed,
    initialRngState: { ...initialRng },
    rngState: firstSeat.rng,
    playerOrder,
    startingPlayerId,
    activePlayerId: startingPlayerId,
    players,
    regions,
    regionCards: regionOrder.values.map((regionId, index) => ({
      slot: index + 1,
      regionId,
      faceUp: true,
      negotiationDiscOwner: null,
    })),
    supply,
    removedFromGame: {
      scottish: removedPerFaction,
      welsh: removedPerFaction,
      english: removedPerFaction,
    },
    controlDiscsInSupply: { scottish: 8, welsh: 8, english: 8 },
    instabilityDiscsInFrance: 3,
    undealtCunningCards: cards.undealtCunningCards,
    consecutivePasses: 0,
    turnSequence: 0,
    actionSequence: 0,
    lastSwap: null,
    eventSequence: 0,
    phase: "turn",
    ending: null,
    plot: null,
    result: null,
  };
  assertGameInvariants(state);
  return freezeSnapshot({
    state,
    events: [
      {
        type: "GameCreated",
        eventSequence: 0,
        turnSequence: 0,
        actionSequence: 0,
        rulesVersion: RULES_VERSION,
        config: {
          seed: config.seed,
          mode: config.mode,
          players: config.players.map((player) => ({ ...player })),
        },
        initialRngState: { ...initialRng },
        state,
      },
    ],
  });
}
