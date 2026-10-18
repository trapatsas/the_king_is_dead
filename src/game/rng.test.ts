import { describe, expect, it } from "vitest";
import {
  assertRngState,
  createRng,
  nextUint32,
  randomInt,
  shuffle,
} from "./rng";
import type { RngState } from "./domain";

describe("serializable deterministic randomness", () => {
  it("hashes string seeds consistently, including empty and Unicode seeds", () => {
    expect(createRng("").state).toBe(0x811c9dc5);
    expect(createRng("a").state).toBe(0xe40c292c);
    expect(createRng("crown")).toEqual(createRng("crown"));
    expect(createRng("crown").state).not.toBe(createRng("crowns").state);
    expect(createRng("王冠 👑")).toEqual(createRng("王冠 👑"));
  });

  it("matches a fixed mulberry32 reference vector and leaves its input alone", () => {
    let rng: RngState = Object.freeze({
      algorithm: "mulberry32-v1",
      seed: "reference",
      state: 0,
      draws: 0,
    });
    const original = rng;
    const values: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const next = nextUint32(rng);
      values.push(next.value);
      rng = next.rng;
    }
    expect(values).toEqual([
      1144304738, 1416247, 958946056, 627933444, 2007157716,
    ]);
    expect(original.state).toBe(0);
    expect(original.draws).toBe(0);
    expect(rng.draws).toBe(5);
  });

  it("can resume at the exact saved cursor", () => {
    const cursor = nextUint32(createRng("resume")).rng;
    const loaded: RngState = JSON.parse(JSON.stringify(cursor));
    expect(nextUint32(loaded)).toEqual(nextUint32(cursor));
  });

  it("rejects samples above the unbiased bound before returning a choice", () => {
    // Reference samples 6–8 exceed 2^31+1; sample 9 is the first accepted value.
    const rng: RngState = {
      algorithm: "mulberry32-v1",
      seed: "rejection",
      state: 567894473,
      draws: 5,
    };
    const choice = randomInt(rng, 0x8000_0001);
    expect(choice.value).toBe(1958536065);
    expect(choice.rng.draws).toBe(9);
    expect(rng.draws).toBe(5);
  });

  it("shuffles by copying and preserves the complete multiset", () => {
    const source = Object.freeze(["a", "a", "b", "c", "d"]);
    const rng = createRng("shuffle");
    const first = shuffle(source, rng);
    expect(first).toEqual(shuffle(source, rng));
    expect(first.values).not.toBe(source);
    expect([...first.values].sort()).toEqual([...source].sort());
    expect(source).toEqual(["a", "a", "b", "c", "d"]);
    expect(first.rng.draws).toBe(4);
    expect(shuffle([], rng)).toEqual({ values: [], rng });
    expect(shuffle(["a"], rng)).toEqual({ values: ["a"], rng });
  });

  it.each([0, -1, 1.5, NaN, Infinity, 0x1_0000_0001])(
    "rejects invalid random bound %s",
    (bound) => {
      expect(() => randomInt(createRng("bounds"), bound)).toThrow(
        "Random bound",
      );
    },
  );

  it.each([-1, 0x1_0000_0000, 1.5, NaN])(
    "rejects invalid cursor state %s",
    (state) => {
      expect(() => assertRngState({ ...createRng("bad"), state })).toThrow(
        "RNG state",
      );
    },
  );

  it("rejects invalid cursor counters and refuses to overflow a safe integer", () => {
    for (const draws of [-1, 0.5, Infinity]) {
      expect(() => nextUint32({ ...createRng("bad"), draws })).toThrow(
        "RNG state",
      );
    }
    expect(() =>
      nextUint32({ ...createRng("overflow"), draws: Number.MAX_SAFE_INTEGER }),
    ).toThrow("exhausted");
  });
});
