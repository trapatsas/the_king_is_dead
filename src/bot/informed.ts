import { ADJACENCY } from "../game/board";
import { FACTIONS, REGION_IDS } from "../game/domain";
import type {
  Faction,
  GameResult,
  GameState,
  PlayerState,
  RegionId,
} from "../game/domain";
import { applyEffectOperations } from "../game/effects/execute";
import { factionBorderTargets } from "../game/effects/standard";
import { enumerateSummonChoices } from "../game/summons";
import type { EffectPlan, SummonChoice, TurnPlan } from "../game/turnTypes";
import { evaluate as cheapEvaluate, terminalUtility } from "./evaluation";
import { passingResult } from "./patient";
import { StandardBot } from "./search";
import type { Candidate, RootChoice, SearchPolicy } from "./search";
import { cardChoices, passPlan, simulate } from "./simulation";
import type { Random } from "./simulation";

export const INFORMED_BOT_VERSION = "informed-mcts-v1";

/** Tunable preferences. Benchmarks may override them; the UI uses defaults. */
export interface InformedParams {
  /** Softmax-score value of holding one more card than the strongest opponent. */
  readonly tempo: number;
  /** Scale of the per-card option value. */
  readonly option: number;
  /** Forecast confidence floor and slope with opponents' remaining cards. */
  readonly confBase: number;
  readonly confSlope: number;
  /** Confidence multipliers by card parity: ahead, level, behind, empty hand. */
  readonly parityAhead: number;
  readonly parityLevel: number;
  readonly parityBehind: number;
  readonly parityEmpty: number;
  /** Root: extra search value a card needs over passing. */
  readonly margin: number;
  /** Root: pass whenever the exact all-pass line already wins outright. */
  readonly passWhenWinning: boolean;
}
export const DEFAULT_INFORMED_PARAMS: InformedParams = {
  tempo: 0.6,
  option: 0.5,
  confBase: 0.2,
  confSlope: 0.3,
  parityAhead: 1.4,
  parityLevel: 0.8,
  parityBehind: 0.45,
  parityEmpty: 0.3,
  margin: 0.12,
  passWhenWinning: true,
};

function softmax(values: readonly number[], temperature: number): number[] {
  const max = Math.max(...values);
  const weights = values.map((v) => Math.exp((v - max) / temperature));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((v) => v / sum);
}
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/** Largest single-card change to a region's leader margin available to this
 * seat, from the cards it actually still holds. Summoning adds one on top. */
function cardSwing(
  state: GameState,
  player: PlayerState,
  regionId: RegionId,
  leader: number | null,
): number {
  if (player.hand.length === 0) return 0;
  const others = REGION_IDS.filter(
    (id) => id !== regionId && state.regions[id].control.kind === "unresolved",
  );
  const adjacent = ADJACENCY[regionId].filter(
    (id) => state.regions[id].control.kind === "unresolved",
  );
  let best = 0;
  const seen = new Set<string>();
  for (const card of player.hand) {
    if (seen.has(card.type)) continue;
    seen.add(card.type);
    let swing = 0;
    if (card.type.endsWith("-support")) {
      const faction = card.type.slice(0, -"-support".length) as Faction;
      if (
        FACTIONS.indexOf(faction) !== leader &&
        state.supply[faction] > 0 &&
        factionBorderTargets(state, faction).includes(regionId)
      )
        swing = Math.min(2, state.supply[faction]);
    } else if (card.type === "assemble") {
      swing = FACTIONS.some((f, i) => i !== leader && state.supply[f] > 0)
        ? 1
        : 0;
    } else if (card.type === "manoeuvre") swing = others.length ? 2 : 0;
    else if (card.type === "outmanoeuvre") swing = adjacent.length ? 3 : 0;
    best = Math.max(best, swing);
  }
  return best;
}

interface RegionOutlook {
  /** Probability that each faction wins the region (sums to 1 - tie). */
  readonly shares: number[];
  /** Probability that the region resolves as a tie (instability). */
  readonly tie: number;
}
interface Forecast {
  readonly power: number[];
  readonly first: number[];
  readonly second: number[][];
  readonly invasionRisk: number;
  readonly unresolved: number;
  readonly cards: number;
}

/** Card-aware board forecast. A region whose leader margin exceeds what any
 * opposing seat can still bring is treated as decided; contested regions and
 * ties stay soft. Uses only the public position (Standard hands are public). */
