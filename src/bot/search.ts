import type { GameState } from "../game/domain";
import type { TurnPlan } from "../game/turnTypes";
import type { PlayerObservation } from "../game/visibility";
import { evaluate } from "./evaluation";
import { reconstructStandard } from "./observation";
import type { PublicMemory } from "./observation";
import {
  cardChoices,
  passPlan,
  pick,
  sampleCardPlan,
  seededRandom,
  simulate,
} from "./simulation";
import type { CardChoices, Random } from "./simulation";

export const BOT_VERSION = "standard-mcts-v2";
export interface SearchBudget {
  readonly iterations: number;
  readonly seed: number;
  /** Omit in reproducible benchmarks. Worker adds a separate wall-clock cap. */
  readonly timeMs?: number;
}
export interface SearchRequest {
  readonly observation: PlayerObservation;
  readonly memory: PublicMemory;
  readonly budget: SearchBudget;
}
export interface SearchStats {
  iterations: number;
  elapsedMs: number;
  nodes: number;
  maxDepth: number;
  horizon: number;
  horizonVisits: number;
  terminalVisits: number;
  rootChoices: number;
  reusedVisits: number;
}
export interface SearchResult {
  readonly plan: TurnPlan;
  readonly stats: SearchStats;
  readonly explanation: string;
}
interface Candidate {
  plan: TurnPlan;
  state: GameState;
  value: number[];
  key: string;
}
interface Node {
  state: GameState;
  visits: number;
  total: number[];
  prior: number[];
  children: { plan: TurnPlan; node: Node }[];
  choices?: CardChoices[];
  seen: Set<string>;
}
function node(state: GameState, prior = evaluate(state)): Node {
  return {
    state,
    visits: 0,
    total: state.playerOrder.map(() => 0),
    prior,
    children: [],
    seen: new Set(),
  };
}
function candidate(state: GameState, plan: TurnPlan): Candidate {
  const next = simulate(state, plan);
  return {
    plan,
    state: next,
    value: evaluate(next),
    key: JSON.stringify(plan),
  };
}
function candidates(
  parent: Node,
  random: Random,
  samplesPerCard: number,
): Candidate[] {
  const state = parent.state;
  parent.choices ??= cardChoices(state);
  const options: Candidate[] = [];
  const pass = passPlan(state);
  if (!parent.seen.has(JSON.stringify(pass)))
    options.push(candidate(state, pass));
  for (const choices of parent.choices) {
    for (let i = 0; i < samplesPerCard; i++) {
      const plan = sampleCardPlan(state, choices, random);
      const key = JSON.stringify(plan);
      if (!parent.seen.has(key)) options.push(candidate(state, plan));
    }
  }
  return options;
}
/** One-ply baseline uses the same legal sampler and evaluator as search. */
export function onePly(
  state: GameState,
  random: Random,
  samplesPerCard = 12,
): TurnPlan {
  const actor = state.playerOrder.indexOf(state.activePlayerId);
  return candidates(node(state), random, samplesPerCard).sort(
    (a, b) => b.value[actor]! - a.value[actor]!,
  )[0]!.plan;
}
function expand(
  parent: Node,
  random: Random,
): { plan: TurnPlan; node: Node } | undefined {
  const options = candidates(
    parent,
    random,
    parent.children.length === 0 ? 4 : 2,
  );
  const actor = parent.state.playerOrder.indexOf(parent.state.activePlayerId);
  options.sort((a, b) => b.value[actor]! - a.value[actor]!);
  if (!options.length) return undefined;
  // Explore the long tail as well as the heuristic's favourite. Always retain
  // pass at the first expansion so timing isn't lost behind card samples.
  const selected =
    parent.children.length === 0
      ? options.find((c) => c.plan.kind === "pass")!
      : random() < 0.18
        ? pick(options, random)
        : options[0]!;
  parent.seen.add(selected.key);
  const child = {
    plan: selected.plan,
    node: node(selected.state, selected.value),
  };
  parent.children.push(child);
  return child;
}
function select(parent: Node): { plan: TurnPlan; node: Node } {
  const actor = parent.state.playerOrder.indexOf(parent.state.activePlayerId);
  let best = parent.children[0]!;
  let bestScore = -Infinity;
  for (const child of parent.children) {
    const n = child.node;
    const q = n.visits ? n.total[actor]! / n.visits : n.prior[actor]!;
    const score =
      q +
      0.32 * Math.sqrt(Math.log(parent.visits + 2) / (n.visits + 1)) +
      (0.25 * n.prior[actor]!) / (n.visits + 1);
    if (score > bestScore) {
      best = child;
      bestScore = score;
    }
  }
  return best;
}
function rollout(state: GameState, random: Random): GameState {
  if (state.phase !== "turn") return state;
  // Small, epsilon-greedy candidate batch. Unlike the baseline this is deliberately
  // cheap; tree selection does the sustained lookahead.
  const options = candidates(node(state), random, 1);
  const actor = state.playerOrder.indexOf(state.activePlayerId);
  const choice =
    random() < 0.12
      ? pick(options, random)
      : options.sort((a, b) => b.value[actor]! - a.value[actor]!)[0]!;
  return choice.state;
}
/** Canonical public Standard position. RNG metadata and controller labels are
 * intentionally absent. Event/turn clocks are included to reject stale reuse. */
