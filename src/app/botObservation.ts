import type { GameSession } from "../game/events";
import type { PublicMemory } from "../bot/observation";

/** App-side redaction. Only face-up cards accepted since this game's setup are
 * remembered. The internal GameCreated record never crosses the bot boundary.
 * Rebuilding this small memory also supports error-boundary remounts.
 */
export function witnessedCards(session: GameSession): PublicMemory {
  if (
    session.events[0]?.type !== "GameCreated" ||
    session.events.at(-1)?.eventSequence !== session.state.eventSequence ||
    session.events.some((event, index) => event.eventSequence !== index)
  )
    throw new Error(
      "Public memory requires continuous observed history from setup",
    );
  return {
    eventSequence: session.state.eventSequence,
    plays: session.events.flatMap((event) =>
      event.type === "TurnCommitted" && event.card
        ? [
            {
              playerId: event.playerId,
              card: { id: event.card.id, type: event.card.type },
            },
          ]
        : [],
    ),
  };
}
