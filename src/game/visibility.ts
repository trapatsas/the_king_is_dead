import type {
  CardInstance,
  ControllerKind,
  FactionCounts,
  GameMode,
  GameResult,
  GameState,
  PlayerId,
  RegionCardSlot,
  RegionId,
  RegionState,
  RevealedPlot,
  SwapMemory,
  VictoryMethod,
} from "./domain";
import { IllegalTurnError } from "./errors";
import { freezeSnapshot } from "./immutable";
import { copyChoice } from "./plans";

/** What every seat can see at the table: never a hand or a buried discard. */
export interface PublicPlayerView {
  readonly id: PlayerId;
  readonly controller: ControllerKind;
  readonly court: FactionCounts;
  readonly handCount: number;
  readonly discardCount: number;
  /** Only the most recently played card is face up. */
  readonly discardTop: CardInstance | null;
  readonly negotiationDiscLocation: RegionId | null;
  readonly lastActionSequence: number | null;
}

/** The viewer's own private cards. Absent for spectators/handoff screens. */
export interface PrivateView {
  readonly playerId: PlayerId;
  readonly hand: readonly CardInstance[];
  /** A player may examine their own discard pile at any time. */
  readonly discards: readonly CardInstance[];
}

/**
 * Redacted per-seat view shared by the UI and future bot/LLM controllers.
 * Excludes other hands, buried discards, undealt Cunning cards, the seed and
 * RNG cursors (which would let a viewer recompute hidden setup deals).
 */
export interface PlayerObservation {
  readonly viewer: PlayerId | null;
  readonly mode: GameMode;
  readonly phase: GameState["phase"];
  readonly ending: VictoryMethod | null;
  readonly playerOrder: readonly PlayerId[];
  readonly startingPlayerId: PlayerId;
  readonly activePlayerId: PlayerId;
  readonly turnSequence: number;
  readonly actionSequence: number;
  readonly consecutivePasses: number;
  readonly regions: Readonly<Record<RegionId, RegionState>>;
  readonly regionCards: readonly RegionCardSlot[];
  readonly supply: FactionCounts;
  readonly controlDiscsInSupply: FactionCounts;
  readonly instabilityDiscsInFrance: number;
  readonly players: readonly PublicPlayerView[];
  /** Publicly witnessed swap; needed to see which reversals are forbidden. */
  readonly lastSwap: SwapMemory | null;
  /** Only set once Plot has been revealed at the end of the game. */
  readonly plot: RevealedPlot | null;
  readonly result: GameResult | null;
  /** Disclosed only after the game finishes, for reproducibility. */
  readonly seed: string | null;
  readonly own: PrivateView | null;
}

/**
 * Build the only state view a seat (or `null` for a public screen) may use.
 * The result is a frozen copy with no references back into the full state.
 */
export function getObservation(
  state: GameState,
  viewer: PlayerId | null,
): PlayerObservation {
  if (viewer !== null && !state.playerOrder.includes(viewer))
    throw new IllegalTurnError("Unknown observing player");
  const players = state.playerOrder.map((id): PublicPlayerView => {
    const player = state.players[id];
    if (player === undefined) throw new IllegalTurnError("Unknown player");
    return {
      id,
      controller: player.controller,
      court: player.court,
      handCount: player.hand.length,
      discardCount: player.discards.length,
      discardTop: player.discards.at(-1) ?? null,
      negotiationDiscLocation: player.negotiationDiscLocation,
      lastActionSequence: player.lastActionSequence,
    };
  });
  const viewing = viewer === null ? undefined : state.players[viewer];
  const observation: PlayerObservation = {
    viewer,
    mode: state.mode,
    phase: state.phase,
    ending: state.ending,
    playerOrder: state.playerOrder,
    startingPlayerId: state.startingPlayerId,
    activePlayerId: state.activePlayerId,
    turnSequence: state.turnSequence,
    actionSequence: state.actionSequence,
    consecutivePasses: state.consecutivePasses,
    regions: state.regions,
    regionCards: state.regionCards,
    supply: state.supply,
    controlDiscsInSupply: state.controlDiscsInSupply,
    instabilityDiscsInFrance: state.instabilityDiscsInFrance,
    players,
    lastSwap: state.lastSwap,
    plot: state.plot,
    result: state.result,
    seed: state.phase === "finished" ? state.initialSeed : null,
    own:
      viewing === undefined
        ? null
        : {
            playerId: viewing.id,
            hand: viewing.hand,
            discards: viewing.discards,
          },
  };
  return freezeSnapshot(copyChoice(observation));
}
