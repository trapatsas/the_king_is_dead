import { describe, expect, it } from "vitest";
import { followers } from "../test/turnFixtures";
import type {
  Faction,
  FactionPower,
  GameResult,
  PlotSupport,
  VictoryMethod,
} from "./domain";
import { copyChoice } from "./plans";
import { enumerateFactionRankings, evaluateScoring } from "./scoring";
import type { ScoringPlayer, ScoringPosition } from "./scoring";

const player = (
  playerId: string,
  scottish: number,
  welsh: number,
  english: number,
  lastActionSequence: number | null = null,
): ScoringPlayer => ({
  playerId,
  court: followers(scottish, welsh, english),
  lastActionSequence,
});
const normalPower = (): Record<Faction, FactionPower> => ({
  scottish: { wins: 4, lastWonStruggle: 8 },
  welsh: { wins: 3, lastWonStruggle: 7 },
  english: { wins: 1, lastWonStruggle: 6 },
});
const unwonPower = (): Record<Faction, FactionPower> => ({
  scottish: { wins: 6, lastWonStruggle: 8 },
  welsh: { wins: 0, lastWonStruggle: null },
  english: { wins: 0, lastWonStruggle: null },
});
const position = (
  method: VictoryMethod,
  players: readonly ScoringPlayer[],
  plot: PlotSupport | null = null,
  factionPower = normalPower(),
): ScoringPosition => ({ method, players, plot, factionPower });
const criteria = (result: GameResult): readonly string[] =>
  result.details.cases[0]?.steps.map((step) => step.criterion) ?? [];

describe("Invasion scoring", () => {
  it("compares complete sets before any action timing", () => {
    const result = evaluateScoring(
      position("invasion", [
        player("p1", 3, 2, 4, 1),
        player("p2", 5, 1, 8, 9),
        player("p3", 1, 1, 1, 3),
      ]),
    );
    expect(result).toMatchObject({
      kind: "win",
      winner: "p1",
      method: "invasion",
    });
    expect(criteria(result)).toEqual(["complete-sets"]);
    expect(result.details.players.map((entry) => entry.completeSets)).toEqual([
      2, 1, 1,
    ]);
  });

  it("compares latest actions only among players tied for most sets", () => {
    const result = evaluateScoring(
      position("invasion", [
        player("p1", 2, 2, 2, 7),
        player("p2", 3, 2, 2, 3),
        player("p3", 1, 3, 1, 9),
      ]),
    );
    expect(result).toMatchObject({ kind: "win", winner: "p1" });
    expect(criteria(result)).toEqual(["complete-sets", "latest-action"]);
    expect(
      result.details.cases[0]?.steps[1]?.values.map((entry) => entry.playerId),
    ).toEqual(["p1", "p2"]);
  });

  it("prefers a tied player who acted to one who never acted", () => {
    expect(
      evaluateScoring(
        position("invasion", [player("p1", 1, 1, 1), player("p2", 1, 1, 1, 1)]),
      ),
    ).toMatchObject({ kind: "win", winner: "p2" });
  });

  it("draws when the tied set leaders never acted, excluding weaker courts", () => {
    const result = evaluateScoring(
      position("invasion", [
        player("p1", 1, 1, 1),
        player("p2", 2, 1, 1),
        player("p3", 4, 0, 4, 2),
      ]),
    );
    expect(result).toMatchObject({ kind: "draw", contenders: ["p1", "p2"] });
    expect(result.kind === "draw" ? result.reason : "").toContain(
      "none has played",
    );
    expect(result.details.cases[0]?.outcome).toEqual({
      kind: "draw",
      contenders: ["p1", "p2"],
      reason: "tied-never-acted",
    });
  });

  it("permits a no-action zero-set draw", () => {
    expect(
      evaluateScoring(
        position("invasion", [player("p1", 2, 0, 0), player("p2", 0, 2, 0)]),
      ),
    ).toMatchObject({ kind: "draw", contenders: ["p1", "p2"] });
  });

  it("counts Plot's virtual follower toward a completed set without changing the court", () => {
    const input = position(
      "invasion",
      [player("p1", 1, 1, 0), player("p2", 1, 0, 0)],
      { playerId: "p1", faction: "english" },
    );
    const before = JSON.stringify(input);
    const result = evaluateScoring(input);
    expect(result).toMatchObject({ kind: "win", winner: "p1" });
    expect(result.details.players[0]).toMatchObject({
      court: followers(1, 1),
      scoringCourt: followers(1, 1, 1),
      completeSets: 1,
    });
    expect(JSON.stringify(input)).toBe(before);
  });

  it("does not use Plot's Coronation override in Invasion", () => {
    const result = evaluateScoring(
      position(
        "invasion",
        [player("p1", 1, 1, 1, 1), player("p2", 1, 1, 1, 10)],
        { playerId: "p1", faction: "scottish" },
      ),
    );
    expect(result).toMatchObject({ kind: "win", winner: "p2" });
    expect(criteria(result)).toEqual(["complete-sets", "latest-action"]);
  });
});

