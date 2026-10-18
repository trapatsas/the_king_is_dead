import { FACTIONS, REGION_IDS, emptyFactionCounts } from "../game/domain";
import type {
  FactionCounts,
  GameMode,
  GameState,
  RegionId,
} from "../game/domain";
import type { GameSession } from "../game/events";
import { freezeSnapshot } from "../game/immutable";
import { assertGameInvariants } from "../game/invariants";
import { copyChoice } from "../game/plans";
import { createGame } from "../game/setup";
import { createTurnEngine } from "../game/turns";
import type { TurnEngine } from "../game/turns";
import type { EffectPlan, SummonChoice, TurnDraft } from "../game/turnTypes";
import {
  beginTurn,
  draftCard,
  draftEffect,
  draftPass,
  draftSummon,
} from "../app/draft";
import { endTurn } from "../app/session";

export type Mutable<T> = T extends object
  ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;

export const followers = (
  scottish = 0,
  welsh = 0,
  english = 0,
): FactionCounts => ({ scottish, welsh, english });

export function setupSession(
  count = 3,
  mode: GameMode = "standard",
  seed = "turn-fixture",
): GameSession {
  return createGame({
    seed,
    mode,
    players: Array.from({ length: count }, (_, i) => ({
      id: `p${i + 1}`,
      controller: "human" as const,
    })),
  });
}

/** Synthetic conserved midgame board, solely for isolated framework tests. */
export function withBoard(
  session: GameSession,
  board: Partial<Record<RegionId, FactionCounts>>,
): GameSession {
  const mutable = copyChoice(session) as Mutable<GameSession>;
  if (mutable.events.length !== 1 || mutable.events[0]?.type !== "GameCreated")
    throw new Error("Fixture requires setup");
  for (const id of REGION_IDS) {
    const region = mutable.state.regions[id];
    const replacement = board[id] ?? emptyFactionCounts();
    for (const faction of FACTIONS) {
      mutable.state.supply[faction] +=
        region.followers[faction] - replacement[faction];
    }
    region.followers = { ...replacement };
  }
  mutable.events[0].state = mutable.state;
  assertGameInvariants(mutable.state);
  return freezeSnapshot(mutable);
}

/** Test double, NOT an implementation of Assemble or any real card's rules. */
export function fixtureEngine(
  plans: (state: GameState) => readonly EffectPlan[],
): TurnEngine {
  return createTurnEngine({ assemble: { enumerate: (state) => plans(state) } });
}

export const noEffect: EffectPlan = {
  kind: "no-effect",
  effectiveCard: "assemble",
  tier: 0,
  operations: [],
  reason: "Test-only effect resolver",
};
export const noEffectEngine = fixtureEngine(() => [noEffect]);

export function actionCardId(state: GameState): string {
  const card = state.players[state.activePlayerId]?.hand.find(
    (held) => held.type === "assemble",
  );
  if (!card) throw new Error("Fixture has no Assemble");
  return card.id;
}

export function readyCard(
  state: GameState,
  engine = noEffectEngine,
  chooseSummon: (
    choices: readonly SummonChoice[],
  ) => SummonChoice | undefined = (choices) => choices[0],
): TurnDraft {
  const cardId = actionCardId(state);
  const effect = engine.enumerateEffectPlans(
    state,
    state.activePlayerId,
    cardId,
  )[0];
  if (!effect) throw new Error("Fixture has no effect");
  const draft = draftEffect(draftCard(beginTurn(state), cardId), effect);
  const summon = chooseSummon(engine.previewTurn(state, draft).summonChoices);
  if (!summon) throw new Error("Fixture has no summon");
  return draftSummon(draft, summon);
}

export function pass(session: GameSession, count = 1): GameSession {
  let next = session;
  for (let index = 0; index < count; index += 1)
    next = endTurn(next, draftPass(beginTurn(next.state)));
  return next;
}
