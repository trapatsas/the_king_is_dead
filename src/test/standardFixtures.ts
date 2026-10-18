import { beginTurn, draftCard, draftEffect, draftSummon } from "../app/draft";
import { endTurn } from "../app/session";
import { FACTIONS, REGION_IDS, emptyFactionCounts } from "../game/domain";
import type {
  Faction,
  GameState,
  RegionId,
  StandardCardType,
} from "../game/domain";
import type { GameSession } from "../game/events";
import { freezeSnapshot } from "../game/immutable";
import { assertGameInvariants } from "../game/invariants";
import { copyChoice } from "../game/plans";
import { turnEngine } from "../game/turns";
import type { EffectPlan, SummonChoice, TurnDraft } from "../game/turnTypes";
import type { Mutable } from "./turnFixtures";

export function editFixture(
  session: GameSession,
  edit: (state: Mutable<GameState>) => void,
): GameSession {
  const next = copyChoice(session) as Mutable<GameSession>;
  edit(next.state);
  if (next.events[0]?.type === "GameCreated" && next.events.length === 1)
    next.events[0].state = next.state;
  assertGameInvariants(next.state);
  return freezeSnapshot(next);
}

/** Conserved controlled-prefix fixture; no claim this is an accepted setup. */
export function resolvedFixture(
  session: GameSession,
  controls: Partial<Record<RegionId, Faction | "unstable">>,
): GameSession {
  return editFixture(session, (state) => {
    const resolved = REGION_IDS.filter((id) => controls[id] !== undefined);
    const order = [
      ...resolved,
      ...state.regionCards
        .map((card) => card.regionId)
        .filter((id) => !resolved.includes(id)),
    ];
    state.regionCards = order.map((regionId, index) => ({
      slot: index + 1,
      regionId,
      faceUp: !resolved.includes(regionId),
      negotiationDiscOwner: null,
    }));
    for (const [index, id] of resolved.entries()) {
      const control = controls[id];
      if (control === undefined) throw new Error("fixture");
      for (const faction of FACTIONS)
        state.supply[faction] += state.regions[id].followers[faction];
      state.regions[id].followers = emptyFactionCounts();
      state.regions[id].control =
        control === "unstable"
          ? { kind: "unstable", struggleIndex: index + 1 }
          : { kind: "faction", faction: control, struggleIndex: index + 1 };
      if (control === "unstable") state.instabilityDiscsInFrance -= 1;
      else state.controlDiscsInSupply[control] -= 1;
    }
  });
}

export function supplyFixture(
  session: GameSession,
  counts: Partial<Record<Faction, number>>,
): GameSession {
  return editFixture(session, (state) => {
    const target = REGION_IDS.find(
      (id) => state.regions[id].control.kind === "unresolved",
    );
    if (!target) throw new Error("fixture");
    for (const faction of FACTIONS) {
      const count = counts[faction];
      if (count === undefined) continue;
      if (count > state.supply[faction])
        throw new Error("Fixture only depletes supply");
      state.regions[target].followers[faction] += state.supply[faction] - count;
      state.supply[faction] = count;
    }
  });
}

export function cardId(state: GameState, type: StandardCardType): string {
  const card = state.players[state.activePlayerId]?.hand.find(
    (candidate) => candidate.type === type,
  );
  if (!card) throw new Error(`Fixture missing ${type}`);
  return card.id;
}

export function plans(
  state: GameState,
  type: StandardCardType,
): readonly EffectPlan[] {
  return turnEngine.enumerateEffectPlans(
    state,
    state.activePlayerId,
    cardId(state, type),
  );
}

export function standardDraft(
  state: GameState,
  type: StandardCardType,
  chooseEffect: (options: readonly EffectPlan[]) => EffectPlan | undefined = (
    options,
  ) => options[0],
  chooseSummon: (
    options: readonly SummonChoice[],
  ) => SummonChoice | undefined = (options) => options[0],
): TurnDraft {
  const effect = chooseEffect(plans(state, type));
  if (!effect) throw new Error(`No fixture effect for ${type}`);
  const draft = draftEffect(
    draftCard(beginTurn(state), cardId(state, type)),
    effect,
  );
  const summon = chooseSummon(
    turnEngine.previewTurn(state, draft).summonChoices,
  );
  if (!summon) throw new Error("No fixture summon");
  return draftSummon(draft, summon);
}

export function play(
  session: GameSession,
  type: StandardCardType,
  chooseEffect?: (options: readonly EffectPlan[]) => EffectPlan | undefined,
  chooseSummon?: (options: readonly SummonChoice[]) => SummonChoice | undefined,
): GameSession {
  return endTurn(
    session,
    standardDraft(session.state, type, chooseEffect, chooseSummon),
  );
}

export const summonDevon = (
  options: readonly SummonChoice[],
): SummonChoice | undefined =>
  options.find(
    (choice) => choice.kind === "follower" && choice.regionId === "devon",
  );
