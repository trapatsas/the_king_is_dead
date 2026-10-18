import { FACTIONS, REGION_IDS } from "./domain";
import type {
  CaseOutcome,
  Faction,
  FactionCounts,
  FactionPower,
  FactionRanking,
  GameResult,
  GameState,
  PlayerId,
  PlayerScore,
  PlotSupport,
  RankingEvaluation,
  ScoringCriterion,
  ScoringDetails,
  ScoringStep,
  VictoryMethod,
} from "./domain";
import { IllegalTurnError } from "./errors";
import { freezeSnapshot } from "./immutable";
import { copyChoice } from "./plans";

export interface ScoringPlayer {
  readonly playerId: PlayerId;
  readonly court: FactionCounts;
  readonly lastActionSequence: number | null;
}
export interface ScoringPosition {
  readonly method: VictoryMethod;
  readonly players: readonly ScoringPlayer[];
  readonly factionPower: Readonly<Record<Faction, FactionPower>>;
  readonly plot: PlotSupport | null;
}

const compareIds = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

function validateFactionPower(
  factionPower: Readonly<Record<Faction, FactionPower>>,
): void {
  const lastWins: number[] = [];
  let wins = 0;
  for (const faction of FACTIONS) {
    const power = factionPower[faction];
    if (
      !Number.isInteger(power.wins) ||
      power.wins < 0 ||
      power.wins > 8 ||
      (power.wins === 0
        ? power.lastWonStruggle !== null
        : power.lastWonStruggle === null ||
          !Number.isInteger(power.lastWonStruggle) ||
          power.lastWonStruggle < power.wins ||
          power.lastWonStruggle > 8)
    ) {
      throw new IllegalTurnError("Invalid faction victory history");
    }
    wins += power.wins;
    if (power.lastWonStruggle !== null) lastWins.push(power.lastWonStruggle);
  }
  if (wins > 8)
    throw new IllegalTurnError("Faction victories cannot exceed eight regions");
  if (new Set(lastWins).size !== lastWins.length)
    throw new IllegalTurnError("A struggle cannot be won by multiple factions");
}

function validatePosition(position: ScoringPosition): void {
  if (position.method !== "invasion" && position.method !== "coronation")
    throw new IllegalTurnError("Unknown scoring method");
  if (
    ![2, 3].includes(position.players.length) ||
    new Set(position.players.map((player) => player.playerId)).size !==
      position.players.length
  ) {
    throw new IllegalTurnError(
      "Scoring requires two or three distinct players",
    );
  }
  const sequences: number[] = [];
  for (const player of position.players) {
    if (
      typeof player.playerId !== "string" ||
      player.playerId.trim().length === 0 ||
      FACTIONS.some(
        (faction) =>
          !Number.isSafeInteger(player.court[faction]) ||
          player.court[faction] < 0,
      )
    ) {
      throw new IllegalTurnError("Invalid scoring court or player");
    }
    if (player.lastActionSequence !== null) {
      if (
        !Number.isSafeInteger(player.lastActionSequence) ||
        player.lastActionSequence <= 0
      )
        throw new IllegalTurnError("Invalid final action sequence");
      sequences.push(player.lastActionSequence);
    }
  }
  if (new Set(sequences).size !== sequences.length)
    throw new IllegalTurnError(
      "Final committed actions have distinct sequence numbers",
    );
  validateFactionPower(position.factionPower);
  if (
    position.plot !== null &&
    (!FACTIONS.includes(position.plot.faction) ||
      !position.players.some(
        (player) => player.playerId === position.plot?.playerId,
      ))
  ) {
    throw new IllegalTurnError("Invalid virtual Plot support");
  }
}

/** All orderings consistent with wins/latest victory, never an invented zero-win order. */
export function enumerateFactionRankings(
  power: Readonly<Record<Faction, FactionPower>>,
): readonly FactionRanking[] {
  validateFactionPower(power);
  const permutations: FactionRanking[] = [];
  for (const first of FACTIONS) {
    for (const second of FACTIONS) {
      if (second === first) continue;
      const third = FACTIONS.find(
        (faction) => faction !== first && faction !== second,
      );
      if (third === undefined) continue;
      const ranking: FactionRanking = [first, second, third];
      const consistent = ranking.every((faction, index) =>
        ranking
          .slice(index + 1)
          .every(
            (other) =>
              power[faction].wins > power[other].wins ||
              (power[faction].wins === power[other].wins &&
                (power[faction].lastWonStruggle ?? 0) >=
                  (power[other].lastWonStruggle ?? 0)),
          ),
      );
      if (consistent) permutations.push(ranking);
    }
  }
  return freezeSnapshot(permutations);
}

