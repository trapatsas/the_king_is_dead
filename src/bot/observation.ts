import { standardCards } from "../game/cards";
import { RULES_VERSION, STATE_SCHEMA_VERSION } from "../game/domain";
import type { CardInstance, GameState, PlayerId } from "../game/domain";
import { assertGameInvariants } from "../game/invariants";
import { createRng } from "../game/rng";
import type { PlayerObservation } from "../game/visibility";

/** Only witnessed, face-up plays. No setup record, buried private log or seed. */
export interface PublicMemory {
  readonly eventSequence: number;
  readonly plays: readonly {
    readonly playerId: PlayerId;
    readonly card: CardInstance;
  }[];
}

/** Standard's common initial hand minus publicly witnessed plays is exact.
 * Dummy RNG metadata is independent of the real setup and is never advanced.
 */
export function reconstructStandard(
  observation: PlayerObservation,
  memory: PublicMemory,
): GameState {
  const o = observation;
  if (
    o.mode !== "standard" ||
    o.phase !== "turn" ||
    !o.own ||
    o.viewer !== o.activePlayerId
  )
    throw new Error("Search requires the active Standard seat's observation");
  const players = Object.fromEntries(
    o.players.map((p) => {
      const discards = memory.plays
        .filter((play) => play.playerId === p.id)
        .map((play) => play.card);
      const hand = standardCards(p.id).filter(
        (card) => !discards.some((used) => used.id === card.id),
      );
      if (
        hand.length !== p.handCount ||
        discards.length !== p.discardCount ||
        (discards.at(-1)?.id ?? null) !== (p.discardTop?.id ?? null)
      )
        throw new Error("Public card memory is incomplete");
      if (
        p.id === o.viewer &&
        (JSON.stringify(hand) !== JSON.stringify(o.own?.hand) ||
          JSON.stringify(discards) !== JSON.stringify(o.own?.discards))
      )
        throw new Error("Observed hand disagrees with public memory");
      return [
        p.id,
        {
          id: p.id,
          controller: p.controller,
          ...(p.botStrategy ? { botStrategy: p.botStrategy } : {}),
          court: p.court,
          hand,
          discards,
          negotiationDiscLocation: p.negotiationDiscLocation,
          lastActionSequence: p.lastActionSequence,
        },
      ];
    }),
  );
  const removed = o.playerOrder.length === 2 ? 2 : 0;
  const rng = createRng("bot-simulation");
  const state: GameState = {
    schemaVersion: STATE_SCHEMA_VERSION,
    rulesVersion: RULES_VERSION,
    mode: "standard",
    initialSeed: rng.seed,
    initialRngState: rng,
    rngState: rng,
    playerOrder: o.playerOrder,
    startingPlayerId: o.startingPlayerId,
    activePlayerId: o.activePlayerId,
    players,
    regions: o.regions,
    regionCards: o.regionCards,
    supply: o.supply,
    removedFromGame: { scottish: removed, welsh: removed, english: removed },
    controlDiscsInSupply: o.controlDiscsInSupply,
    instabilityDiscsInFrance: o.instabilityDiscsInFrance,
    undealtCunningCards: [],
    consecutivePasses: o.consecutivePasses,
    turnSequence: o.turnSequence,
    actionSequence: o.actionSequence,
    lastSwap: o.lastSwap,
    eventSequence: memory.eventSequence,
    phase: o.phase,
    ending: o.ending,
    plot: o.plot,
    result: o.result,
  };
  assertGameInvariants(state);
  return state;
}