function forecast(state: GameState): Forecast {
  const seats = state.playerOrder.map((id) => state.players[id]!);
  const cards = seats.reduce((sum, p) => sum + p.hand.length, 0);
  const preferred = seats.map((p) => {
    const counts = FACTIONS.map((f) => p.court[f]);
    const max = Math.max(...counts);
    const leaders = counts.filter((c) => c === max).length;
    return leaders === 1 ? counts.indexOf(max) : null;
  });
  const power = [0, 0, 0];
  for (const region of Object.values(state.regions)) {
    if (region.control.kind === "faction")
      power[FACTIONS.indexOf(region.control.faction)]! +=
        1 + region.control.struggleIndex * 0.001;
  }
  const unresolved = state.regionCards
    .filter((c) => c.faceUp)
    .sort((a, b) => a.slot - b.slot);
  let instability = [1, 0, 0, 0];
  unresolved.forEach((card, distance) => {
    const counts = FACTIONS.map(
      (f) => state.regions[card.regionId].followers[f],
    );
    const max = Math.max(...counts);
    const leaders = counts
      .map((c, i) => (c === max ? i : -1))
      .filter((i) => i >= 0);
    const leader = leaders.length === 1 ? leaders[0]! : null;
    const second = Math.max(...counts.filter((_, i) => i !== leader), 0);
    const margin = leader === null ? 0 : max - second;
    // Opposing capacity: seats whose court does not favour the leader.
    let threat = 0;
    let anyCards = 0;
    seats.forEach((p, i) => {
      if (p.hand.length === 0) return;
      anyCards++;
      const swing = 1 + cardSwing(state, p, card.regionId, leader);
      const hostile = leader === null || preferred[i] !== leader;
      threat += hostile ? swing : swing * 0.25;
    });
    // Later regions allow more intervention before they resolve.
    threat *= 1 + Math.min(0.6, distance * 0.12);
    let outlook: RegionOutlook;
    if (leader === null) {
      const tie = anyCards === 0 ? 1 : max === 0 ? 0.45 : 0.22 + 0.1 / anyCards;
      const weights = counts.map((c) => c + 0.5);
      const total = weights.reduce((a, b) => a + b, 0);
      outlook = { shares: weights.map((w) => ((1 - tie) * w) / total), tie };
    } else {
      const hold =
        anyCards === 0 ? 1 : sigmoid((margin - 0.5 * threat + 0.4) / 0.65);
      const tie = (1 - hold) * 0.3;
      const rest = 1 - hold - tie;
      const weights = counts.map((c, i) => (i === leader ? 0 : c + 0.5));
      const total = weights.reduce((a, b) => a + b, 0);
      outlook = {
        shares: weights.map((w, i) =>
          i === leader ? hold : (rest * w) / total,
        ),
        tie,
      };
    }
    outlook.shares.forEach((share, f) => {
      power[f]! += share * (1 + card.slot * 0.001);
    });
    const next = [0, 0, 0, 0];
    instability.forEach((p, i) => {
      next[i]! += p * (1 - outlook.tie);
      next[Math.min(3, i + 1)]! += p * outlook.tie;
    });
    instability = next;
  });
  const invasionRisk = instability
    .slice(state.instabilityDiscsInFrance)
    .reduce((a, b) => a + b, 0);
  const temperature = cards === 0 ? 0.03 : 0.22 + Math.min(0.4, cards * 0.03);
  const first = softmax(power, temperature);
  const second = FACTIONS.map((_, f) => {
    const others = FACTIONS.map((_, i) => i).filter((i) => i !== f);
    const weights = softmax(
      others.map((i) => power[i]!),
      Math.max(0.1, temperature * 1.5),
    );
    const row = [0, 0, 0];
    others.forEach((i, k) => {
      row[i] = weights[k]!;
    });
    return row;
  });
  return {
    power,
    first,
    second,
    invasionRisk,
    unresolved: unresolved.length,
    cards,
  };
}

/** Option value of the cards a seat still holds, counting only cards that can
 * still do something, fading as the game nears its end. */
