import { FACTIONS, REGION_IDS, STANDARD_CARD_TYPES } from "../../game/domain";
import type { GameState } from "../../game/domain";

export const FEATURE_VERSION = "standard-v1";
export const FEATURE_COUNT = 474;
export const FEATURE_SCHEMA = {
  version: FEATURE_VERSION,
  count: FEATURE_COUNT,
  dtype: "float32-le",
  regions: REGION_IDS,
  factions: FACTIONS,
  cardTypes: STANDARD_CARD_TYPES,
  groups: [
    { name: "regions", offset: 0, count: 176, stride: 22 },
    { name: "seats", offset: 176, count: 75, stride: 25 },
    { name: "global", offset: 251, count: 24 },
    { name: "swap", offset: 275, count: 199 },
  ],
} as const;
export interface EncodedPosition {
  readonly features: Float32Array;
  readonly canonicalToPlayer: readonly [number, number, number];
  readonly present: readonly [boolean, boolean, boolean];
}

/** The caller supplies a public-memory reconstruction or its simulated successor.
 * No setup seed, RNG, player name, controller or result enters this vector. */
export function encodePosition(state: GameState): EncodedPosition {
  if (state.mode !== "standard" || state.phase !== "turn" || state.result)
    throw new Error("ML features require a nonterminal Standard position");
  const count = state.playerOrder.length;
  if (count !== 2 && count !== 3) throw new Error("Unsupported seat count");
  const active = state.playerOrder.indexOf(state.activePlayerId);
  if (active < 0) throw new Error("Missing active player");
  const order = Array.from({ length: count }, (_, i) => (active + i) % count);
  const ids = order.map((i) => state.playerOrder[i]!);
  const frame: [number, number, number] = [
    order[0]!,
    order[1]!,
    order[2] ?? -1,
  ];
  const vector = new Float32Array(FEATURE_COUNT);
  let at = 0;
  const put = (value: number) => {
    if (!Number.isFinite(value) || Math.abs(value) > 1.000001)
      throw new Error(`Invalid feature at ${at}`);
    vector[at++] = value;
  };
  const hot = (size: number, index: number) => {
    if (!Number.isInteger(index) || index < 0 || index >= size)
      throw new Error("Invalid feature category");
    for (let i = 0; i < size; i++) put(Number(i === index));
  };
  for (const id of REGION_IDS) {
    const region = state.regions[id];
    const card = state.regionCards.find((c) => c.regionId === id);
    if (!card) throw new Error("Missing region track slot");
    for (const f of FACTIONS) put(region.followers[f] / 18);
    hot(
      5,
      region.control.kind === "unresolved"
        ? 0
        : region.control.kind === "unstable"
          ? 4
          : FACTIONS.indexOf(region.control.faction) + 1,
    );
    put(
      region.control.kind === "faction" ? region.control.struggleIndex / 8 : 0,
    );
    hot(8, card.slot - 1);
    put(Number(card.faceUp));
    hot(
      4,
      card.negotiationDiscOwner === null
        ? 0
        : ids.indexOf(card.negotiationDiscOwner) + 1,
    );
  }
  for (let seat = 0; seat < 3; seat++) {
    const id = ids[seat];
    if (id === undefined) {
      at += 25;
      continue;
    }
    const p = state.players[id]!;
    put(1);
    for (const f of FACTIONS) put(p.court[f] / 18);
    for (const type of STANDARD_CARD_TYPES)
      put(
        p.hand.filter((c) => c.type === type).length /
          (type === "assemble" ? 2 : 1),
      );
    put(p.hand.length / 8);
    hot(
      9,
      p.negotiationDiscLocation === null
        ? 0
        : REGION_IDS.indexOf(p.negotiationDiscLocation) + 1,
    );
    put(Number(p.lastActionSequence !== null));
    put((p.lastActionSequence ?? 0) / 24);
    put(
      p.lastActionSequence === null
        ? 0
        : (state.actionSequence - p.lastActionSequence) / 24,
    );
    const others = ids
      .filter((other) => other !== id)
      .map((other) => state.players[other]!.hand.length);
    put((p.hand.length - Math.max(...others)) / 8);
  }
  for (const f of FACTIONS) put(state.supply[f] / 18);
  for (const f of FACTIONS) put(state.controlDiscsInSupply[f] / 8);
  put(state.instabilityDiscsInFrance / 3);
  put(state.consecutivePasses / 3);
  hot(2, count - 2);
  const slots = state.regionCards.filter((c) => c.faceUp).map((c) => c.slot);
  hot(9, slots.length ? Math.min(...slots) : 0);
  hot(3, ids.indexOf(state.startingPlayerId));
  put(state.turnSequence / 96);
  put(state.actionSequence / 24);
  if (state.lastSwap) {
    const swap = state.lastSwap;
    put(1);
    hot(3, ids.indexOf(swap.playerId));
    hot(2, swap.effectiveCard === "manoeuvre" ? 0 : 1);
    put((state.actionSequence - swap.actionSequence) / 24);
    const transfers = new Float32Array(192);
    for (const t of swap.transfers) {
      const index =
        (REGION_IDS.indexOf(t.from) * 8 + REGION_IDS.indexOf(t.to)) * 3 +
        FACTIONS.indexOf(t.faction);
      transfers[index] = transfers[index]! + t.count;
    }
    for (const value of transfers) put(value / 3);
  } else at += 199;
  if (at !== FEATURE_COUNT) throw new Error(`Feature layout mismatch: ${at}`);
  return {
    features: vector,
    canonicalToPlayer: frame,
    present: [true, true, count === 3],
  };
}

export function restoreValues(
  values: readonly number[],
  encoded: EncodedPosition,
): number[] {
  const out = encoded.present[2] ? [0, 0, 0] : [0, 0];
  encoded.canonicalToPlayer.forEach((seat, i) => {
    if (seat >= 0) out[seat] = values[i]!;
  });
  return out;
}
