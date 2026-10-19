/** Project rules only: independent of UI, storage, clocks, and controllers. */
export const RULES_VERSION = "project-2-3-v1";
export const STATE_SCHEMA_VERSION = 4;

export const FACTIONS = Object.freeze([
  "scottish",
  "welsh",
  "english",
] as const);
export type Faction = (typeof FACTIONS)[number];
export type FactionCounts = Readonly<Record<Faction, number>>;

export const REGION_IDS = Object.freeze([
  "moray",
  "strathclyde",
  "lancaster",
  "northumbria",
  "gwynedd",
  "warwick",
  "essex",
  "devon",
] as const);
export type RegionId = (typeof REGION_IDS)[number];
export type PlayerId = string;
export type CardId = string;
export type GameMode = "standard" | "advanced";
export const CONTROLLER_KINDS = Object.freeze([
  "human",
  "algorithmic",
  "llm",
] as const);
export type ControllerKind = (typeof CONTROLLER_KINDS)[number];

export const STANDARD_CARD_TYPES = Object.freeze([
  "scottish-support",
  "welsh-support",
  "english-support",
  "negotiate",
  "manoeuvre",
  "outmanoeuvre",
  "assemble",
] as const);
export type StandardCardType = (typeof STANDARD_CARD_TYPES)[number];
export const CUNNING_CARD_TYPES = Object.freeze([
  "spy",
  "ambush",
  "march",
  "plot",
  "aid",
  "influence",
  "dispute",
  "edict",
  "resist",
  "quell",
  "suppress",
  "muster",
] as const);
export type CunningCardType = (typeof CUNNING_CARD_TYPES)[number];
export type CardType = StandardCardType | CunningCardType;
export type PlayableCardType = Exclude<CardType, "plot">;

export interface CardInstance {
  readonly id: CardId;
  readonly type: CardType;
}

export const BOT_STRATEGIES = Object.freeze(["reference", "patient"] as const);
export type BotStrategy = (typeof BOT_STRATEGIES)[number];

export interface PlayerConfig {
  readonly id: PlayerId;
  readonly controller: ControllerKind;
  /** Public controller metadata; absent legacy seats use the reference bot. */
  readonly botStrategy?: BotStrategy;
}

/** Array order is clockwise seat order; createGame validates 2 or 3 seats. */
export interface SetupConfig {
  readonly seed: string;
  readonly mode: GameMode;
  readonly players: readonly PlayerConfig[];
}

export type RegionControl =
  | { readonly kind: "unresolved" }
  | {
      readonly kind: "faction";
      readonly faction: Faction;
      readonly struggleIndex: number;
    }
  | { readonly kind: "unstable"; readonly struggleIndex: number };

export interface RegionState {
  readonly id: RegionId;
  readonly followers: FactionCounts;
  readonly control: RegionControl;
}

export interface RegionCardSlot {
  readonly slot: number;
  readonly regionId: RegionId;
  readonly faceUp: boolean;
  /** The marker follows its region card, independently of the numbered slot. */
  readonly negotiationDiscOwner: PlayerId | null;
}

export interface PlayerState extends PlayerConfig {
  readonly court: FactionCounts;
  readonly hand: readonly CardInstance[];
  /** Chronological order: last item is the publicly visible top discard. */
  readonly discards: readonly CardInstance[];
  readonly negotiationDiscLocation: RegionId | null;
  readonly lastActionSequence: number | null;
}

export interface SwapTransfer {
  readonly from: RegionId;
  readonly to: RegionId;
  readonly faction: Faction;
  readonly count: number;
}

/** The last card action's swap, before its independent mandatory summon. */
export interface SwapMemory {
  readonly playerId: PlayerId;
  readonly actionSequence: number;
  readonly effectiveCard: "manoeuvre" | "outmanoeuvre";
  readonly transfers: readonly SwapTransfer[];
}