describe("Coronation support and action timing", () => {
  it("compares leading support before other factions or timing", () => {
    const result = evaluateScoring(
      position("coronation", [
        player("p1", 3, 0, 0, 99),
        player("p2", 2, 8, 2),
      ]),
    );
    expect(result).toMatchObject({ kind: "win", winner: "p1" });
    expect(criteria(result)).toEqual(["leading-faction"]);
  });

  it("compares the second faction only among the tied leading candidates", () => {
    const result = evaluateScoring(
      position("coronation", [
        player("p1", 2, 2, 0, 1),
        player("p2", 2, 3, 0, 4),
        player("p3", 1, 9, 0),
      ]),
    );
    expect(result).toMatchObject({ kind: "win", winner: "p2" });
    expect(criteria(result)).toEqual(["leading-faction", "second-faction"]);
    expect(
      result.details.cases[0]?.steps[1]?.values.map((entry) => entry.playerId),
    ).toEqual(["p1", "p2"]);
  });

  it("compares final action times and ignores support for the third faction", () => {
    const result = evaluateScoring(
      position("coronation", [
        player("p1", 2, 2, 8, 4),
        player("p2", 2, 2, 0, 2),
      ]),
    );
    expect(result).toMatchObject({ kind: "win", winner: "p2" });
    expect(criteria(result)).toEqual([
      "leading-faction",
      "second-faction",
      "earliest-final-action",
    ]);
  });

  it("counts never acted as earlier than any committed action", () => {
    expect(
      evaluateScoring(
        position("coronation", [
          player("p1", 2, 2, 0),
          player("p2", 2, 2, 8, 1),
        ]),
      ),
    ).toMatchObject({ kind: "win", winner: "p1" });
  });

  it("draws among multiple tied never-acted players, excluding an acted player", () => {
    const result = evaluateScoring(
      position("coronation", [
        player("p1", 2, 2, 0),
        player("p2", 2, 2, 1),
        player("p3", 2, 2, 2, 3),
      ]),
    );
    expect(result).toMatchObject({ kind: "draw", contenders: ["p1", "p2"] });
    expect(result.kind === "draw" ? result.reason : "").toContain(
      "none has played",
    );
  });

  it("uses latest won slot to rank factions tied on region count", () => {
    const power = {
      scottish: { wins: 3, lastWonStruggle: 7 },
      welsh: { wins: 3, lastWonStruggle: 8 },
      english: { wins: 2, lastWonStruggle: 6 },
    };
    const result = evaluateScoring(
      position(
        "coronation",
        [player("p1", 8, 0, 0), player("p2", 0, 2, 0)],
        null,
        power,
      ),
    );
    expect(result).toMatchObject({ kind: "win", winner: "p2" });
    expect(result.details.cases[0]?.ranking).toEqual([
      "welsh",
      "scottish",
      "english",
    ]);
  });
});

