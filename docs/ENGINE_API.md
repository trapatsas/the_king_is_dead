# Engine and API reference

Developer reference for the rules engine and its headless API. For running and
playing the game, see the [README](../README.md).

## Modules

- `src/game/domain.ts`: readonly, serializable state and named domain types.
- `src/game/board.ts`: the approved 13-edge graph and pre-random home allocation.
- `src/game/rng.ts`: versioned, injectable deterministic RNG with a saved cursor.
- `src/game/cards.ts`: distinct Standard card instances and a shared Cunning deck.
- `src/game/setup.ts`: two/three-player Standard/Advanced setup, randomly selected
  starting player, and an explicit accepted setup snapshot.
- `src/game/invariants.ts`: follower/card/disc accounting and state consistency.
- `src/game/events.ts`: internal setup, committed turn, struggle, ending-trigger,
  and result event types.
- `src/game/turns.ts`: effect-plan validation, previews, atomic commits, and the
  trusted card-definition extension point.
- `src/game/effects/standard.ts`: all seven Standard card types, shared target
  rules, canonical placement/swap plans, and partial-action priorities.
- `src/game/effects/swaps.ts` and `regionCards.ts`: pre-summon swap memory,
  full-reversal checks, and personal Negotiate-disc/card-position changes.
- `src/game/struggles.ts` and `summons.ts`: region resolution and mandatory
  post-effect summon choices, including explicit zero.
- `src/game/scoring.ts`: faction ranking permutations, court comparisons, timing,
  Plot support, and structured win/draw explanations.
- `src/game/endgame.ts`: automatic finalization or Plot reveal/choice, with
  accepted result events.
- `src/game/visibility.ts`: `getObservation(state, viewer)`, the single
  redacted per-seat view shared by the UI and future bots.
- `src/app/draft.ts` and `session.ts`: separate drafts, reset, End Turn, and
  append-only accepted history.
- `src/ui/useHotseatTurn.ts`: the hotseat controller hook, the only UI code that
  holds the full session. It hands components observations and the viewer's
  own legal choices.
- `src/ui/Game.tsx`, `TurnPanels.tsx`, `TablePanels.tsx`, `Board.tsx`: board,
  click-only struggle track, courts, private handoff, choice wizard, previews,
  Plot panel and result. `ErrorBoundary.tsx` restarts the current turn from the
  last committed session after an unexpected render failure.
- `src/ui/presentation.ts`: `projectTable`, built on `getObservation`, plus
  public struggle notices and effect descriptions.
- `src/ui/finishedLog.ts` and `GameLogPanel.tsx`: public/finished event projections,
  per-seat latest accepted moves and chronological follower/action tables.
- `src/app/gameArchive.ts` and `src/ui/GameHistory.tsx`: UUID game metadata,
  versioned local storage of public logs, validation and lookup by ID/name.
  These records are not resumable engine snapshots.

For example, in a TypeScript consumer:

```ts
import { createGame } from "./src/game/setup";

const setup = createGame({
  seed: "the-empty-throne",
  mode: "standard",
  players: [
    { id: "alice", controller: "human" },
    { id: "bob", controller: "human" },
    { id: "charlie", controller: "algorithmic" },
  ],
});

// Identical seed/settings reproduce the entire state and setup event.
const { state, events } = setup;
```

Seat order is clockwise; `state.startingPlayerId` is chosen once and retained in
the snapshot. The RNG uses FNV-1a seed hashing and `mulberry32-v1` with rejection
sampling for bounded choices. Both the initial and final RNG cursors are stored.
Snapshots and events are recursively frozen, and caller inputs are left alone.
The current state schema is version 4, including revealed/selected Plot metadata
and structured scoring details. A save loader/migration layer has not been
implemented yet.

## Headless turn framework

Passing and Standard card actions use the same draft/commit boundary:

```ts
import { beginTurn, draftPass } from "./src/app/draft";
import { endTurn } from "./src/app/session";

const draft = draftPass(beginTurn(setup.state));
const nextSession = endTurn(setup, draft);
```

Use `resetTurn(state, draft)` to discard the current draft before commitment.
Draft changes, previews, and resets do not change canonical state or accepted
history. A committed draft becomes stale and cannot undo or repeat its turn.
`endTurn` appends engine-validated events and returns a new frozen session.

After everyone passes consecutively, the lowest remaining face-up region card
resolves. Plurality wins control; top ties and empty regions cause instability.
The third instability or eighth resolved region records `GameEndTriggered`, sets
`ending` to `invasion` or `coronation`, and halts normal turns. The same atomic
commit then either emits `GameFinished` with a win/draw or reveals a held Plot
and enters `plot-choice`. The internal `scoring` phase is transitional.

