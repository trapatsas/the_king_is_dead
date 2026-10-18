import type {
  CardInstance,
  FactionCounts,
  Faction,
  GameResult,
  GameState,
  PlayerId,
  RegionControl,
  RegionId,
  RngState,
  SetupConfig,
  VictoryMethod,
} from "./domain";
import type { TurnPlan } from "./turnTypes";

/** Internal accepted setup record. Contains secrets; not a public history item. */
export interface GameCreatedEvent {
  readonly type: "GameCreated";
  readonly eventSequence: 0;
  readonly turnSequence: 0;
  readonly actionSequence: 0;
  readonly rulesVersion: GameState["rulesVersion"];
  readonly config: SetupConfig;
  readonly initialRngState: RngState;
  /** Explicit accepted result: loading never reselects the starting player. */
  readonly state: GameState;
}

export interface EventMetadata {
  readonly eventSequence: number;
  readonly turnSequence: number;
  readonly actionSequence: number;
  readonly playerId: PlayerId;
}

export interface TurnCommittedEvent extends EventMetadata {
  readonly type: "TurnCommitted";
  readonly plan: TurnPlan;
  readonly card: CardInstance | null;
}

export interface PowerStruggleResolvedEvent extends EventMetadata {
  readonly type: "PowerStruggleResolved";
  readonly regionId: RegionId;
  readonly struggleIndex: number;
  readonly control: Exclude<RegionControl, { readonly kind: "unresolved" }>;
  readonly returnedToSupply: FactionCounts;
}

export interface GameEndTriggeredEvent extends EventMetadata {
  readonly type: "GameEndTriggered";
  readonly method: VictoryMethod;
  readonly regionId: RegionId;
  readonly struggleIndex: number;
}

export interface PlotRevealedEvent extends EventMetadata {
  readonly type: "PlotRevealed";
  readonly cardId: string;
}

export interface PlotChosenEvent extends EventMetadata {
  readonly type: "PlotChosen";
  readonly cardId: string;
  readonly faction: Faction;
}

export interface GameFinishedEvent extends EventMetadata {
  readonly type: "GameFinished";
  readonly result: GameResult;
}

export type AcceptedEvent =
  | GameCreatedEvent
  | TurnCommittedEvent
  | PowerStruggleResolvedEvent
  | GameEndTriggeredEvent
  | PlotRevealedEvent
  | PlotChosenEvent
  | GameFinishedEvent;

export interface GameSession {
  readonly state: GameState;
  readonly events: readonly AcceptedEvent[];
}

/** Engine event delta; the application appends it to the existing session. */
export interface CommitResult {
  readonly state: GameState;
  readonly events: readonly Exclude<AcceptedEvent, GameCreatedEvent>[];
}

export interface SetupResult {
  readonly state: GameState;
  readonly events: readonly [GameCreatedEvent];
}