describe("Plot in Coronation", () => {
  it("includes the virtual follower in the leading-faction comparison", () => {
    const result = evaluateScoring(
      position(
        "coronation",
        [player("p1", 1, 0, 0, 9), player("p2", 1, 2, 0)],
        { playerId: "p1", faction: "scottish" },
      ),
    );
    expect(result).toMatchObject({ kind: "win", winner: "p1" });
    expect(criteria(result)).toEqual(["leading-faction"]);
  });

  it("includes the virtual follower in the second-faction comparison", () => {
    const result = evaluateScoring(
      position(
        "coronation",
        [player("p1", 2, 0, 0, 9), player("p2", 2, 0, 2)],
        { playerId: "p1", faction: "welsh" },
      ),
    );
    expect(result).toMatchObject({ kind: "win", winner: "p1" });
    expect(criteria(result)).toEqual(["leading-faction", "second-faction"]);
  });

  it("does not override a loss in leading support", () => {
    const result = evaluateScoring(
      position(
        "coronation",
        [player("p1", 0, 9, 0), player("p2", 1, 0, 0, 1)],
        { playerId: "p1", faction: "english" },
      ),
    );
    expect(result).toMatchObject({ kind: "win", winner: "p2" });
    expect(criteria(result)).toEqual(["leading-faction"]);
  });

  it("does not override a loss in second-faction support", () => {
    const result = evaluateScoring(
      position(
        "coronation",
        [player("p1", 2, 0, 0), player("p2", 2, 1, 0, 1)],
        { playerId: "p1", faction: "english" },
      ),
    );
    expect(result).toMatchObject({ kind: "win", winner: "p2" });
    expect(criteria(result)).toEqual(["leading-faction", "second-faction"]);
  });

  it("overrides timing only after its owner survives both support comparisons", () => {
    const result = evaluateScoring(
      position(
        "coronation",
        [player("p1", 2, 2, 0, 9), player("p2", 2, 2, 3)],
        { playerId: "p1", faction: "english" },
      ),
    );
    expect(result).toMatchObject({ kind: "win", winner: "p1" });
    expect(criteria(result)).toEqual([
      "leading-faction",
      "second-faction",
      "plot-override",
    ]);
  });

  it("uses normal timing when Plot's owner has already been eliminated", () => {
    const result = evaluateScoring(
      position(
        "coronation",
        [
          player("p1", 1, 0, 0),
          player("p2", 2, 2, 0, 4),
          player("p3", 2, 2, 0, 1),
        ],
        { playerId: "p1", faction: "welsh" },
      ),
    );
    expect(result).toMatchObject({ kind: "win", winner: "p3" });
    expect(criteria(result)).toEqual([
      "leading-faction",
      "second-faction",
      "earliest-final-action",
    ]);
  });
});

describe("unwon faction permutations", () => {
  it("enumerates both second-faction orders without inventing a ranking", () => {
    expect(enumerateFactionRankings(unwonPower())).toEqual([
      ["scottish", "welsh", "english"],
      ["scottish", "english", "welsh"],
    ]);
    const zero = {
      scottish: { wins: 0, lastWonStruggle: null },
      welsh: { wins: 0, lastWonStruggle: null },
      english: { wins: 0, lastWonStruggle: null },
    };
    expect(enumerateFactionRankings(zero)).toHaveLength(6);
    expect(
      new Set(
        enumerateFactionRankings(zero).map((ranking) => ranking.join("/")),
      ).size,
    ).toBe(6);
  });

  it("declares a leading-support winner agreed by every valid ordering", () => {
    const result = evaluateScoring(
      position(
        "coronation",
        [player("p1", 2, 0, 0), player("p2", 1, 3, 3)],
        null,
        unwonPower(),
      ),
    );
    expect(result).toMatchObject({ kind: "win", winner: "p1" });
    expect(result.details.cases).toHaveLength(2);
    expect(
      result.details.cases.every(
        (entry) =>
          entry.outcome.kind === "win" && entry.outcome.winner === "p1",
      ),
    ).toBe(true);
  });

  it("declares an agreed second-support winner despite the unwon faction tie", () => {
    expect(
      evaluateScoring(
        position(
          "coronation",
          [player("p1", 2, 2, 2), player("p2", 2, 1, 1)],
          null,
          unwonPower(),
        ),
      ),
    ).toMatchObject({ kind: "win", winner: "p1" });
  });

  it("draws when the valid orderings select different unique winners", () => {
    const result = evaluateScoring(
      position(
        "coronation",
        [player("p1", 2, 3, 0), player("p2", 2, 0, 3)],
        null,
        unwonPower(),
      ),
    );
    expect(result).toMatchObject({
      kind: "draw",
      contenders: ["p1", "p2"],
      rankingCases: [
        ["scottish", "welsh", "english"],
        ["scottish", "english", "welsh"],
      ],
    });
    expect(result.details.cases.map((entry) => entry.outcome)).toEqual([
      { kind: "win", winner: "p1", criterion: "second-faction" },
      { kind: "win", winner: "p2", criterion: "second-faction" },
    ]);
  });

  it("draws if one ordering gives a unique winner while another remains tied", () => {
    const result = evaluateScoring(
      position(
        "coronation",
        [player("p1", 2, 1, 0), player("p2", 2, 0, 0)],
        null,
        unwonPower(),
      ),
    );
    expect(result).toMatchObject({ kind: "draw", contenders: ["p1", "p2"] });
    expect(result.details.cases.map((entry) => entry.outcome.kind)).toEqual([
      "win",
      "draw",
    ]);
  });

  it("draws if every ordering leaves the same never-acted tie", () => {
    const result = evaluateScoring(
      position(
        "coronation",
        [player("p1", 2, 0, 0), player("p2", 2, 0, 0)],
        null,
        unwonPower(),
      ),
    );
    expect(result).toMatchObject({ kind: "draw", contenders: ["p1", "p2"] });
    expect(
      result.details.cases.every((entry) => entry.outcome.kind === "draw"),
    ).toBe(true);
  });

  it("uses one global Plot choice across every ranking case", () => {
    const result = evaluateScoring(
      position(
        "coronation",
        [player("p1", 2, 0, 0), player("p2", 2, 0, 1)],
        { playerId: "p1", faction: "welsh" },
        unwonPower(),
      ),
    );
    expect(result).toMatchObject({ kind: "draw", contenders: ["p1", "p2"] });
    expect(result.details.players[0]?.scoringCourt).toEqual(followers(2, 1, 0));
    expect(result.details.cases.map((entry) => entry.outcome)).toMatchObject([
      { winner: "p1" },
      { winner: "p2" },
    ]);
  });
});

