import { describe, expect, it } from "vitest";
import { setupSession } from "../test/turnFixtures";
import { getObservation } from "../game/visibility";
import { witnessedCards } from "../app/botObservation";
import { StandardBot } from "./search";

describe("frozen reference strategy", () => {
  it.each([2, 3])("preserves seeded %i-player decisions", (count) => {
    const decisions = ["reference-opening-a", "reference-opening-b"].map(
      (seed) => {
        const session = setupSession(count, "standard", seed);
        const result = new StandardBot().search({
          observation: getObservation(
            session.state,
            session.state.activePlayerId,
          ),
          memory: witnessedCards(session),
          budget: { iterations: 64, seed: 2026 },
        });
        const { elapsedMs: _elapsed, ...stats } = result.stats;
        return { seed, plan: result.plan, stats };
      },
    );
    expect(decisions).toMatchSnapshot();
  });
});
