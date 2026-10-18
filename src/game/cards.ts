import { CUNNING_CARD_TYPES } from "./domain";
import type {
  CardInstance,
  GameMode,
  PlayerId,
  RngState,
  StandardCardType,
} from "./domain";
import { shuffle } from "./rng";

export const STANDARD_HAND: readonly StandardCardType[] = Object.freeze([
  "scottish-support",
  "welsh-support",
  "english-support",
  "negotiate",
  "manoeuvre",
  "outmanoeuvre",
  "assemble",
  "assemble",
]);

export function standardCards(playerId: PlayerId): CardInstance[] {
  const copies = new Map<StandardCardType, number>();
  return STANDARD_HAND.map((type) => {
    const copy = (copies.get(type) ?? 0) + 1;
    copies.set(type, copy);
    return {
      id: `standard:${encodeURIComponent(playerId)}:${type}:${copy}`,
      type,
    };
  });
}

export function cunningDeck(): CardInstance[] {
  return CUNNING_CARD_TYPES.map((type) => ({ id: `cunning:${type}`, type }));
}

export function dealHands(
  mode: GameMode,
  playerOrder: readonly PlayerId[],
  initialRng: RngState,
): {
  readonly hands: Readonly<Record<PlayerId, readonly CardInstance[]>>;
  readonly undealtCunningCards: readonly CardInstance[];
  readonly rng: RngState;
} {
  const shuffled =
    mode === "advanced"
      ? shuffle(cunningDeck(), initialRng)
      : { values: [], rng: initialRng };
  const deck = [...shuffled.values];
  const hands = Object.fromEntries(
    playerOrder.map((playerId) => {
      const standard = standardCards(playerId);
      return [
        playerId,
        mode === "standard"
          ? standard
          : [
              ...standard.filter((card) => !card.type.endsWith("-support")),
              ...deck.splice(0, 3),
            ],
      ];
    }),
  );
  return { hands, undealtCunningCards: deck, rng: shuffled.rng };
}
