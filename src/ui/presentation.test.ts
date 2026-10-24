import { describe, expect, it } from "vitest";
import { forecast, regionLeader } from "./presentation";

describe("struggle forecasts", () => {
  it("names a unique largest faction, and treats ties and empty regions as unstable", () => {
    expect(regionLeader({ scottish: 2, welsh: 1, english: 1 })).toEqual({
      kind: "faction",
      faction: "scottish",
    });
    expect(regionLeader({ scottish: 2, welsh: 2, english: 1 })).toEqual({
      kind: "tie",
    });
    expect(regionLeader({ scottish: 0, welsh: 0, english: 0 })).toEqual({
      kind: "empty",
    });
    expect(forecast(regionLeader({ scottish: 0, welsh: 0, english: 3 }))).toBe(
      "English would take control",
    );
    expect(forecast({ kind: "tie" })).toBe("Tied — would become unstable");
  });
});