describe("deterministic scoring contract", () => {
  it.each(["invasion", "coronation"] as const)(
    "never uses player iteration order in %s outcomes or explanations",
    (method) => {
      const players = [
        player("p3", 2, 0, 3),
        player("p1", 2, 3, 0),
        player("p2", 2, 1, 1),
      ];
      const base = position(method, players, null, unwonPower());
      const expected = evaluateScoring(base);
      for (const order of [
        players.slice().reverse(),
        [players[1]!, players[2]!, players[0]!],
        [players[2]!, players[0]!, players[1]!],
      ]) {
        expect(evaluateScoring({ ...base, players: order })).toEqual(expected);
      }
    },
  );

  it("leaves input mutable/unmodified, freezes results, and survives JSON round trips", () => {
    const input = position(
      "coronation",
      [player("p1", 2, 3, 0), player("p2", 2, 0, 3)],
      null,
      unwonPower(),
    );
    const before = JSON.stringify(input);
    const result = evaluateScoring(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(input.factionPower.scottish)).toBe(false);
    expect(Object.isFrozen(input.players)).toBe(false);
    expect(Object.isFrozen(result.details.cases)).toBe(true);
    expect(
      Reflect.set(result.details.players[0]?.scoringCourt ?? {}, "welsh", 999),
    ).toBe(false);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(evaluateScoring(copyChoice(input))).toEqual(result);
  });

  it("rejects physically impossible action-time ties and invalid faction victory histories", () => {
    expect(() =>
      evaluateScoring(
        position("invasion", [
          player("p1", 1, 1, 1, 1),
          player("p2", 1, 1, 1, 1),
        ]),
      ),
    ).toThrow("distinct sequence");
    const power = normalPower();
    power.welsh = { wins: 3, lastWonStruggle: 8 };
    expect(() => enumerateFactionRankings(power)).toThrow("multiple factions");
    expect(() =>
      evaluateScoring(
        position(
          "coronation",
          [player("p1", 1, 1, 1), player("p2", 1, 1, 1)],
          null,
          power,
        ),
      ),
    ).toThrow("multiple factions");
  });

  it("rejects invalid player counts, courts, virtual owners, and zero-win history", () => {
    expect(() =>
      evaluateScoring(position("invasion", [player("p1", 0, 0, 0)])),
    ).toThrow("two or three");
    expect(() =>
      evaluateScoring(
        position("invasion", [player("p1", -1, 0, 0), player("p2", 0, 0, 0)]),
      ),
    ).toThrow("scoring court");
    expect(() =>
      evaluateScoring(
        position("invasion", [player("p1", 0, 0, 0), player("p2", 0, 0, 0)], {
          playerId: "stranger",
          faction: "english",
        }),
      ),
    ).toThrow("virtual Plot");
    const power = unwonPower();
    power.welsh = { wins: 0, lastWonStruggle: 2 };
    expect(() => enumerateFactionRankings(power)).toThrow("victory history");
    expect(() =>
      evaluateScoring(
        position(
          "coronation",
          [player("p1", 0, 0, 0), player("p2", 0, 0, 0)],
          null,
          power,
        ),
      ),
    ).toThrow("victory history");
  });
});
