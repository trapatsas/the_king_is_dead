import type { RngState } from "./domain";

const UINT32_RANGE = 0x1_0000_0000;

export function assertRngState(rng: RngState): void {
  if (
    rng.algorithm !== "mulberry32-v1" ||
    typeof rng.seed !== "string" ||
    !Number.isInteger(rng.state) ||
    rng.state < 0 ||
    rng.state >= UINT32_RANGE ||
    !Number.isSafeInteger(rng.draws) ||
    rng.draws < 0
  ) {
    throw new Error("Invalid mulberry32-v1 RNG state");
  }
}

/** FNV-1a over UTF-16 code units, with an explicit algorithm/version. */
export function createRng(seed: string): RngState {
  if (typeof seed !== "string") throw new Error("Seed must be a string");
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 0x01000193) >>> 0;
  }
  return { algorithm: "mulberry32-v1", seed, state: hash, draws: 0 };
}

export function nextUint32(rng: RngState): {
  readonly value: number;
  readonly rng: RngState;
} {
  assertRngState(rng);
  if (rng.draws === Number.MAX_SAFE_INTEGER) {
    throw new Error("RNG draw counter exhausted");
  }
  const state = (rng.state + 0x6d2b79f5) >>> 0;
  let mixed = Math.imul(state ^ (state >>> 15), state | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return {
    value: (mixed ^ (mixed >>> 14)) >>> 0,
    rng: { ...rng, state, draws: rng.draws + 1 },
  };
}

/** Rejection sampling avoids modulo bias, including when choosing a seat. */
export function randomInt(
  rng: RngState,
  upperExclusive: number,
): { readonly value: number; readonly rng: RngState } {
  assertRngState(rng);
  if (
    !Number.isInteger(upperExclusive) ||
    upperExclusive < 1 ||
    upperExclusive > UINT32_RANGE
  ) {
    throw new Error("Random bound must be an integer in [1, 2^32]");
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % upperExclusive);
  let next = nextUint32(rng);
  while (next.value >= limit) next = nextUint32(next.rng);
  return { value: next.value % upperExclusive, rng: next.rng };
}

export function shuffle<T>(
  values: readonly T[],
  initialRng: RngState,
): { readonly values: T[]; readonly rng: RngState } {
  assertRngState(initialRng);
  const shuffled = [...values];
  let rng = initialRng;
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const choice = randomInt(rng, index + 1);
    rng = choice.rng;
    // Both indices are within the array's bounds by construction.
    [shuffled[index], shuffled[choice.value]] = [
      shuffled[choice.value]!,
      shuffled[index]!,
    ];
  }
  return { values: shuffled, rng };
}
