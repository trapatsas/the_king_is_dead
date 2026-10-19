import { FACTIONS } from "../game/domain";
import type { GameState, GameResult } from "../game/domain";

export function terminalUtility(
  result: GameResult,
  seats: readonly string[],
): number[] {
  return seats.map((id) =>
    result.kind === "win"
      ? Number(result.winner === id)
      : result.contenders.includes(id)
        ? 1 / result.contenders.length
        : 0,
  );
}
function softmax(values: readonly number[], temperature = 1): number[] {
  const max = Math.max(...values);
  const weights = values.map((v) => Math.exp((v - max) / temperature));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((v) => v / sum);
}

/** Versioned hand-written leaf heuristic, not a calibrated win probability.
 * Physical control is certain; unresolved regions are softened by their margin,
 * track distance and remaining ability to intervene. Recomputed every node.
 */
export function evaluate(state: GameState): number[] {
  if (state.result) return terminalUtility(state.result, state.playerOrder);
  const players = state.playerOrder.map((id) => state.players[id]!);
  const remainingCards = players.reduce((sum, p) => sum + p.hand.length, 0);
  const power = [0, 0, 0];
  const unresolved = state.regionCards
    .filter((c) => c.faceUp)
    .sort((a, b) => a.slot - b.slot);
  // Distribution of additional instability, to combine the two victory routes.
  let instability = [1, 0, 0, 0];
  for (const region of Object.values(state.regions)) {
    if (region.control.kind === "faction")
      power[FACTIONS.indexOf(region.control.faction)]! +=
        1 + region.control.struggleIndex * 0.001;
  }
  unresolved.forEach((card, distance) => {
    const counts = FACTIONS.map(
      (f) => state.regions[card.regionId].followers[f],
    );
    const max = Math.max(...counts);
    const tie = counts.filter((n) => n === max).length > 1;
    const uncertainty =
      remainingCards === 0
        ? 0.02
        : 0.5 + Math.min(1.2, distance * 0.18 + remainingCards * 0.015);
    const tiedRisk = remainingCards === 0 ? Number(tie) : tie ? 0.62 : 0.08;
    const shares = softmax(counts, uncertainty);
    shares.forEach((share, f) => {
      power[f]! += (1 - tiedRisk) * share * (1 + card.slot * 0.001);
    });
    const next = [0, 0, 0, 0];
    instability.forEach((p, i) => {
      next[i]! += p * (1 - tiedRisk);
      next[Math.min(3, i + 1)]! += p * tiedRisk;
    });
    instability = next;
  });
  const invasionRisk = instability
    .slice(state.instabilityDiscsInFrance)
    .reduce((a, b) => a + b, 0);
  const factionChances = softmax(power, remainingCards === 0 ? 0.01 : 0.55);
  const coronation = players.map(() => 0);
  for (let f = 0; f < 3; f++) {
    const other = FACTIONS.map((_, i) => i).filter((i) => i !== f);
    const secondWeights = softmax(
      other.map((i) => power[i]!),
      0.7,
    );
    const scores = players.map((p) => {
      const second = other.reduce(
        (v, index, k) => v + p.court[FACTIONS[index]!] * secondWeights[k]!,
        0,
      );
      // Retaining a flexible action has option value; action timestamps settle
      // near-ties only. Exact terminal tie-breaks are always delegated to rules.
      return (
        p.court[FACTIONS[f]!] +
        second * 0.16 +
        p.hand.length * 0.22 -
        (p.lastActionSequence ?? 0) * 0.001
      );
    });
    softmax(scores, 0.7).forEach((value, i) => {
      coronation[i]! += factionChances[f]! * value;
    });
  }
  const invasion = softmax(
    players.map((p) => {
      const counts = FACTIONS.map((f) => p.court[f]).sort((a, b) => a - b);
      return (
        counts[0]! +
        (counts[1]! - counts[0]!) * 0.18 +
        (counts[2]! - counts[1]!) * 0.03 +
        p.hand.length * 0.17 +
        (p.lastActionSequence ?? 0) * 0.001
      );
    }),
    0.55,
  );
  // Reserve 0/1 for proven terminal losses/wins.
  return players.map(
    (_, i) =>
      0.01 +
      (1 - players.length * 0.01) *
        ((1 - invasionRisk) * coronation[i]! + invasionRisk * invasion[i]!),
  );
}