function optionValue(
  state: GameState,
  player: PlayerState,
  params: InformedParams,
): number {
  const unresolved = state.regionCards.filter((c) => c.faceUp).length;
  if (unresolved === 0) return 0;
  const eligibleCards = state.regionCards.filter(
    (c) => c.faceUp && c.negotiationDiscOwner === null,
  ).length;
  let value = 0;
  for (const card of player.hand) {
    if (card.type.endsWith("-support")) {
      const faction = card.type.slice(0, -"-support".length) as Faction;
      value += state.supply[faction] > 0 || unresolved >= 2 ? 0.8 : 0.15;
    } else if (card.type === "assemble") value += 1;
    else if (card.type === "manoeuvre" || card.type === "outmanoeuvre")
      value += unresolved >= 2 ? 0.9 : 0.1;
    else if (card.type === "negotiate")
      value += eligibleCards >= 2 ? 0.7 : 0.05;
  }
  const phase = Math.min(1, 0.15 + unresolved / 8);
  const reserve = Math.min(4, unresolved * 0.5);
  const deficit = Math.max(0, reserve - player.hand.length);
  return params.option * phase * value - 0.1 * deficit * deficit * phase;
}

function cardLead(state: GameState, id: string): number {
  const own = state.players[id]!.hand.length;
  const strongest = Math.max(
    0,
    ...state.playerOrder
      .filter((other) => other !== id)
      .map((other) => state.players[other]!.hand.length),
  );
  return own - strongest;
}

export function evaluateInformed(
  state: GameState,
  params: InformedParams = DEFAULT_INFORMED_PARAMS,
): number[] {
  if (state.result) return terminalUtility(state.result, state.playerOrder);
  const seats = state.playerOrder.map((id) => state.players[id]!);
  const view = forecast(state);
  // Tempo: holding at least as many cards as the strongest opponent keeps the
  // last word on the remaining struggles. Fades as the board locks up.
  const phase = Math.min(1, 0.15 + view.unresolved / 8);
  const options = seats.map(
    (p) =>
      optionValue(state, p, params) +
      params.tempo * phase * Math.max(-3, Math.min(3, cardLead(state, p.id))),
  );
  const coronation = seats.map(() => 0);
  for (let f = 0; f < 3; f++) {
    if (view.first[f]! < 0.001) continue;
    const scores = seats.map((p, i) => {
      const secondSupport = FACTIONS.reduce(
        (sum, faction, k) => sum + p.court[faction] * view.second[f]![k]!,
        0,
      );
      return (
        p.court[FACTIONS[f]!] +
        0.18 * secondSupport +
        options[i]! -
        (p.lastActionSequence ?? 0) * 0.002
      );
    });
    softmax(scores, 0.6).forEach((value, i) => {
      coronation[i]! += view.first[f]! * value;
    });
  }
  const invasion = softmax(
    seats.map((p, i) => {
      const counts = FACTIONS.map((f) => p.court[f]).sort((a, b) => a - b);
      return (
        counts[0]! +
        (counts[1]! - counts[0]!) * 0.16 +
        (counts[2]! - counts[1]!) * 0.03 +
        options[i]! * 0.6 +
        (p.lastActionSequence ?? 0) * 0.002
      );
    }),
    0.55,
  );
  const risk = view.invasionRisk;
  return seats.map(
    (_, i) =>
      0.01 +
      (1 - seats.length * 0.01) *
        ((1 - risk) * coronation[i]! + risk * invasion[i]!),
  );
}

function opponentCards(state: GameState, seat: string): number {
  return state.playerOrder
    .filter((id) => id !== seat)
    .reduce((sum, id) => sum + state.players[id]!.hand.length, 0);
}

/** Heuristic blended with the exact all-pass continuation. The forecast gains
 * weight as opponents run out of ways to change the board. */
function blendedValue(
  state: GameState,
  forecasts: WeakMap<GameState, GameResult>,
  params: InformedParams,
): number[] {
  const value = evaluateInformed(state, params);
  if (state.result) return value;
  let result = forecasts.get(state);
  if (!result) {
    result = passingResult(state);
    forecasts.set(state, result);
  }
  const exact = terminalUtility(result, state.playerOrder);
  return state.playerOrder.map((id, seat) => {
    const others = opponentCards(state, id);
    const own = state.players[id]!.hand.length;
    let confidence =
      others === 0
        ? 0.8
        : params.confBase +
          params.confSlope *
            (1 - others / (8 * (state.playerOrder.length - 1)));
    // The all-pass line is only defensible for a seat that can still answer:
    // trust it most with a card lead, least with an empty hand.
    if (others > 0) {
      const lead = cardLead(state, id);
      confidence *=
        own === 0
          ? params.parityEmpty
          : lead > 0
            ? params.parityAhead
            : lead === 0
              ? params.parityLevel
              : params.parityBehind;
      confidence = Math.min(0.85, confidence);
    }
    return (1 - confidence) * value[seat]! + confidence * exact[seat]!;
  });
}

