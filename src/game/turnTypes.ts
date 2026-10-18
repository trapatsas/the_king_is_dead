import type {
  CardId,
  Faction,
  GameState,
  PlayableCardType,
  PlayerId,
  RegionId,
} from "./domain";

export type FollowerLocation =
  | { readonly kind: "supply" }
  | { readonly kind: "region"; readonly regionId: RegionId };

export interface FollowerTransfer {
  readonly kind: "transfer";
  readonly from: FollowerLocation;
  readonly to: FollowerLocation;
  readonly faction: Faction;
  readonly count: number;
}

export interface RegionCardSwap {
  readonly kind: "swap-region-cards";
  readonly first: RegionId;
  readonly second: RegionId;
  /** Null means the actor's personal disc was spent on an earlier action. */
  readonly negotiationDiscOn: RegionId | null;
}

export type EffectOperation = FollowerTransfer | RegionCardSwap;

interface EffectMetadata {
  readonly effectiveCard: PlayableCardType;
  /** Global partial-action priority, determined by engine card definitions. */
  readonly tier: number;
}

export type EffectPlan = EffectMetadata &
  (
    | {
        readonly kind: "effect";
        readonly operations: readonly EffectOperation[];
      }
    | {
        readonly kind: "no-effect";
        readonly operations: readonly [];
        readonly reason: string;
      }
  );

export type SummonChoice =
  | {
      readonly kind: "follower";
      readonly count: 1;
      readonly regionId: RegionId;
      readonly faction: Faction;
    }
  | {
      readonly kind: "zero";
      readonly count: 0;
      readonly reason: "no-followers-in-uncontrolled-regions";
    };

export interface TurnContext {
  readonly playerId: PlayerId;
  readonly baseTurnSequence: number;
}

export interface PlotChoice {
  readonly playerId: PlayerId;
  readonly faction: Faction;
  readonly baseEventSequence: number;
}

export type TurnPlan = TurnContext &
  (
    | { readonly kind: "pass" }
    | {
        readonly kind: "card";
        readonly cardId: CardId;
        readonly effect: EffectPlan;
        readonly summon: SummonChoice;
      }
  );

/** Drafts never belong to the canonical game state or accepted event log. */
export interface TurnDraft extends TurnContext {
  readonly selection:
    | { readonly kind: "unselected" }
    | { readonly kind: "pass" }
    | {
        readonly kind: "card";
        readonly cardId: CardId;
        readonly effect: EffectPlan | null;
        readonly summon: SummonChoice | null;
      };
}

export interface DraftPreview {
  readonly state: GameState;
  readonly step: "choose-turn" | "choose-effect" | "choose-summon" | "ready";
  readonly effectPlans: readonly EffectPlan[];
  readonly summonChoices: readonly SummonChoice[];
  readonly plan: TurnPlan | null;
}
