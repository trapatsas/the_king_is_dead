import { cunningDeck, standardCards } from "./cards";
import {
  CONTROLLER_KINDS,
  BOT_STRATEGIES,
  CUNNING_CARD_TYPES,
  FACTIONS,
  REGION_IDS,
  RULES_VERSION,
  STANDARD_CARD_TYPES,
  STATE_SCHEMA_VERSION,
  emptyFactionCounts,
  totalFollowers,
} from "./domain";
import type { CardInstance, FactionCounts, GameState } from "./domain";
import { assertRngState } from "./rng";
import { findPlotHolder, scoreGame } from "./scoring";
import { sameChoice } from "./plans";

export class GameInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameInvariantError";
  }
}

function requireInvariant(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new GameInvariantError(message);
}

function assertCounts(counts: FactionCounts, label: string): void {
  requireInvariant(
    Object.keys(counts).length === FACTIONS.length,
    `${label}: expected exactly three faction counts`,
  );
  for (const faction of FACTIONS) {
    requireInvariant(
      Number.isSafeInteger(counts[faction]) && counts[faction] >= 0,
      `${label}: ${faction} count must be a non-negative safe integer`,
    );
  }
}

function assertCounter(value: number, label: string): void {
  requireInvariant(
    Number.isSafeInteger(value) && value >= 0,
    `${label} must be a non-negative safe integer`,
  );
}

