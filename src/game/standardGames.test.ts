import { describe, expect, it } from "vitest";
import {
  beginTurn,
  draftCard,
  draftEffect,
  draftPass,
  draftSummon,
} from "../app/draft";
import { endTurn } from "../app/session";
import { setupSession } from "../test/turnFixtures";
import { STANDARD_CARD_TYPES } from "./domain";
import type { GameSession } from "./events";
import { assertGameInvariants } from "./invariants";
import { createRng, randomInt } from "./rng";
import type { TurnDraft } from "./turnTypes";
import { turnEngine } from "./turns";

type Policy = "spend-all" | "interleave-struggles";

function playStandard(
  count: number,
  seed: string,
  policy: Policy,
): GameSession {
  let session = setupSession(count, "standard", seed);
  let choices = createRng(`${seed}/scripted-choices`);
  function choose<T>(options: readonly T[]): T {
    const next = randomInt(choices, options.length);
    choices = next.rng;
    const value = options[next.value];
    if (value === undefined) throw new Error("Empty scripted choice");
    return value;
  }
  while (
    session.state.phase === "turn" &&
    session.state.turnSequence < 8 * count * (count + 1)
  ) {
    const state = session.state;
    const cards = turnEngine.getAvailableCards(state, state.activePlayerId);
    const struggleRound =
      policy === "interleave-struggles" &&
      state.turnSequence % (count * 3) >= count * 2;
    let draft: TurnDraft = beginTurn(state);
    if (cards.length === 0 || struggleRound) draft = draftPass(draft);
    else {
      const card = choose(cards);
      const effect = choose(
        turnEngine.enumerateEffectPlans(state, state.activePlayerId, card.id),
      );
      draft = draftEffect(draftCard(draft, card.id), effect);
      const preview = turnEngine.previewTurn(state, draft);
      draft = draftSummon(draft, choose(preview.summonChoices));
    }
    session = endTurn(session, draft);
    assertGameInvariants(session.state);
  }
  expect(session.state.phase).toBe("finished");
  expect(["invasion", "coronation"]).toContain(session.state.ending);
  expect(session.state.result?.method).toBe(session.state.ending);
  expect(
    session.events.filter((event) => event.type === "GameFinished"),
  ).toHaveLength(1);
  expect(session.events.at(-1)).toMatchObject({
    type: "GameFinished",
    result: session.state.result,
  });
  expect(
    session.events.filter((event) => event.type === "GameEndTriggered"),
  ).toHaveLength(1);
  if (policy === "spend-all") {
    expect(session.state.actionSequence).toBe(8 * count);
    expect(
      new Set(
        session.events.flatMap((event) =>
          event.type === "TurnCommitted" && event.card ? [event.card.type] : [],
        ),
      ),
    ).toEqual(new Set(STANDARD_CARD_TYPES));
    expect(
      Object.values(session.state.players).every(
        (player) => player.hand.length === 0 && player.discards.length === 8,
      ),
    ).toBe(true);
  }
  return session;
}

/** Test reconstruction, not the production save-validation/replay API (M6). */
function reconstructCommittedChoices(session: GameSession): GameSession {
  const setup = session.events[0];
  if (setup?.type !== "GameCreated") throw new Error("Missing setup");
  let result: GameSession = {
    state: setup.state,
    events: [setup],
  };
  for (const event of session.events) {
    if (event.type !== "TurnCommitted") continue;
    const plan = event.plan;
    let draft = beginTurn(result.state);
    draft =
      plan.kind === "pass"
        ? draftPass(draft)
        : draftSummon(
            draftEffect(draftCard(draft, plan.cardId), plan.effect),
            plan.summon,
          );
    result = endTurn(result, draft);
  }
  return result;
}

describe.each([2, 3])(
  "%i-player complete Standard play through final scoring",
  (count) => {
    it.each(["spend-all", "interleave-struggles"] as const)(
      "plays eight deterministic seeds with %s",
      (policy) => {
        for (let index = 0; index < 8; index += 1) {
          const seed = `standard-${count}-${policy}-${index}`;
          const result = playStandard(count, seed, policy);
          expect(playStandard(count, seed, policy)).toEqual(result);
          const loaded: GameSession = JSON.parse(JSON.stringify(result));
          expect(loaded).toEqual(result);
          if (index === 0)
            expect(reconstructCommittedChoices(loaded)).toEqual(result);
        }
      },
    );
  },
);