/** Cheap ordering of summons for one effect: court gain for the factions
 * likely to matter, against the damage of weakening a region the actor wants. */
function rankSummons(
  after: GameState,
  actorId: string,
  summons: readonly SummonChoice[],
): SummonChoice[] {
  if (summons.length <= 1) return [...summons];
  const view = forecast(after);
  const actor = after.players[actorId]!;
  const opponents = after.playerOrder
    .filter((id) => id !== actorId)
    .map((id) => after.players[id]!);
  const setNeed = FACTIONS.map((f) => {
    const min = Math.min(...FACTIONS.map((g) => actor.court[g]));
    return actor.court[f] === min ? 1 : 0;
  });
  const lead = FACTIONS.map(
    (f) => actor.court[f] - Math.max(...opponents.map((p) => p.court[f])),
  );
  const slots = new Map(after.regionCards.map((c) => [c.regionId, c.slot]));
  const nextSlot = Math.min(
    ...after.regionCards.filter((c) => c.faceUp).map((c) => c.slot),
  );
  const scored = summons.map((summon) => {
    if (summon.kind !== "follower") return { summon, score: -Infinity };
    const f = FACTIONS.indexOf(summon.faction);
    const counts = FACTIONS.map(
      (g) => after.regions[summon.regionId].followers[g],
    );
    const max = Math.max(...counts);
    const isLeader =
      counts[f] === max && counts.filter((c) => c === max).length === 1;
    const second = Math.max(...counts.filter((_, i) => i !== f), 0);
    const margin = isLeader ? max - second : 0;
    // Removing a leader's follower risks flipping or tying the region.
    const sensitivity = isLeader
      ? margin === 1
        ? 1
        : margin === 2
          ? 0.5
          : 0.2
      : counts[f] === max
        ? -0.4
        : 0.1;
    const proximity =
      1 -
      Math.min(
        0.5,
        ((slots.get(summon.regionId) ?? nextSlot) - nextSlot) * 0.08,
      );
    const wantFaction = Math.tanh(lead[f]! / 2) * view.first[f]!;
    const score =
      view.first[f]! +
      0.4 * view.invasionRisk * setNeed[f]! -
      0.6 * wantFaction * sensitivity * proximity;
    return { summon, score };
  });
  return scored.sort((a, b) => b.score - a.score).map((x) => x.summon);
}

function sampleDistinct<T>(
  items: readonly T[],
  count: number,
  random: Random,
): T[] {
  if (items.length <= count) return [...items];
  const copy = [...items];
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, count);
}

export class InformedBot extends StandardBot {
  constructor(params: Partial<InformedParams> = {}) {
    super(informedPolicy({ ...DEFAULT_INFORMED_PARAMS, ...params }));
  }
}

