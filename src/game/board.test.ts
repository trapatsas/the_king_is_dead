import { describe, expect, it } from "vitest";
import {
  ADJACENCY,
  BOARD_EDGES,
  areAdjacent,
  createHomeRegions,
} from "./board";
import { FACTIONS, REGION_IDS, totalFollowers } from "./domain";

/** Independent transcription of the rulebook's approved adjacency table. */
const expectedBorders = {
  moray: ["strathclyde"],
  strathclyde: ["lancaster", "moray", "northumbria"],
  lancaster: ["gwynedd", "northumbria", "strathclyde", "warwick"],
  northumbria: ["essex", "lancaster", "strathclyde", "warwick"],
  gwynedd: ["devon", "lancaster", "warwick"],
  warwick: ["devon", "essex", "gwynedd", "lancaster", "northumbria"],
  essex: ["devon", "northumbria", "warwick"],
  devon: ["essex", "gwynedd", "warwick"],
};

describe("the user-approved board", () => {
  it("has exactly the 13 approved undirected edges, without self-loops or duplicates", () => {
    expect(BOARD_EDGES).toHaveLength(13);
    expect(
      new Set(BOARD_EDGES.map((edge) => [...edge].sort().join("/"))).size,
    ).toBe(13);
    for (const region of REGION_IDS) {
      expect([...ADJACENCY[region]].sort()).toEqual(expectedBorders[region]);
      expect(areAdjacent(region, region)).toBe(false);
      for (const other of REGION_IDS) {
        expect(areAdjacent(region, other)).toBe(areAdjacent(other, region));
      }
    }
    expect(REGION_IDS.map((id) => ADJACENCY[id].length)).toEqual([
      1, 3, 4, 4, 3, 5, 3, 3,
    ]);
  });

  it("places exactly six home followers before any random top-up", () => {
    const regions = createHomeRegions();
    expect(regions.moray.followers).toEqual({
      scottish: 2,
      welsh: 0,
      english: 0,
    });
    expect(regions.gwynedd.followers).toEqual({
      scottish: 0,
      welsh: 2,
      english: 0,
    });
    expect(regions.essex.followers).toEqual({
      scottish: 0,
      welsh: 0,
      english: 2,
    });
    for (const id of [
      "strathclyde",
      "lancaster",
      "northumbria",
      "warwick",
      "devon",
    ] as const) {
      expect(totalFollowers(regions[id].followers)).toBe(0);
    }
    for (const faction of FACTIONS) {
      expect(
        REGION_IDS.reduce((sum, id) => sum + regions[id].followers[faction], 0),
      ).toBe(2);
    }
    expect(
      REGION_IDS.every((id) => regions[id].control.kind === "unresolved"),
    ).toBe(true);
  });

  it("returns fresh home allocations and protects the approved graph from mutation", () => {
    expect(createHomeRegions()).not.toBe(createHomeRegions());
    expect(Object.isFrozen(BOARD_EDGES)).toBe(true);
    expect(Object.isFrozen(BOARD_EDGES[0])).toBe(true);
    expect(Object.isFrozen(ADJACENCY.warwick)).toBe(true);
    expect(Reflect.set(ADJACENCY.warwick, 0, "moray")).toBe(false);
    expect(ADJACENCY.warwick).not.toContain("moray");
  });
});