/** Structural/inventory invariants, not a substitute for move validation. */
export function assertGameInvariants(state: GameState): void {
  requireInvariant(
    state.schemaVersion === STATE_SCHEMA_VERSION,
    "Schema version",
  );
  requireInvariant(state.rulesVersion === RULES_VERSION, "Rules version");
  requireInvariant(
    state.mode === "standard" || state.mode === "advanced",
    "Game mode",
  );
  const order = state.playerOrder;
  requireInvariant(
    order.length === 2 || order.length === 3,
    "Player count: 2 or 3",
  );
  requireInvariant(
    new Set(order).size === order.length,
    "Duplicate player IDs",
  );
  requireInvariant(
    order.every((id) => typeof id === "string" && id.trim().length > 0),
    "Player IDs must be nonempty strings",
  );
  requireInvariant(
    Object.keys(state.players).length === order.length &&
      order.every((id) => Object.hasOwn(state.players, id)),
    "Player records must match seat order",
  );
  requireInvariant(order.includes(state.startingPlayerId), "Starting player");
  requireInvariant(order.includes(state.activePlayerId), "Active player");
  assertRngState(state.initialRngState);
  assertRngState(state.rngState);
  requireInvariant(
    state.initialSeed === state.initialRngState.seed &&
      state.initialSeed === state.rngState.seed &&
      state.rngState.draws >= state.initialRngState.draws,
    "RNG provenance",
  );
  assertCounter(state.turnSequence, "Turn sequence");
  assertCounter(state.actionSequence, "Action sequence");
  assertCounter(state.eventSequence, "Event sequence");
  requireInvariant(
    state.eventSequence >= state.turnSequence,
    "Event/turn sequence",
  );
  requireInvariant(
    state.actionSequence <= state.turnSequence,
    "Action sequence",
  );
  assertCounter(state.consecutivePasses, "Consecutive passes");
  requireInvariant(
    state.consecutivePasses < order.length,
    "Unresolved pass streak",
  );

  const cardsById = new Map<string, CardInstance>();
  const addCard = (card: CardInstance): void => {
    requireInvariant(
      typeof card.id === "string" && card.id.length > 0,
      "Card ID must be nonempty",
    );
    requireInvariant(
      [...STANDARD_CARD_TYPES, ...CUNNING_CARD_TYPES].some(
        (type) => type === card.type,
      ),
      "Unknown card type",
    );
    requireInvariant(!cardsById.has(card.id), `Duplicate card ID: ${card.id}`);
    cardsById.set(card.id, card);
  };
  let discardCount = 0;
  const lastActions: number[] = [];
  for (const id of order) {
    const player = state.players[id];
    requireInvariant(
      player !== undefined && player.id === id,
      "Player identity",
    );
    requireInvariant(
      CONTROLLER_KINDS.includes(player.controller),
      "Controller",
    );
    requireInvariant(
      player.botStrategy === undefined ||
        (player.controller === "algorithmic" &&
          BOT_STRATEGIES.includes(player.botStrategy)),
      "Bot strategy",
    );
    assertCounts(player.court, `Court ${id}`);
    const inventory = [...player.hand, ...player.discards];
    requireInvariant(
      inventory.length === 8,
      `Player ${id}: eight physical cards`,
    );
    inventory.forEach(addCard);
    requireInvariant(
      !player.discards.some((card) => card.type === "plot"),
      "Plot cannot be played",
    );
    const expectedStandard = standardCards(id).filter(
      (card) => state.mode === "standard" || !card.type.endsWith("-support"),
    );
    for (const expected of expectedStandard) {
      requireInvariant(
        inventory.some(
          (card) => card.id === expected.id && card.type === expected.type,
        ),
        `Player ${id}: missing or changed ${expected.id}`,
      );
    }
    const cunningCards = inventory.filter((card) =>
      CUNNING_CARD_TYPES.some((type) => type === card.type),
    );
    requireInvariant(
      cunningCards.length === (state.mode === "advanced" ? 3 : 0),
      `Player ${id}: Cunning card allocation`,
    );
    discardCount += player.discards.length;
    if (player.lastActionSequence === null) {
      requireInvariant(
        player.discards.length === 0,
        "Missing last action sequence",
      );
    } else {
      assertCounter(player.lastActionSequence, "Last action sequence");
      requireInvariant(
        player.lastActionSequence > 0 &&
          player.lastActionSequence <= state.actionSequence &&
          player.discards.length > 0,
        "Last action sequence inconsistent with played cards",
      );
      lastActions.push(player.lastActionSequence);
    }
  }
  requireInvariant(
    discardCount === state.actionSequence,
    "Action/discard count",
  );
  requireInvariant(
    new Set(lastActions).size === lastActions.length &&
      (state.actionSequence === 0 ||
        Math.max(...lastActions) === state.actionSequence),
    "Last action chronology",
  );
  if (state.lastSwap !== null) {
    const swap = state.lastSwap;
    requireInvariant(
      swap !== undefined && order.includes(swap.playerId),
      "Last swap player",
    );
    const actor = state.players[swap.playerId];
    requireInvariant(
      swap.actionSequence === state.actionSequence &&
        swap.actionSequence > 0 &&
        actor?.lastActionSequence === swap.actionSequence,
      "Last swap action chronology",
    );
    requireInvariant(
      swap.effectiveCard === "manoeuvre" ||
        swap.effectiveCard === "outmanoeuvre",
      "Last swap effective card",
    );
    const physical = actor?.discards.at(-1);
    requireInvariant(
      physical?.type === swap.effectiveCard || physical?.type === "spy",
      "Last swap physical card",
    );
    const outgoing = new Map<string, number>();
    const regions = new Set<string>();
    for (const transfer of swap.transfers) {
      requireInvariant(
        REGION_IDS.includes(transfer.from) &&
          REGION_IDS.includes(transfer.to) &&
          transfer.from !== transfer.to &&
          FACTIONS.includes(transfer.faction) &&
          Number.isSafeInteger(transfer.count) &&
          transfer.count > 0,
        "Last swap transfer",
      );
      outgoing.set(
        transfer.from,
        (outgoing.get(transfer.from) ?? 0) + transfer.count,
      );
      regions.add(transfer.from);
      regions.add(transfer.to);
    }
    const counts = [...outgoing.values()].sort((a, b) => a - b);
    requireInvariant(
      regions.size === 2 &&
        counts.length === 2 &&
        counts[0] === 1 &&
        (counts[1] === 1 ||
          (swap.effectiveCard === "outmanoeuvre" && counts[1] === 2)),
      "Last swap exchange shape",
    );
  }
  state.undealtCunningCards.forEach(addCard);
  requireInvariant(
    state.undealtCunningCards.length ===
      (state.mode === "advanced" ? 12 - 3 * order.length : 0),
    "Undealt Cunning card count",
  );
  if (state.mode === "advanced") {
    for (const expected of cunningDeck()) {
      requireInvariant(
        cardsById.get(expected.id)?.type === expected.type,
        `Missing or changed unique Cunning card: ${expected.type}`,
      );
    }
  }

  requireInvariant(
    Object.keys(state.regions).length === REGION_IDS.length &&
      REGION_IDS.every((id) => Object.hasOwn(state.regions, id)),
    "Region records must match the eight regions",
  );
  requireInvariant(state.regionCards.length === 8, "Eight region card slots");
  requireInvariant(
    new Set(state.regionCards.map((card) => card.regionId)).size === 8,
    "Region cards must form a permutation",
  );
  const factionWins = emptyFactionCounts();
  let unstable = 0;
  let unresolved = 0;
  const discOwners = new Set<string>();
  let reachedFaceUp = false;
  for (const [index, card] of state.regionCards.entries()) {
    requireInvariant(card.slot === index + 1, "Region card slot ordering");
    requireInvariant(REGION_IDS.includes(card.regionId), "Unknown region card");
    const region = state.regions[card.regionId];
    requireInvariant(region.id === card.regionId, "Region identity");
    assertCounts(region.followers, `Region ${region.id}`);
    if (region.control.kind === "unresolved") {
      unresolved += 1;
      requireInvariant(
        card.faceUp === true,
        "Unresolved region card is face up",
      );
      reachedFaceUp = true;
    } else {
      requireInvariant(
        region.control.kind === "faction" || region.control.kind === "unstable",
        "Unknown region control",
      );
      requireInvariant(
        !reachedFaceUp,
        "Resolved slots must precede unresolved slots",
      );
      requireInvariant(
        card.faceUp === false,
        "Resolved region card is face down",
      );
      requireInvariant(
        region.control.struggleIndex === card.slot,
        "Region struggle index must match slot",
      );
      requireInvariant(
        totalFollowers(region.followers) === 0,
        "Resolved region must be empty",
      );
      if (region.control.kind === "unstable") unstable += 1;
      else {
        requireInvariant(
          FACTIONS.includes(region.control.faction),
          "Control faction",
        );
        factionWins[region.control.faction] += 1;
      }
    }
    if (card.negotiationDiscOwner !== null) {
      const owner = card.negotiationDiscOwner;
      requireInvariant(order.includes(owner), "Unknown negotiation disc owner");
      requireInvariant(
        !discOwners.has(owner),
        "Duplicated personal negotiation disc",
      );
      discOwners.add(owner);
      requireInvariant(
        state.players[owner]?.negotiationDiscLocation === card.regionId,
        "Negotiation disc location must match its region card",
      );
    }
  }
  for (const id of order) {
    requireInvariant(
      (state.players[id]?.negotiationDiscLocation !== null) ===
        discOwners.has(id),
      "Personal negotiation disc accounting",
    );
  }

  assertCounts(state.supply, "Supply");
  assertCounts(state.removedFromGame, "Removed-to-box pool");
  assertCounts(state.controlDiscsInSupply, "Control disc supply");
  for (const faction of FACTIONS) {
    requireInvariant(
      state.removedFromGame[faction] === (order.length === 2 ? 2 : 0),
      `Removed-to-box ${faction} count`,
    );
    const physicalTotal =
      state.supply[faction] +
      state.removedFromGame[faction] +
      order.reduce(
        (sum, id) => sum + (state.players[id]?.court[faction] ?? 0),
        0,
      ) +
      REGION_IDS.reduce(
        (sum, id) => sum + state.regions[id].followers[faction],
        0,
      );
    requireInvariant(
      physicalTotal === 18,
      `${faction} follower conservation: ${physicalTotal}/18`,
    );
    requireInvariant(
      state.controlDiscsInSupply[faction] + factionWins[faction] === 8,
      `${faction} control disc conservation`,
    );
  }
  assertCounter(state.instabilityDiscsInFrance, "Instability discs in France");
  requireInvariant(
    state.instabilityDiscsInFrance + unstable === 3,
    "Instability disc conservation",
  );
  requireInvariant(
    ["turn", "scoring", "plot-choice", "finished"].includes(state.phase),
    "Game phase",
  );
  const terminal = unstable === 3 || unresolved === 0;
  requireInvariant(
    (state.phase !== "turn") === terminal,
    "Terminal phase consistency",
  );
  requireInvariant(
    state.ending ===
      (terminal ? (unstable === 3 ? "invasion" : "coronation") : null),
    "Ending trigger consistency",
  );
  requireInvariant(
    (state.phase === "finished") === (state.result !== null),
    "Result phase consistency",
  );
  if (state.plot !== null) {
    const holder = findPlotHolder(state);
    requireInvariant(
      terminal &&
        holder !== null &&
        holder.playerId === state.plot.playerId &&
        holder.cardId === state.plot.cardId,
      "Revealed Plot ownership",
    );
    requireInvariant(
      state.plot.faction === null || FACTIONS.includes(state.plot.faction),
      "Plot faction",
    );
    requireInvariant(
      state.phase === "plot-choice"
        ? state.plot.faction === null
        : state.phase === "finished" && state.plot.faction !== null,
      "Plot decision phase",
    );
  }
  requireInvariant(
    state.phase !== "plot-choice" || state.plot !== null,
    "Missing revealed Plot",
  );
  requireInvariant(
    state.phase !== "finished" ||
      findPlotHolder(state) === null ||
      (state.plot !== null && state.plot.faction !== null),
    "Missing finalized Plot choice",
  );
  if (state.result !== null) {
    requireInvariant(
      state.result.method === (unstable === 3 ? "invasion" : "coronation"),
      "Result method",
    );
    if (state.result.kind === "win") {
      requireInvariant(order.includes(state.result.winner), "Result winner");
      requireInvariant(state.result.explanation.length > 0, "Win explanation");
    } else {
      requireInvariant(state.result.kind === "draw", "Result kind");
      requireInvariant(
        state.result.contenders.length >= 2 &&
          new Set(state.result.contenders).size ===
            state.result.contenders.length &&
          state.result.contenders.every((id) => order.includes(id)),
        "Draw contenders",
      );
      requireInvariant(state.result.reason.length > 0, "Draw explanation");
    }
    requireInvariant(
      sameChoice(state.result, scoreGame(state)),
      "Stored result must match deterministic scoring",
    );
  }
}
