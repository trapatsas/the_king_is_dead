import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FACTIONS } from "../game/domain";
import type { Faction, GameState } from "../game/domain";
import { turnEngine } from "../game/turns";
import { resolvedFixture } from "../test/standardFixtures";
import { setupSession } from "../test/turnFixtures";
import { coronationHarvest, lockedCoronationFaction } from "./coronation";
import { InformedBot } from "./informed";
import { reconstructStandard } from "./observation";
import type { SearchRequest } from "./search";
import { simulate } from "./simulation";
import { trainingBranchPlans } from "./trainingBranches";
import { MlBot } from "./ml/mlBot";
import type { ModelManifest, ValueModel } from "./ml/model";

const request = JSON.parse(
  readFileSync(
    new URL("./fixtures/coronation-trap-turn-33.json", import.meta.url),
    "utf8",
  ),
) as SearchRequest;

function rotatedState(faction: Faction): GameState {
  const state = structuredClone(
    reconstructStandard(request.observation, request.memory),
  );
  const shift = FACTIONS.indexOf(faction);
  const rotate = (f: Faction) => FACTIONS[(FACTIONS.indexOf(f) + shift) % 3]!;
  const counts = [
    state.supply,
    state.removedFromGame,
    state.controlDiscsInSupply,
    ...Object.values(state.players).map((p) => p.court),
    ...Object.values(state.regions).map((r) => r.followers),
  ];
  for (const c of counts) {
    const old = { ...c };
    for (const f of FACTIONS)
      (c as Record<Faction, number>)[rotate(f)] = old[f];
  }
  for (const region of Object.values(state.regions))
    if (region.control.kind === "faction")
      (region.control as { faction: Faction }).faction = rotate(
        region.control.faction,
      );
  if (state.lastSwap)
    for (const transfer of state.lastSwap.transfers)
      (transfer as { faction: Faction }).faction = rotate(transfer.faction);
  return state;
}

describe("proven Coronation endgames", () => {
  it.each(FACTIONS)(
    "collects scarce %s support and preserves its production cards",
    (faction) => {
      const state = rotatedState(faction);
      expect(lockedCoronationFaction(state)).toBe(faction);
      const plan = coronationHarvest(state, false)!;
      expect(plan).toMatchObject({ kind: "card", summon: { faction } });
      if (plan.kind !== "card") throw new Error("Expected harvest");
      expect(plan.effect.kind).toBe("no-effect");
      const next = turnEngine.commitTurn(state, plan).state;
      expect(next.players.ML2!.court[faction]).toBe(2);
      expect(next.regions.northumbria.followers[faction]).toBe(0);
    },
  );
  it("creates and collects support without leaving a gift when the board is empty", () => {
    const state = rotatedState("scottish");
    const changed = {
      ...state,
      supply: { ...state.supply, scottish: state.supply.scottish + 1 },
      regions: {
        ...state.regions,
        northumbria: {
          ...state.regions.northumbria,
          followers: { ...state.regions.northumbria.followers, scottish: 0 },
        },
      },
    };
    const plan = coronationHarvest(changed, false)!;
    expect(plan).toMatchObject({
      kind: "card",
      effect: { effectiveCard: "assemble" },
      summon: { faction: "scottish" },
    });
    expect(
      turnEngine.commitTurn(changed, plan).state.regions.northumbria.followers
        .scottish,
    ).toBe(0);
    expect(coronationHarvest(changed, true)).toBeUndefined();
  });
  it("requires an uncatchable regional lead and rules out a possible Invasion", () => {
    const unresolved = setupSession(3);
    expect(lockedCoronationFaction(unresolved.state)).toBeNull();
    const tied = resolvedFixture(unresolved, {
      moray: "scottish",
      strathclyde: "scottish",
      lancaster: "scottish",
      gwynedd: "welsh",
      warwick: "welsh",
      essex: "english",
    });
    expect(lockedCoronationFaction(tied.state)).toBeNull();
    const invasion = resolvedFixture(unresolved, {
      moray: "scottish",
      strathclyde: "scottish",
      lancaster: "scottish",
      gwynedd: "scottish",
      warwick: "unstable",
      essex: "unstable",
      devon: "welsh",
    });
    expect(lockedCoronationFaction(invasion.state)).toBeNull();
  });
  it("intervenes in the recorded losing pass even with only one search iteration", () => {
    const state = reconstructStandard(request.observation, request.memory);
    const plan = new InformedBot().search({
      ...request,
      budget: { iterations: 1, seed: 2026 },
    }).plan;
    expect(plan).toMatchObject({
      kind: "card",
      summon: { faction: "scottish" },
    });
    expect(() => turnEngine.commitTurn(state, plan)).not.toThrow();
  });
  it("keeps untrusted learned predictions out of the proven endgame", () => {
    const model: ValueModel = {
      manifest: JSON.parse(
        readFileSync(
          new URL(
            "../../public/models/linear-v2/manifest.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ) as ModelManifest,
      predictBatch: () => {
        throw new Error("Must use faction-aware evaluation");
      },
    };
    const bot = new MlBot(model);
    expect(bot.search(request).plan).toMatchObject({
      kind: "card",
      summon: { faction: "scottish" },
    });
  });
  it("branches into legal alternate summons and a distinct passing continuation", () => {
    const state = reconstructStandard(request.observation, request.memory);
    const recorded = trainingBranchPlans(
      state,
      {
        kind: "pass",
        playerId: state.activePlayerId,
        baseTurnSequence: state.turnSequence,
      },
      4,
    ).find((p) => p.kind === "card")!;
    const plans = trainingBranchPlans(state, recorded, 4);
    expect(plans).toHaveLength(4);
    expect(plans.filter((p) => p.kind === "pass")).toHaveLength(1);
    expect(
      new Set(
        plans.flatMap((p) =>
          p.kind === "card" && p.summon.kind === "follower"
            ? [p.summon.faction]
            : [],
        ),
      ).size,
    ).toBe(3);
    for (const plan of plans)
      expect(() => turnEngine.commitTurn(state, plan)).not.toThrow();
    expect(plans.map((p) => simulate(state, p))).toHaveLength(4);
  });
});
