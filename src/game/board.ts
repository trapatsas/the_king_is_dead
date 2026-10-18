import { FACTIONS, REGION_IDS, emptyFactionCounts } from "./domain";
import type { Faction, RegionId, RegionState } from "./domain";
import { freezeSnapshot } from "./immutable";

export const HOME_REGIONS: Readonly<Record<Faction, RegionId>> = freezeSnapshot(
  {
    scottish: "moray",
    welsh: "gwynedd",
    english: "essex",
  },
);

/** The user's approved undirected graph, not geographical inference. */
export const BOARD_EDGES: readonly (readonly [RegionId, RegionId])[] =
  freezeSnapshot([
    ["moray", "strathclyde"],
    ["strathclyde", "lancaster"],
    ["strathclyde", "northumbria"],
    ["lancaster", "northumbria"],
    ["lancaster", "gwynedd"],
    ["lancaster", "warwick"],
    ["northumbria", "warwick"],
    ["northumbria", "essex"],
    ["gwynedd", "warwick"],
    ["gwynedd", "devon"],
    ["warwick", "essex"],
    ["warwick", "devon"],
    ["essex", "devon"],
  ]);

export const ADJACENCY: Readonly<Record<RegionId, readonly RegionId[]>> =
  freezeSnapshot(
    Object.fromEntries(
      REGION_IDS.map((region) => [
        region,
        BOARD_EDGES.flatMap(([a, b]) =>
          a === region ? [b] : b === region ? [a] : [],
        ),
      ]),
    ) as Record<RegionId, RegionId[]>,
  );

export function areAdjacent(a: RegionId, b: RegionId): boolean {
  return ADJACENCY[a].includes(b);
}

/** Exposed separately so the pre-random home allocation is verifiable. */
export function createHomeRegions(): Readonly<Record<RegionId, RegionState>> {
  return freezeSnapshot(
    Object.fromEntries(
      REGION_IDS.map((id) => {
        const followers = emptyFactionCounts();
        for (const faction of FACTIONS) {
          if (HOME_REGIONS[faction] === id) followers[faction] = 2;
        }
        return [id, { id, followers, control: { kind: "unresolved" } }];
      }),
    ) as Record<RegionId, RegionState>,
  );
}
