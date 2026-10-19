import { FACTIONS, REGION_IDS, totalFollowers } from "../game/domain";
import type { FactionCounts } from "../game/domain";
import type { AcceptedEvent, GameSession } from "../game/events";
import { describeOperation, title } from "./presentation";

export interface GameLogEntry {
  readonly sequence: number;
  readonly label: string;
  readonly heading: string;
  readonly details: readonly string[];
  readonly followers?: {
    readonly caption: string;
    readonly rows: readonly {
      readonly label: string;
      readonly counts: FactionCounts;
    }[];
  };
}

function projectEvent(event: AcceptedEvent, revealSeed = true): GameLogEntry {
  const sequence = event.eventSequence;
  switch (event.type) {
    case "GameCreated": {
      const { state } = event;
      return {
        sequence,
        label: "Setup",
        heading: "The kingdom is prepared",
        details: [
          `${title(state.mode)} · ${state.playerOrder.length} players${revealSeed ? ` · Seed: ${state.initialSeed}` : ""}`,
          `Clockwise seats: ${state.playerOrder.join(" → ")}.`,
          `Starting player: ${state.startingPlayerId}.`,
          `Initial struggle order: ${state.regionCards.map((card) => `${card.slot}. ${title(card.regionId)}`).join(" → ")}.`,
          `Control discs in supply: ${FACTIONS.map((faction) => `${state.controlDiscsInSupply[faction]} ${title(faction)}`).join(", ")}. Instability discs in France: ${state.instabilityDiscsInFrance}.`,
        ],
        followers: {
          caption: "Initial follower allocation",
          rows: [
            ...REGION_IDS.map((id) => ({
              label: title(id),
              counts: { ...state.regions[id].followers },
            })),
            ...state.playerOrder.map((id) => ({
              label: `${id} court`,
              counts: { ...state.players[id]!.court },
            })),
            { label: "Common supply", counts: { ...state.supply } },
            {
              label: "Removed to the box",
              counts: { ...state.removedFromGame },
            },
          ],
        },
      };
    }
    case "TurnCommitted": {
      const label = `Turn ${event.turnSequence}`;
      if (event.plan.kind === "pass")
        return {
          sequence,
          label,
          heading: `${event.playerId} passed`,
          details: ["No card played; no follower summoned."],
        };
      const { effect, summon } = event.plan;
      return {
        sequence,
        label: `${label} · Action ${event.actionSequence}`,
        heading: `${event.playerId} played ${title(event.card?.type ?? effect.effectiveCard)}`,
        details: [
          ...(event.card?.type !== effect.effectiveCard
            ? [`Copied effect: ${title(effect.effectiveCard)}.`]
            : []),
          ...(effect.kind === "no-effect"
            ? [`No card effect: ${effect.reason}`]
            : effect.operations.map(
                (operation, index) =>
                  `Effect ${index + 1}: ${describeOperation(operation)}`,
              )),
          summon.kind === "zero"
            ? "Summon: zero — no followers remain in uncontrolled regions."
            : `Summon: ${event.playerId} took 1 ${title(summon.faction)} from ${title(summon.regionId)} into their court.`,
        ],
      };
    }
    case "PowerStruggleResolved":
      return {
        sequence,
        label: `After turn ${event.turnSequence}`,
        heading: `Power struggle ${event.struggleIndex} · ${title(event.regionId)}`,
        details: [
          event.control.kind === "faction"
            ? `${title(event.control.faction)} had more followers than each other faction and gained control. A ${title(event.control.faction)} control disc was placed.`
            : totalFollowers(event.returnedToSupply) === 0
              ? "The region was empty, so it became unstable. An instability disc was placed."
              : "The largest follower counts were tied, so the region became unstable. An instability disc was placed.",
          `All followers returned to the common supply. Region card ${event.struggleIndex} was turned face down.`,
        ],
        followers: {
          caption: "Followers at the power struggle",
          rows: [
            {
              label: title(event.regionId),
              counts: { ...event.returnedToSupply },
            },
          ],
        },
      };
    case "GameEndTriggered":
      return {
        sequence,
        label: `After turn ${event.turnSequence}`,
        heading: `${title(event.method)} · normal play ends`,
        details: [
          event.method === "invasion"
            ? `The third instability disc was placed at ${title(event.regionId)}. Final scoring compares complete court sets, then the Invasion tiebreak.`
            : "All eight regions have resolved. Final scoring compares faction power and court support, then the Coronation tiebreaks.",
        ],
      };
    case "PlotRevealed":
      return {
        sequence,
        label: "Final scoring",
        heading: `${event.playerId} revealed Plot`,
        details: [
          "The holder must choose a faction before the result is decided.",
        ],
      };
    case "PlotChosen":
      return {
        sequence,
        label: "Final scoring",
        heading: `${event.playerId} chose ${title(event.faction)} for Plot`,
        details: [
          "One virtual follower supports this faction for scoring only. Physical followers are unchanged.",
        ],
      };
    case "GameFinished": {
      const { result } = event;
      return {
        sequence,
        label: "Final result",
        heading:
          result.kind === "win"
            ? `${result.winner} wins by ${title(result.method)}`
            : `${title(result.method)} ends in a draw`,
        details: [
          result.kind === "win"
            ? result.explanation
            : `${result.reason} Contenders: ${result.contenders.join(", ")}.`,
          ...result.details.cases.flatMap((evaluation) => [
            evaluation.ranking
              ? `Faction ranking: ${evaluation.ranking.map(title).join(" → ")}.`
              : "Invasion court comparison:",
            ...evaluation.steps.map(
              (step) =>
                `${title(step.criterion)}${step.faction ? ` (${title(step.faction)})` : ""}: ${step.values.map((value) => `${value.playerId}: ${value.value ?? "never acted"}`).join(", ")}. Remaining: ${step.remaining.join(", ")}.`,
            ),
          ]),
        ],
      };
    }
  }
}

/** Historical plays are revealed only after scoring is final. Setup hands,
 * unplayed cards, buried discard arrays, undealt cards, and RNG stay internal. */
export function projectFinishedLog(
  session: GameSession,
): readonly GameLogEntry[] {
  if (session.state.phase !== "finished" || session.state.result === null)
    return [];
  return session.events.map((event) => projectEvent(event));
}

/** Publicly witnessed history, including setup followers, with setup secrets
 * omitted. A finished game may also disclose its seed for reproducibility.
 */
export function projectPublicLog(
  session: GameSession,
): readonly GameLogEntry[] {
  return session.events.map((event) =>
    projectEvent(event, session.state.phase === "finished"),
  );
}

export interface LastMove {
  readonly turn: number;
  readonly summary: string;
  readonly details: readonly string[];
}
/** Accepted turns only; a pass replaces the previous card as the latest move. */
export function projectLastMoves(
  events: readonly AcceptedEvent[],
): Readonly<Record<string, LastMove>> {
  const moves: Record<string, LastMove> = Object.create(null);
  for (const event of events) {
    if (event.type !== "TurnCommitted") continue;
    moves[event.playerId] = {
      turn: event.turnSequence,
      summary:
        event.plan.kind === "pass"
          ? "Passed"
          : `Played ${title(event.card?.type ?? event.plan.effect.effectiveCard)}`,
      details: projectEvent(event).details,
    };
  }
  return moves;
}
