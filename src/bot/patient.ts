import { FACTIONS } from "../game/domain";
import type {
  Faction,
  FactionPower,
  GameResult,
  GameState,
} from "../game/domain";
import { determineControl } from "../game/struggles";
import { enumerateFactionRankings } from "../game/scoring";
import { evaluate as referenceEvaluate, terminalUtility } from "./evaluation";
import { StandardBot } from "./search";
import type { RootChoice, SearchPolicy } from "./search";
import { passPlan, simulate } from "./simulation";

export const PATIENT_BOT_VERSION = "patient-mcts-v1";
function softmax(values: readonly number[], temperature = 0.8): number[] {
  const max = Math.max(...values),
    weights = values.map((value) => Math.exp((value - max) / temperature));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((value) => value / sum);
}
interface Forecast {
  readonly power: Record<Faction, FactionPower>;
  readonly horizon: number;
  readonly invasion: boolean;
}
/** Conditional forecast only: resolve the current board without more actions.
 * Control and faction ordering use the same helpers as the rules engine.
 */
function boardForecast(state: GameState): Forecast {
  const power: Record<Faction, FactionPower> = {
    scottish: { wins: 0, lastWonStruggle: null },
    welsh: { wins: 0, lastWonStruggle: null },
    english: { wins: 0, lastWonStruggle: null },
  };
  function add(control: ReturnType<typeof determineControl>) {
    if (control.kind !== "faction") return;
    const p = power[control.faction];
    power[control.faction] = {
      wins: p.wins + 1,
      lastWonStruggle: Math.max(p.lastWonStruggle ?? 0, control.struggleIndex),
    };
  }
  for (const region of Object.values(state.regions))
    if (region.control.kind !== "unresolved") add(region.control);
  let ties = 0,
    horizon = 0;
  for (const card of state.regionCards
    .filter((card) => card.faceUp)
    .sort((a, b) => a.slot - b.slot)) {
    const control = determineControl(
      state.regions[card.regionId].followers,
      card.slot,
    );
    horizon++;
    add(control);
    if (control.kind === "unstable") ties++;
    if (ties >= state.instabilityDiscsInFrance) break;
  }
  return { power, horizon, invasion: ties >= state.instabilityDiscsInFrance };
}
function responseHorizon(state: GameState, forecast: Forecast): number {
  const unresolved = state.regionCards.filter((card) => card.faceUp).length;
  const cards = Object.values(state.players).reduce(
    (sum, p) => sum + p.hand.length,
    0,
  );
  // An apparent early Invasion is not a reliable deadline while seats still
  // have many ways to change ties. Reserve responses for that longer game.
  return Math.max(
    forecast.horizon,
    Math.ceil(unresolved * Math.min(1, cards / 8)),
  );
}
function referenceSeat(state: GameState, id: string): boolean {
  const p = state.players[id]!;
  return (
    p.controller === "algorithmic" &&
    (p.botStrategy ?? "reference") === "reference"
  );
}
/** Cheap candidate prior. Response cards have option value while struggles are
 * unresolved; that value fades near a projected ending. A soft reserve deficit
 * discourages exhausting a hand early, while leaving every action legal.
 */
export function evaluatePatient(state: GameState): number[] {
  if (state.result) return terminalUtility(state.result, state.playerOrder);
  const forecast = boardForecast(state),
    seats = state.playerOrder.map((id) => state.players[id]!);
  const horizon = responseHorizon(state, forecast);
  const phase = Math.max(1, horizon) / 8;
  const reserve = Math.min(5, horizon * 0.65);
  const options = seats.map((p) => {
    const flexibility = p.hand.reduce(
      (value, card) =>
        value +
        (card.type === "negotiate" ||
        card.type === "manoeuvre" ||
        card.type === "outmanoeuvre"
          ? forecast.horizon > 1
            ? 1.05
            : 0.2
          : card.type === "assemble"
            ? 1.1
            : 0.85),
      0,
    );
    const deficit = Math.max(0, reserve - p.hand.length);
    return (
      0.6 * Math.pow(phase, 0.6) * flexibility -
      0.12 * deficit * deficit * phase
    );
  });
  const rankings = enumerateFactionRankings(forecast.power);
  const coronation = seats.map(() => 0);
  for (const ranking of rankings) {
    const values = softmax(
      seats.map(
        (p, i) =>
          p.court[ranking[0]] +
          p.court[ranking[1]] * 0.16 +
          options[i]! -
          (p.lastActionSequence ?? 0) * 0.002,
      ),
    );
    values.forEach((value, i) => {
      coronation[i]! += value / rankings.length;
    });
  }
  const invasion = softmax(
    seats.map((p, i) => {
      const counts = FACTIONS.map((f) => p.court[f]).sort((a, b) => a - b);
      return (
        counts[0]! +
        (counts[1]! - counts[0]!) * 0.16 +
        options[i]! * 0.75 +
        (p.lastActionSequence ?? 0) * 0.002
      );
    }),
    0.65,
  );
  // Do not assume a player who loses an Invasion will obligingly create one.
  // This is a conditional route forecast, softened while replies are possible.
  const risk = forecast.invasion ? 0.8 : 0.06;
  const patient = seats.map(
    (_, i) =>
      0.01 +
      (1 - seats.length * 0.01) *
        ((1 - risk) * coronation[i]! + risk * invasion[i]!),
  );
  const reference = referenceEvaluate(state);
  return state.playerOrder.map((id, i) =>
    referenceSeat(state, id) ? reference[i]! : patient[i]!,
  );
}