function informedPolicy(params: InformedParams): SearchPolicy {
  const forecasts = new WeakMap<GameState, GameResult>();
  const value = (state: GameState) => blendedValue(state, forecasts, params);
  function candidateOf(state: GameState, plan: TurnPlan): Candidate {
    const next = simulate(state, plan);
    return { plan, state: next, value: value(next), key: JSON.stringify(plan) };
  }
  function cardPlan(
    state: GameState,
    cardId: string,
    effect: EffectPlan,
    summon: SummonChoice,
  ): TurnPlan {
    return {
      kind: "card",
      playerId: state.activePlayerId,
      baseTurnSequence: state.turnSequence,
      cardId,
      effect,
      summon,
    };
  }
  /** Score a sample of effects cheaply, keep the best few, then rank their
   * summons and fully value the top ones. Pass is always proposed. */
  function propose(
    state: GameState,
    random: Random,
    stage: "root" | "inner",
  ): Candidate[] {
    const actor = state.playerOrder.indexOf(state.activePlayerId);
    const effectBudget = stage === "root" ? 64 : 6;
    const keepEffects = stage === "root" ? 4 : 1;
    const keepSummons = stage === "root" ? 3 : 2;
    const out: Candidate[] = [candidateOf(state, passPlan(state))];
    const seen = new Set<string>([out[0]!.key]);
    for (const choices of cardChoices(state)) {
      const sample = sampleDistinct(choices.effects, effectBudget, random);
      const scored = sample
        .map((effect) => {
          const after = applyEffectOperations(
            state,
            state.activePlayerId,
            effect.operations,
          );
          return { effect, after, score: cheapEvaluate(after)[actor]! };
        })
        .sort((a, b) => b.score - a.score);
      const chosen = scored.slice(0, keepEffects);
      if (scored.length > keepEffects)
        chosen.push(
          scored[
            keepEffects + Math.floor(random() * (scored.length - keepEffects))
          ]!,
        );
      for (const { effect, after } of chosen) {
        const summons = rankSummons(
          after,
          state.activePlayerId,
          enumerateSummonChoices(after),
        ).slice(0, keepSummons);
        for (const summon of summons) {
          const plan = cardPlan(state, choices.card.id, effect, summon);
          const key = JSON.stringify(plan);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ ...candidateOf(state, plan), key });
        }
      }
    }
    const pass = out[0]!;
    const cards = out
      .slice(1)
      .sort((a, b) => b.value[actor]! - a.value[actor]!);
    return [pass, ...cards];
  }
  function exact(state: GameState, seat: number): number {
    let result = forecasts.get(state);
    if (!result) {
      result = state.result ?? passingResult(state);
      forecasts.set(state, result);
    }
    return terminalUtility(result, state.playerOrder)[seat]!;
  }
  /** Opponents without cards can only pass, so the all-pass continuation after
   * the actor's own sequence is exact. Beam-search that sequence. */
  function solveAlone(
    state: GameState,
    seat: number,
    random: Random,
    depth: number,
  ): { utility: number; plan: TurnPlan | null } {
    if (state.phase !== "turn")
      return { utility: exact(state, seat), plan: null };
    const seatId = state.playerOrder[seat]!;
    if (state.activePlayerId !== seatId) {
      // Opponents are spent: advance their forced passes.
      return solveAlone(simulate(state, passPlan(state)), seat, random, depth);
    }
    const passUtility = exact(state, seat);
    let best: { utility: number; plan: TurnPlan | null } = {
      utility: passUtility,
      plan: passPlan(state),
    };
    if (depth === 0 || state.players[seatId]!.hand.length === 0) return best;
    const options = propose(state, random, "root")
      .filter((c) => c.plan.kind === "card")
      .slice(0, 6);
    for (const option of options) {
      const utility =
        depth === 1
          ? exact(option.state, seat)
          : solveAlone(option.state, seat, random, depth - 1).utility;
      if (utility > best.utility + 1e-9) best = { utility, plan: option.plan };
    }
    return best;
  }
  function chooseRoot(state: GameState, choices: readonly RootChoice[]) {
    const seat = state.playerOrder.indexOf(state.activePlayerId);
    const pass = choices.find((choice) => choice.plan.kind === "pass");
    if (!pass) return undefined;
    const cards = choices.filter((choice) => choice.plan.kind === "card");
    if (!cards.length) return pass.plan;
    if (opponentCards(state, state.activePlayerId) === 0) {
      const random = () => 0.5;
      const solved = solveAlone(state, seat, random, 3);
      return solved.plan ?? pass.plan;
    }
    const score = (choice: RootChoice) =>
      (choice.mean[seat]! * choice.visits + choice.prior[seat]! * 2) /
      (choice.visits + 2);
    const best = [...cards].sort((a, b) => score(b) - score(a))[0]!;
    if (pass.state.result) {
      const utility = terminalUtility(pass.state.result, state.playerOrder)[
        seat
      ]!;
      if (utility === 1) return pass.plan;
      if (utility === 0) return best.plan;
    }
    // Already winning if everyone stops: keep parity and let opponents spend.
    if (params.passWhenWinning && exact(state, seat) === 1) return pass.plan;
    const unresolved = state.regionCards.filter((c) => c.faceUp).length;
    const hand = state.players[state.activePlayerId]!.hand.length;
    const deficit = Math.max(0, Math.min(3, unresolved * 0.4) - hand);
    const margin = params.margin + 0.02 * deficit;
    return score(best) > score(pass) + margin ? best.plan : pass.plan;
  }
  return {
    evaluate: value,
    evaluateLeaf: value,
    propose,
    chooseRoot,
    explain: (plan) =>
      plan.kind === "pass"
        ? "Hold: no card improves the forecast enough against what opponents can still do."
        : "Play where it shifts a struggle opponents cannot undo, or secures court support.",
  };
}