export type VictoryMethod = "invasion" | "coronation";
export type FactionRanking = readonly [Faction, Faction, Faction];
export interface FactionPower {
  readonly wins: number;
  readonly lastWonStruggle: number | null;
}
export interface PlotSupport {
  readonly playerId: PlayerId;
  readonly faction: Faction;
}
export interface RevealedPlot {
  readonly playerId: PlayerId;
  readonly cardId: CardId;
  readonly faction: Faction | null;
}
export type ScoringCriterion =
  | "complete-sets"
  | "leading-faction"
  | "second-faction"
  | "plot-override"
  | "latest-action"
  | "earliest-final-action";
export interface ScoringStep {
  readonly criterion: ScoringCriterion;
  readonly faction: Faction | null;
  readonly values: readonly {
    readonly playerId: PlayerId;
    readonly value: number | null;
  }[];
  readonly remaining: readonly PlayerId[];
}
export type CaseOutcome =
  | {
      readonly kind: "win";
      readonly winner: PlayerId;
      readonly criterion: ScoringCriterion;
    }
  | {
      readonly kind: "draw";
      readonly contenders: readonly PlayerId[];
      readonly reason: "tied-never-acted";
    };
export interface RankingEvaluation {
  readonly ranking: FactionRanking | null;
  readonly steps: readonly ScoringStep[];
  readonly outcome: CaseOutcome;
}
export interface PlayerScore {
  readonly playerId: PlayerId;
  readonly court: FactionCounts;
  readonly scoringCourt: FactionCounts;
  readonly completeSets: number;
  readonly lastActionSequence: number | null;
}
export interface ScoringDetails {
  readonly players: readonly PlayerScore[];
  readonly factionPower: Readonly<Record<Faction, FactionPower>>;
  readonly plot: PlotSupport | null;
  readonly cases: readonly RankingEvaluation[];
}
export type GameResult =
  | {
      readonly kind: "win";
      readonly winner: PlayerId;
      readonly method: VictoryMethod;
      readonly explanation: string;
      readonly details: ScoringDetails;
    }
  | {
      readonly kind: "draw";
      readonly contenders: readonly PlayerId[];
      readonly method: VictoryMethod;
      readonly reason: string;
      readonly details: ScoringDetails;
      readonly rankingCases?: readonly (readonly Faction[])[];
    };

/** Full internal state. Never use this as an opponent observation or UI model. */
export interface GameState {
  readonly schemaVersion: typeof STATE_SCHEMA_VERSION;
  readonly rulesVersion: typeof RULES_VERSION;
  readonly mode: GameMode;
  readonly initialSeed: string;
  readonly initialRngState: RngState;
  readonly rngState: RngState;
  readonly playerOrder: readonly PlayerId[];
  readonly startingPlayerId: PlayerId;
  readonly activePlayerId: PlayerId;
  readonly players: Readonly<Record<PlayerId, PlayerState>>;
  readonly regions: Readonly<Record<RegionId, RegionState>>;
  readonly regionCards: readonly RegionCardSlot[];
  readonly supply: FactionCounts;
  readonly removedFromGame: FactionCounts;
  readonly controlDiscsInSupply: FactionCounts;
  readonly instabilityDiscsInFrance: number;
  /** Returned to the box in Advanced setup; private engine data. */
  readonly undealtCunningCards: readonly CardInstance[];
  readonly consecutivePasses: number;
  readonly turnSequence: number;
  readonly actionSequence: number;
  readonly lastSwap: SwapMemory | null;
  /** Sequence of the last accepted event, including struggles/end triggers. */
  readonly eventSequence: number;
  readonly phase: "turn" | "scoring" | "plot-choice" | "finished";
  /** Ends normal play immediately, independently of later winner selection. */
  readonly ending: VictoryMethod | null;
  readonly plot: RevealedPlot | null;
  readonly result: GameResult | null;
}

/** Serializable, versioned RNG cursor. Advancing it returns a new value. */
export interface RngState {
  readonly algorithm: "mulberry32-v1";
  readonly seed: string;
  readonly state: number;
  readonly draws: number;
}

export function emptyFactionCounts(): Record<Faction, number> {
  return { scottish: 0, welsh: 0, english: 0 };
}

export function totalFollowers(counts: FactionCounts): number {
  return FACTIONS.reduce((total, faction) => total + counts[faction], 0);
}
