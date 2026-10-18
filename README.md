# KingIsDead

A local-first implementation of **The King Is Dead — Second Edition**, following
the [project ruleset](the_king_is_dead_2nd_edition_rulebook.md) for two or three
independent players.

**Current stage: Milestones 0–5.** Standard games are playable in the browser for
two or three local human players, with private handoffs, legal action choices,
draft previews, and full result explanations. Controllers, save/resume, and
Advanced gameplay follow the ordered [implementation plan](docs/IMPLEMENTATION_PLAN.md).
Advanced and automated seats are visibly unavailable in setup. See the
[milestone report](docs/IMPLEMENTATION_STATUS.md) for verification.

## Run locally

Use the supplied Dev Container or Node 24:

```sh
npm ci
npm run dev
```

Vite listens on `0.0.0.0:5173`; the Dev Container forwards port 5173. Open
`http://localhost:5173`. The fixed port fails explicitly if occupied.

## Verify

```sh
npm run typecheck
npm run lint
npm run test:run
npm run format:check
npm run build
```

`npm test` starts Vitest in watch mode. `npm run typecheck` also compiles the
engine with ES2022 libraries and no DOM/Node globals. Milestone 5 adds only the
planned UI test dependencies: jsdom, React Testing Library, and user-event.

## Play locally

Choose Standard, two or three Human seats, and optionally a setup seed. Pass the
device to the named player and reveal their hand. Choose a card, follow its
legal effect choices, confirm the effect, and summon a follower. The board and
court then show a labeled preview. Review the final summary and select **End
Turn** to commit; **Reset Turn** restores the committed position. Passing also
requires End Turn. Everyone passing consecutively resolves the next struggle.

Keyboard focus follows each choice through effect, summon, summary, and private
handoff. Region buttons offer the same eligible targets as the choice panel.
The board is an original schematic of the approved graph; numbered cards show
struggle order separately and are click-only. Courts, supply, control discs,
instability, and visible discard tops are public. Hidden hands are absent from
the rendered page until their owner reveals them.

After the final result, choose **View game log** to review the chronological
record: initial regional/court followers and supply, seed and starting player,
card effects and summons, passes, power-struggle counts and decisions, Plot
choices when applicable, and final scoring comparisons. The log shows committed
events only; abandoned drafts and resets are excluded. Unplayed hands and
undealt cards remain private. **Hide game log** collapses the timeline again.

**Games are not saved yet:** refreshing returns to setup. Starting another game
asks before discarding the current one. Bots and save/replay are Milestone 6;
full Advanced cards are Milestone 7. Plot's terminal choice/result panel is
implemented and tested, while Advanced setup stays unavailable for gameplay.
No provider is connected and no external resources are requested by the app.

## Engine foundation

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
- `src/app/draft.ts` and `session.ts`: separate drafts, reset, End Turn, and
  append-only accepted history.
- `src/ui/`: setup, SVG/CSS board, click-only struggle track, courts, private
  handoff, engine-driven choice wizard, previews, Plot panel, and scoring details.
- `src/ui/presentation.ts`: explicit public-table/private-hand projection and
  public struggle notices; full accepted records never become view props.
- `src/ui/finishedLog.ts` and `GameLogPanel.tsx`: end-of-game event projection
  and an expandable chronological log with setup/struggle follower tables.

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
action replaces or clears it. Negotiate uses the actor's own disc and can still
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

The full state and setup log include private hands and undealt Cunning cards.
They remain internal engine data. The UI projector explicitly selects permitted
fields and never passes full state or history to board/court components. A shared
controller observation API follows in Milestone 6. No controller or LLM provider
is connected.

## Project references

- [Authoritative rules](the_king_is_dead_2nd_edition_rulebook.md)
- [Architecture and contracts](docs/HIGH_LEVEL_DESIGN.md)
- [Ordered milestones](docs/IMPLEMENTATION_PLAN.md)
- [Agent kickoff and first-task scope](docs/AGENT_KICKOFF_PROMPT.md)