function evaluateCase(
  players: readonly PlayerScore[],
  method: VictoryMethod,
  ranking: FactionRanking | null,
  plot: PlotSupport | null,
): RankingEvaluation {
  let candidates = [...players];
  const steps: ScoringStep[] = [];
  function compare(
    criterion: ScoringCriterion,
    value: (player: PlayerScore) => number | null,
    faction: Faction | null = null,
    minimum = false,
  ): void {
    const values = candidates.map((player) => ({
      playerId: player.playerId,
      value: value(player),
    }));
    const numbers = values.map((entry) => entry.value ?? 0);
    const best = minimum ? Math.min(...numbers) : Math.max(...numbers);
    candidates = candidates.filter((player) => (value(player) ?? 0) === best);
    steps.push({
      criterion,
      faction,
      values,
      remaining: candidates.map((player) => player.playerId),
    });
  }
  if (method === "invasion") {
    compare("complete-sets", (player) => player.completeSets);
    if (candidates.length > 1)
      compare("latest-action", (player) => player.lastActionSequence);
  } else {
    if (ranking === null)
      throw new IllegalTurnError("Coronation needs a faction ranking");
    compare(
      "leading-faction",
      (player) => player.scoringCourt[ranking[0]],
      ranking[0],
    );
    if (candidates.length > 1)
      compare(
        "second-faction",
        (player) => player.scoringCourt[ranking[1]],
        ranking[1],
      );
    if (
      candidates.length > 1 &&
      plot !== null &&
      candidates.some((player) => player.playerId === plot.playerId)
    ) {
      compare("plot-override", (player) =>
        player.playerId === plot.playerId ? 1 : 0,
      );
    }
    if (candidates.length > 1)
      compare(
        "earliest-final-action",
        (player) => player.lastActionSequence,
        null,
        true,
      );
  }
  const winner = candidates.length === 1 ? candidates[0] : undefined;
  const decisive = steps.at(-1);
  if (decisive === undefined)
    throw new IllegalTurnError("No scoring comparison");
  const outcome: CaseOutcome =
    winner === undefined
      ? {
          kind: "draw",
          contenders: candidates.map((player) => player.playerId),
          reason: "tied-never-acted",
        }
      : { kind: "win", winner: winner.playerId, criterion: decisive.criterion };
  return { ranking, steps, outcome };
}

function describeCase(evaluation: RankingEvaluation): string {
  const prefix =
    evaluation.ranking === null ? "Invasion" : evaluation.ranking.join(" > ");
  if (evaluation.outcome.kind === "draw") {
    return `${prefix}: ${evaluation.outcome.contenders.join(", ")} remain tied; none has played a committed action`;
  }
  const step = evaluation.steps.at(-1);
  if (step === undefined)
    throw new IllegalTurnError("Missing decisive comparison");
  const label: Record<ScoringCriterion, string> = {
    "complete-sets": "most complete follower sets",
    "leading-faction": `most ${step.faction} support in the leading faction`,
    "second-faction": `most ${step.faction} support in the second faction`,
    "plot-override": "Plot's override after both support comparisons",
    "latest-action": "latest final committed action among the tied players",
    "earliest-final-action":
      "earliest final committed action (never acted counts earliest)",
  };
  return `${prefix}: ${evaluation.outcome.winner} wins by ${label[evaluation.outcome.criterion]}`;
}