The default `turnEngine` registers every Standard card. Use
`getAvailableCards`/`enumerateEffectPlans` for legal choices, then compose a card
draft with `draftCard`, `draftEffect`, and `draftSummon`. `previewTurn` provides
the post-effect summon choices; `endTurn` validates the entire plan again before
commitment. The framework keeps only the globally highest legal partial-action
tier, including anti-undo restrictions, and records an explicit zero summon when
every uncontrolled region is empty.

Manoeuvre/Outmanoeuvre reversals compare faction-count transfer multisets before
the mandatory summon. Passes and previews retain the last swap; a different card
action replaces or clears it. A no-op swap (no faction counts change) imposes no
restriction. Negotiate uses the actor's own disc and can still
swap eligible cards after it is spent, without placing another marker.

Advanced setup and Plot endgame scoring are available. Other Cunning effects
remain unimplemented and are rejected explicitly. Tests use an isolated Spy
effect adapter to verify effective-swap tracking; this is not the full Spy card
implementation.

## Scoring and Plot

Invasion compares complete court sets, then the latest committed action among
the tied players. Coronation ranks factions by region wins and latest victory,
then compares leading-faction support, second-faction support, Plot's final
override, and earliest final committed action. Never-acted ties produce draws.
Unwon faction ties evaluate every permitted ordering; a player wins only when
every ordering agrees on the same unique winner.

`state.result` contains a win or draw and structured `details`: physical/scoring
courts, complete sets, final action times, faction victory history, and each
ranking case's comparison values, surviving candidates, and outcome. Sorting
player IDs is only for deterministic presentation and never breaks a tie.

If `state.phase === "plot-choice"`, `state.plot` identifies the revealed owner.
Call `choosePlot(session, { playerId, faction, baseEventSequence })` from
`src/app/session.ts`, using the owner's selected faction and the current event
cursor. This appends `PlotChosen` and `GameFinished` together. The chosen follower
is virtual: physical courts, supply, regions, cards, action times, and RNG stay
unchanged. Plot remains unplayable during normal turns. An undealt Plot has no
effect. Ownership, faction, stale decisions, and repeated choices are validated.

`scoreGame(state, optionalVirtualPlot)` can preview a pending owner's faction
choice without accepting events. After commitment its faction cannot be replaced.
The invariant checker recomputes finished results and rejects inconsistent cached
outcomes or explanations.

The tests contain deterministic fixtures for every player-count/mode combination,
400 seeded setup checks, 64 seeded pass-only progression cases, and 32 seeded
Standard card-play cases, each progression case reproduced twice. Standard runs
exercise both spending every card before struggles and interleaving card play
with struggles; all finish with a win/draw. Four accepted-log reconstruction
fixtures reproduce the full resulting state, final result, and events. Tests also cover every
Standard card, partial tiers, Negotiate discs, swap anti-undo, a fixed RNG vector,
JSON round trips, draft reset, stale commits, and corrupted inventories. The
production save-validation/replay API is still scheduled for Milestone 6.
The engine tests also cover scoring permutations, never-acted fallbacks, Plot's
virtual support and conditional override, pending-choice JSON continuation, and
result integrity.

## Hidden information

The full state and setup log include private hands and undealt Cunning cards.
They remain internal engine data. `getObservation(state, viewer)` is the only
view a seat may use. It returns public table data, hand and discard counts,
public discard tops and, for the viewer only, their own hand and discard pile.
The seed and RNG cursors are withheld until the game finishes, because they
would let a viewer recompute hidden deals. The session stays at the application/
controller boundary; rendered table components receive observation projections.
The Standard bot uses the same function plus witnessed public card memory from
`src/app/botObservation.ts`; private setup records never enter its Worker.

Latest-move panels and archived logs are separate public event projections.
They record accepted face-up plays, passes, effects, summons, setup followers
and struggles. They exclude setup hands, unused Cunning cards, private discard
arrays and RNG cursors. Live archives also omit the seed; finished archives may
disclose it. A versioned UUID identifies each game independently of its seed.
Only these public log records go to local storage; loading one reviews the log
without restoring engine state or starting controllers.

There is no backend, so in-memory state is not a security boundary against
someone with browser developer tools on the shared device.

## Algorithmic strategy metadata

`PlayerConfig.botStrategy` optionally names `reference` or `patient` for an
algorithmic seat. It is public metadata copied into observations, setup events
and public archives. Legacy algorithmic seats without the field use Reference.
Setup and state invariants reject unknown profiles or profiles on nonalgorithmic
seats. No move or scoring rule depends on this metadata. Both bots submit plans
through the same public validation boundary. See [Patient strategy](PATIENT_BOT.md)
for the independent evaluation policy, versioned reference checks and experiments.
