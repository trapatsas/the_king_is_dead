import { describe, expect, it } from "vitest";
import { FACTIONS, emptyFactionCounts } from "./domain";
import type { GameMode, GameState, RegionCardSlot } from "./domain";
import { GameInvariantError, assertGameInvariants } from "./invariants";
import { createGame } from "./setup";

type Mutable<T> = T extends object
  ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;

function fixture(mode: GameMode = "advanced"): Mutable<GameState> {
  return JSON.parse(
    JSON.stringify(
      createGame({
        seed: "invariant-fixture",
        mode,
        players: [
          { id: "p1", controller: "human" },
          { id: "p2", controller: "algorithmic" },
          { id: "p3", controller: "human" },
        ],
      }).state,
    ),
  );
}

function firstCard(state: Mutable<GameState>): Mutable<RegionCardSlot> {
  const card = state.regionCards[0];
  if (card === undefined) throw new Error("Invalid test fixture");
  return card;
}

const mutations: readonly {
  label: string;
  change: (state: Mutable<GameState>) => void;
  reason: string;
}[] = [
  {
    label: "invented follower",
    change: (s) => {
      s.supply.english += 1;
    },
    reason: "follower conservation",
  },
  {
    label: "negative count",
    change: (s) => {
      s.supply.welsh = -1;
    },
    reason: "non-negative safe integer",
  },
  {
    label: "fractional count",
    change: (s) => {
      s.regions.devon.followers.english = 0.5;
    },
    reason: "non-negative safe integer",
  },
  {
    label: "NaN count",
    change: (s) => {
      s.supply.scottish = NaN;
    },
    reason: "non-negative safe integer",
  },
  {
    label: "wrong removed pool",
    change: (s) => {
      s.removedFromGame.english = 2;
    },
    reason: "Removed-to-box",
  },
  {
    label: "duplicate card ID",
    change: (s) => {
      const hand = s.players.p1?.hand;
      if (!hand?.[0] || !hand[1]) throw new Error("fixture");
      hand[1].id = hand[0].id;
    },
    reason: "Duplicate card ID",
  },
  {
    label: "missing physical card",
    change: (s) => {
      s.players.p1?.hand.pop();
    },
    reason: "eight physical cards",
  },
  {
    label: "changed Cunning card type",
    change: (s) => {
      const card = s.players.p1?.hand[5];
      if (!card) throw new Error("fixture");
      card.type = card.type === "spy" ? "march" : "spy";
    },
    reason: "Missing or changed unique Cunning card",
  },
  {
    label: "dealt Plot",
    change: (s) => {
      const player = s.players.p1;
      if (!player) throw new Error("fixture");
      const card = player.hand.pop();
      if (!card) throw new Error("fixture");
      player.discards.push({ ...card, type: "plot" });
    },
    reason: "Plot cannot be played",
  },
  {
    label: "missing undealt card",
    change: (s) => {
      s.undealtCunningCards.pop();
    },
    reason: "Undealt Cunning card count",
  },
  {
    label: "duplicate region card",
    change: (s) => {
      const card = s.regionCards[1];
      if (!card) throw new Error("fixture");
      card.regionId = firstCard(s).regionId;
    },
    reason: "permutation",
  },
  {
    label: "wrong slot number",
    change: (s) => {
      firstCard(s).slot = 2;
    },
    reason: "slot ordering",
  },
  {
    label: "wrong region identity",
    change: (s) => {
      s.regions.moray.id = "devon";
    },
    reason: "Region identity",
  },
  {
    label: "face-down unresolved card",
    change: (s) => {
      firstCard(s).faceUp = false;
    },
    reason: "Unresolved region card",
  },
  {
    label: "followers in a resolved region",
    change: (s) => {
      const card = firstCard(s);
      card.faceUp = false;
      s.regions[card.regionId].control = {
        kind: "faction",
        faction: "scottish",
        struggleIndex: 1,
      };
    },
    reason: "Resolved region must be empty",
  },
  {
    label: "wrong personal disc location",
    change: (s) => {
      firstCard(s).negotiationDiscOwner = "p1";
    },
    reason: "disc location",
  },
  {
    label: "missing spent disc",
    change: (s) => {
      const player = s.players.p1;
      if (!player) throw new Error("fixture");
      player.negotiationDiscLocation = "moray";
    },
    reason: "Personal negotiation disc accounting",
  },
  {
    label: "duplicated personal disc",
    change: (s) => {
      const player = s.players.p1;
      const second = s.regionCards[1];
      if (!player || !second) throw new Error("fixture");
      const first = firstCard(s);
      first.negotiationDiscOwner = "p1";
      second.negotiationDiscOwner = "p1";
      player.negotiationDiscLocation = first.regionId;
    },
    reason: "Duplicated personal negotiation disc",
  },
  {
    label: "missing control disc",
    change: (s) => {
      s.controlDiscsInSupply.scottish -= 1;
    },
    reason: "control disc conservation",
  },
  {
    label: "missing instability disc",
    change: (s) => {
      s.instabilityDiscsInFrance = 2;
    },
    reason: "Instability disc conservation",
  },
  {
    label: "unknown active player",
    change: (s) => {
      s.activePlayerId = "absent";
    },
    reason: "Active player",
  },
  {
    label: "unknown starting player",
    change: (s) => {
      s.startingPlayerId = "absent";
    },
    reason: "Starting player",
  },
  {
    label: "duplicated seat",
    change: (s) => {
      s.playerOrder[1] = "p1";
    },
    reason: "Duplicate player IDs",
  },
  {
    label: "broken RNG provenance",
    change: (s) => {
      s.rngState.seed = "wrong";
    },
    reason: "RNG provenance",
  },
  {
    label: "fractional sequence",
    change: (s) => {
      s.turnSequence = 0.5;
    },
    reason: "Turn sequence",
  },
  {
    label: "action count without discard",
    change: (s) => {
      s.actionSequence = 1;
      s.turnSequence = 1;
      s.eventSequence = 1;
    },
    reason: "Action/discard count",
  },
  {
    label: "action without turn",
    change: (s) => {
      s.actionSequence = 1;
    },
    reason: "Action sequence",
  },
  {
    label: "unresolved pass streak",
    change: (s) => {
      s.consecutivePasses = 3;
    },
    reason: "Unresolved pass streak",
  },
  {
    label: "premature finished phase",
    change: (s) => {
      s.phase = "finished";
    },
    reason: "Terminal phase consistency",
  },
];