/** Full shared-engine pass continuation, not an invented terminal scorer. */
export function passingResult(state: GameState): GameResult {
  let next = state;
  for (let turns = 0; next.phase === "turn" && turns < 24; turns++)
    next = simulate(next, passPlan(next));
  if (!next.result)
    throw new Error("Standard pass forecast did not reach scoring");
  return next.result;
}
function utility(state: GameState, result: GameResult, seat: number): number {
  return terminalUtility(result, state.playerOrder)[seat]!;
}
export class PatientBot extends StandardBot {
  constructor() {
    super(patientPolicy());
  }
}
function patientPolicy(): SearchPolicy {
  const forecasts = new WeakMap<GameState, GameResult>();
  function forecast(state: GameState): GameResult {
    let result = forecasts.get(state);
    if (!result) {
      result = passingResult(state);
      forecasts.set(state, result);
    }
    return result;
  }
  function evaluateLeaf(state: GameState): number[] {
    const value = evaluatePatient(state);
    if (state.result) return value;
    const result = forecast(state);
    return state.playerOrder.map((id, seat) => {
      if (referenceSeat(state, id)) return value[seat]!;
      const opponents = state.playerOrder
        .filter((other) => other !== id)
        .reduce((sum, other) => sum + state.players[other]!.hand.length, 0);
      const confidence =
        opponents === 0
          ? 0.7
          : 0.15 +
            0.25 * (1 - opponents / (8 * (state.playerOrder.length - 1)));
      return (
        (1 - confidence) * value[seat]! +
        confidence * utility(state, result, seat)
      );
    });
  }
  function chooseRoot(state: GameState, choices: readonly RootChoice[]) {
    const seat = state.playerOrder.indexOf(state.activePlayerId);
    const pass = choices.find((choice) => choice.plan.kind === "pass");
    if (!pass) return undefined;
    const cards = choices.filter((choice) => choice.plan.kind === "card");
    if (!cards.length) return pass.plan;
    const score = (choice: RootChoice) =>
      (choice.mean[seat]! * choice.visits + choice.prior[seat]! * 3) /
      (choice.visits + 3);
    const best = [...cards].sort((a, b) => score(b) - score(a))[0]!;
    const onlyMover = state.playerOrder.every(
      (id) =>
        id === state.activePlayerId || state.players[id]!.hand.length === 0,
    );
    if (onlyMover) {
      const winning = cards
        .filter((choice) => utility(state, forecast(choice.state), seat) === 1)
        .sort((a, b) => score(b) - score(a))[0];
      const banked = utility(state, forecast(state), seat);
      if (banked === 1) return pass.plan;
      if (winning) return winning.plan;
      if (banked > 0) return pass.plan;
      return best.plan;
    }
    // Never conserve a card by accepting a proven terminal loss.
    if (pass.state.result && utility(state, pass.state.result, seat) === 0)
      return best.plan;
    const actor = state.players[state.activePlayerId]!;
    const opposingActions = state.actionSequence - actor.discards.length;
    const opening =
      actor.discards.length === 0 &&
      opposingActions < 2 * (state.playerOrder.length - 1) &&
      state.consecutivePasses < state.playerOrder.length - 1;
    // Wait for public commitments when no sampled move makes a substantial
    // immediate improvement. This is not a forced opening: a large positional
    // gain can justify acting, and the last pass before a struggle is exempt.
    if (
      opening &&
      !cards.some((choice) => choice.prior[seat]! > pass.prior[seat]! + 0.1)
    )
      return pass.plan;
    const horizon = responseHorizon(state, boardForecast(state));
    const deficit = Math.max(
      0,
      Math.min(5, horizon * 0.65) + 1 - actor.hand.length,
    );
    const margin =
      0.02 + (0.06 * horizon) / 8 + 0.035 * deficit + (opening ? 0.15 : 0);
    return score(best) > score(pass) + margin ? best.plan : pass.plan;
  }
  return {
    evaluate: evaluatePatient,
    evaluateLeaf,
    chooseRoot,
    explain: (plan) =>
      plan.kind === "pass"
        ? "Preserve responses for later struggles while allowing other seats to commit."
        : "Spend a card where it improves the victory route or answers a threat.",
  };
}