/** Pure scoring arithmetic. Physical card ownership is enforced by scoreGame. */
export function evaluateScoring(position: ScoringPosition): GameResult {
  validatePosition(position);
  const players: PlayerScore[] = [...position.players]
    .sort((a, b) => compareIds(a.playerId, b.playerId))
    .map((player) => {
      const scoringCourt = { ...player.court };
      if (position.plot?.playerId === player.playerId)
        scoringCourt[position.plot.faction] += 1;
      return {
        ...player,
        court: { ...player.court },
        scoringCourt,
        completeSets: Math.min(
          ...FACTIONS.map((faction) => scoringCourt[faction]),
        ),
      };
    });
  const rankings =
    position.method === "coronation"
      ? enumerateFactionRankings(position.factionPower)
      : [null];
  if (rankings.length === 0)
    throw new IllegalTurnError("No rule-consistent faction rankings");
  const cases = rankings.map((ranking) =>
    evaluateCase(players, position.method, ranking, position.plot),
  );
  const details: ScoringDetails = {
    players,
    factionPower: position.factionPower,
    plot: position.plot,
    cases,
  };
  const first = cases[0]?.outcome;
  if (
    first?.kind === "win" &&
    cases.every(
      (entry) =>
        entry.outcome.kind === "win" && entry.outcome.winner === first.winner,
    )
  ) {
    return freezeSnapshot(
      copyChoice({
        kind: "win",
        winner: first.winner,
        method: position.method,
        explanation: cases.map(describeCase).join(". ") + ".",
        details,
      }),
    );
  }
  const contenders = [
    ...new Set(
      cases.flatMap((entry) =>
        entry.outcome.kind === "win"
          ? [entry.outcome.winner]
          : entry.outcome.contenders,
      ),
    ),
  ].sort(compareIds);
  const reason =
    (cases.length > 1
      ? "Valid faction rankings do not all produce the same unique winner. "
      : "Unresolved tie. ") +
    cases.map(describeCase).join(". ") +
    ".";
  const base = {
    kind: "draw" as const,
    contenders,
    method: position.method,
    reason,
    details,
  };
  return freezeSnapshot(
    copyChoice(
      position.method === "coronation"
        ? {
            ...base,
            rankingCases: cases.flatMap((entry) =>
              entry.ranking === null ? [] : [entry.ranking],
            ),
          }
        : base,
    ),
  );
}

export function findPlotHolder(
  state: GameState,
): { readonly playerId: PlayerId; readonly cardId: string } | null {
  for (const player of Object.values(state.players)) {
    const card = player.hand.find((held) => held.type === "plot");
    if (card !== undefined) return { playerId: player.id, cardId: card.id };
  }
  return null;
}

/** Derived from control history, not geography, seat order, or a new random draw. */
export function scoreGame(
  state: GameState,
  virtualPlot?: PlotSupport,
): GameResult {
  if (state.ending === null || state.phase === "turn")
    throw new IllegalTurnError("Normal play must end before scoring");
  const holder = findPlotHolder(state);
  if (
    virtualPlot !== undefined &&
    state.plot !== null &&
    state.plot.faction !== null &&
    (virtualPlot.playerId !== state.plot.playerId ||
      virtualPlot.faction !== state.plot.faction)
  ) {
    throw new IllegalTurnError("Plot choice is already committed");
  }
  const selected =
    virtualPlot ??
    (state.plot?.faction
      ? { playerId: state.plot.playerId, faction: state.plot.faction }
      : null);
  if (
    holder === null
      ? selected !== null
      : selected === null || selected.playerId !== holder.playerId
  ) {
    throw new IllegalTurnError(
      "Choose the held Plot's virtual faction before scoring; undealt Plot gives no support",
    );
  }
  const power: Record<Faction, FactionPower> = {
    scottish: { wins: 0, lastWonStruggle: null },
    welsh: { wins: 0, lastWonStruggle: null },
    english: { wins: 0, lastWonStruggle: null },
  };
  for (const id of REGION_IDS) {
    const control = state.regions[id].control;
    if (control.kind !== "faction") continue;
    const previous = power[control.faction];
    power[control.faction] = {
      wins: previous.wins + 1,
      lastWonStruggle: Math.max(
        previous.lastWonStruggle ?? 0,
        control.struggleIndex,
      ),
    };
  }
  return evaluateScoring({
    method: state.ending,
    players: Object.values(state.players).map((player) => ({
      playerId: player.id,
      court: player.court,
      lastActionSequence: player.lastActionSequence,
    })),
    factionPower: power,
    plot: selected,
  });
}
