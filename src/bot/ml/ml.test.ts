import { describe, expect, it } from "vitest";
import { createGame } from "../../game/setup";
import type { GameState } from "../../game/domain";
import { getObservation } from "../../game/visibility";
import { witnessedCards } from "../../app/botObservation";
import { InformedBot } from "../informed";
import { terminalUtility } from "../evaluation";
import { passPlan, simulate } from "../simulation";
import { turnEngine } from "../../game/turns";
import { encodePosition, FEATURE_COUNT, restoreValues } from "./features";
import { createValueModel, maskedValues, sha256 } from "./model";
import { evaluateLearned, MlBot } from "./mlBot";

function session(count = 2, prefix = "p") {
  return createGame({
    mode: "standard",
    seed: `ml-test-${count}`,
    players: Array.from({ length: count }, (_, i) => ({
      id: `${prefix}${i}`,
      controller: "algorithmic" as const,
      botStrategy: "informed" as const,
    })),
  });
}
export async function fixtureModel() {
  const bytes = new Uint8Array((FEATURE_COUNT * 3 + 3) * 4);
  const view = new DataView(bytes.buffer);
  [1, 2, 100].forEach((v, i) =>
    view.setFloat32((FEATURE_COUNT * 3 + i) * 4, v, true),
  );
  const manifest = {
    formatVersion: 1,
    modelId: "fixture",
    featureVersion: "standard-v1",
    inputSize: FEATURE_COUNT,
    supportedSeats: [2, 3],
    weightsFile: "weights.bin",
    weightsSha256: await sha256(bytes),
    layers: [{ input: FEATURE_COUNT, output: 3, activation: "linear" }],
    learnedWeight: 1,
    training: {},
  };
  return createValueModel(manifest, bytes);
}

describe("ML features and inference", () => {
  it.each([2, 3])(
    "has the frozen layout and clockwise perspective for %i seats",
    (count) => {
      const a = session(count),
        renamed = session(count, "renamed");
      const encoded = encodePosition(a.state);
      expect(encoded.features).toHaveLength(474);
      expect([...encoded.features].every(Number.isFinite)).toBe(true);
      expect(encoded.features[176]).toBe(1);
      expect(encoded.features[176 + 4 + 6]).toBe(1); // two Assemble copies / 2
      expect(encoded.features[251 + 8 + count - 2]).toBe(1);
      expect(encoded.features.slice(275).every((v) => v === 0)).toBe(true);
      expect(encodePosition(renamed.state).features).toEqual(encoded.features);
      if (count === 2)
        expect(encoded.features.slice(226, 251).every((v) => v === 0)).toBe(
          true,
        );
      const active = a.state.playerOrder.indexOf(a.state.activePlayerId);
      expect(encoded.canonicalToPlayer).toEqual([
        active,
        (active + 1) % count,
        count === 3 ? (active + 2) % 3 : -1,
      ]);
      const restored = restoreValues([0.2, 0.3, 0.5], encoded);
      expect(restored[active]).toBe(0.2);
      const hidden = {
        ...a.state,
        initialSeed: "other",
        rngState: { ...a.state.rngState, seed: "other" },
      };
      expect(encodePosition(hidden).features).toEqual(encoded.features);
    },
  );
  it("retains swap directions and the never-acted distinction", () => {
    const state = session(3).state;
    const swap = {
      playerId: state.activePlayerId,
      actionSequence: 0,
      effectiveCard: "manoeuvre" as const,
      transfers: [
        {
          from: "moray" as const,
          to: "essex" as const,
          faction: "welsh" as const,
          count: 1,
        },
      ],
    };
    const one = encodePosition({ ...state, lastSwap: swap });
    const two = encodePosition({
      ...state,
      lastSwap: {
        ...swap,
        transfers: [{ ...swap.transfers[0]!, from: "essex", to: "moray" }],
      },
    });
    expect(one.features).not.toEqual(two.features);
    const p = state.players[state.activePlayerId]!;
    const acted = encodePosition({
      ...state,
      actionSequence: 1,
      players: { ...state.players, [p.id]: { ...p, lastActionSequence: 1 } },
    });
    expect(acted.features[176 + 21]).toBe(1);
    expect(encodePosition(state).features[176 + 21]).toBe(0);
  });
  it("masks padding, restores the parent actor and bypasses terminal inference", async () => {
    const model = await fixtureModel();
    const s = session(2).state;
    const after = simulate(s, passPlan(s));
    const values = evaluateLearned(after, model);
    const parent = s.playerOrder.indexOf(s.activePlayerId);
    expect(values[parent]).toBeCloseTo(
      Math.exp(2) / (Math.exp(1) + Math.exp(2)),
    );
    expect(maskedValues([1, 2, 100], 2)[2]).toBe(0);
    let terminal: GameState = s;
    while (terminal.phase === "turn")
      terminal = simulate(terminal, passPlan(terminal));
    expect(
      evaluateLearned(terminal, {
        ...model,
        predictBatch: () => {
          throw new Error("Must not infer");
        },
      }),
    ).toEqual(terminalUtility(terminal.result!, terminal.playerOrder));
  });
  it("rejects corrupt artifacts", async () => {
    const model = await fixtureModel();
    await expect(
      createValueModel(model.manifest, new Uint8Array(12)),
    ).rejects.toThrow(/integrity/);
    expect(() => model.predictBatch(new Float32Array(10), 1)).toThrow(/batch/);
  });
  it.each([2, 3])(
    "keeps the zero-weight Informed control and produces legal deterministic ML plans at %i seats",
    async (count) => {
      const model = await fixtureModel(),
        s = session(count);
      const req = {
        observation: getObservation(s.state, s.state.activePlayerId),
        memory: witnessedCards(s),
        budget: { iterations: 16, seed: 2026 },
      };
      const control = new InformedBot().search(req);
      expect(new MlBot(model, 0).search(req).plan).toEqual(control.plan);
      const first = new MlBot(model).search(req),
        again = new MlBot(model).search(req);
      expect(first.plan).toEqual(again.plan);
      expect(() => turnEngine.commitTurn(s.state, first.plan)).not.toThrow();
    },
  );
});