function stateKey(state: GameState): string {
  return JSON.stringify([
    state.activePlayerId,
    state.turnSequence,
    state.eventSequence,
    state.actionSequence,
    state.regions,
    state.regionCards,
    state.supply,
    state.consecutivePasses,
    state.lastSwap,
    state.playerOrder.map((id) => {
      const p = state.players[id]!;
      return [
        id,
        p.hand,
        p.court,
        p.negotiationDiscLocation,
        p.lastActionSequence,
      ];
    }),
  ]);
}
export class StandardBot {
  private roots = new Map<string, Node>();
  search(request: SearchRequest): SearchResult {
    const { budget } = request;
    if (
      !Number.isSafeInteger(budget.iterations) ||
      budget.iterations < 1 ||
      budget.iterations > 100000 ||
      !Number.isSafeInteger(budget.seed) ||
      (budget.timeMs !== undefined &&
        (!Number.isFinite(budget.timeMs) || budget.timeMs <= 0))
    )
      throw new Error("Invalid search budget");
    const start = performance.now();
    const state = reconstructStandard(request.observation, request.memory);
    const key = stateKey(state);
    let root: Node | undefined;
    const previous = this.roots.get(state.activePlayerId);
    // Reuse only an exact observed continuation, not a guessed human move.
    if (previous) {
      const pending = [previous];
      while (pending.length) {
        const n = pending.pop()!;
        if (
          n.state.turnSequence === state.turnSequence &&
          stateKey(n.state) === key
        ) {
          root = n;
          break;
        }
        if (n.state.turnSequence < state.turnSequence)
          pending.push(...n.children.map((c) => c.node));
      }
    }
    root ??= node(state);
    const random = seededRandom(budget.seed);
    const stats: SearchStats = {
      iterations: 0,
      elapsedMs: 0,
      nodes: 0,
      maxDepth: 0,
      horizon: state.playerOrder.length * 2 + 1,
      horizonVisits: 0,
      terminalVisits: 0,
      rootChoices: 0,
      reusedVisits: root.visits,
    };
    const limit = start + (budget.timeMs ?? Infinity);
    for (let i = 0; i < budget.iterations; i++) {
      if (i > 0 && performance.now() >= limit) break;
      let current = root;
      const path = [current];
      let depth = 0;
      while (current.state.phase === "turn" && depth < stats.horizon + 4) {
        const width = Math.max(
          2,
          Math.floor(1.6 * Math.sqrt(current.visits + 1)),
        );
        let child: ReturnType<typeof expand>;
        if (current.children.length < width) child = expand(current, random);
        if (!child && current.children.length) child = select(current);
        if (!child) break;
        const fresh = child.node.visits === 0;
        current = child.node;
        path.push(current);
        depth++;
        if (fresh) {
          stats.nodes++;
          // Extend a new path far enough to include the bot's next two
          // decisions after the two rollout turns. Keep each new node so these
          // replies can be revisited, rather than counting a lucky deep line.
          if (depth >= stats.horizon - 2) break;
        }
      }
      let leaf = current.state;
      for (let j = 0; j < 2 && leaf.phase === "turn"; j++) {
        leaf = rollout(leaf, random);
        depth++;
      }
      const value = evaluate(leaf);
      for (const n of path) {
        n.visits++;
        value.forEach((v, seat) => {
          n.total[seat]! += v;
        });
      }
      stats.iterations++;
      stats.maxDepth = Math.max(stats.maxDepth, depth);
      if (depth >= stats.horizon) stats.horizonVisits++;
      if (leaf.result) stats.terminalVisits++;
    }
    const actor = state.playerOrder.indexOf(state.activePlayerId);
    // A proven immediate win takes precedence over sampling noise.
    const winning = root.children.find(
      (c) => c.node.state.result && c.node.prior[actor] === 1,
    );
    const best =
      winning ??
      [...root.children].sort(
        (a, b) =>
          b.node.visits - a.node.visits ||
          b.node.total[actor]! / Math.max(1, b.node.visits) -
            a.node.total[actor]! / Math.max(1, a.node.visits),
      )[0];
    if (!best) throw new Error("Search produced no legal turn");
    stats.rootChoices = root.children.length;
    stats.elapsedMs = performance.now() - start;
    this.roots.set(state.activePlayerId, root);
    return {
      plan: best.plan,
      stats,
      explanation:
        best.plan.kind === "pass"
          ? "Pass to preserve cards and advance the current struggle when others also pass."
          : "Improve the court and regional balance while considering opponents’ replies.",
    };
  }
}