describe("game inventory and structural invariants", () => {
  it.each(mutations)("rejects $label", ({ change, reason }) => {
    const state = fixture();
    change(state);
    expect(() => assertGameInvariants(state)).toThrow(GameInvariantError);
    expect(() => assertGameInvariants(state)).toThrow(reason);
  });

  it("rejects loss of one of the two Assemble cards even when hand size stays eight", () => {
    const state = fixture("standard");
    const hand = state.players.p1?.hand;
    const secondAssemble = hand?.[7];
    if (!secondAssemble) throw new Error("Invalid fixture");
    secondAssemble.id = "substitute";
    secondAssemble.type = "negotiate";
    expect(() => assertGameInvariants(state)).toThrow("missing or changed");
  });

  it("accepts physically conserved resolved regions and a spent disc on a face-down card", () => {
    const state = fixture();
    const card = firstCard(state);
    const region = state.regions[card.regionId];
    for (const faction of FACTIONS)
      state.supply[faction] += region.followers[faction];
    region.followers = emptyFactionCounts();
    region.control = { kind: "faction", faction: "welsh", struggleIndex: 1 };
    card.faceUp = false;
    state.controlDiscsInSupply.welsh -= 1;
    card.negotiationDiscOwner = "p1";
    const owner = state.players.p1;
    if (!owner) throw new Error("Invalid fixture");
    owner.negotiationDiscLocation = card.regionId;
    expect(() => assertGameInvariants(state)).not.toThrow();
  });

  it("accepts a conserved instability region", () => {
    const state = fixture();
    const card = firstCard(state);
    const region = state.regions[card.regionId];
    for (const faction of FACTIONS)
      state.supply[faction] += region.followers[faction];
    region.followers = emptyFactionCounts();
    region.control = { kind: "unstable", struggleIndex: 1 };
    card.faceUp = false;
    state.instabilityDiscsInFrance -= 1;
    expect(() => assertGameInvariants(state)).not.toThrow();
  });
});
