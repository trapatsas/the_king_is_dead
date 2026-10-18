# Implementation status

Milestones 0–5 implemented on 2026-10-18. Milestone 6 is next. The kickoff scopes
the initial task to Milestones 0–1; follow-on milestones are reported below.

The browser supports complete Standard games for two or three local human
players. Private handoffs, legal effect/summon choices, draft previews, struggles,
and result explanations are implemented. Controllers, save/replay, and full
Advanced gameplay remain pending. Earlier milestone sections record their state
at completion; the latest milestone describes current behavior.

## Milestone 0 — Toolchain

**Implemented:** inspected the existing scripts, lockfile, Dev Container,
TypeScript, Vite, Vitest, Oxlint, and Prettier configuration. `npm install`
succeeded using the existing dependencies and tracked lockfile without changing
dependency versions. Added an HTML/module entry point for Vite builds and two
toolchain tests. Fixed Prettier formatting in the supplied design and plan.

**Files changed:** `index.html`, `src/main.ts`, `src/toolchain.test.ts`,
`docs/HIGH_LEVEL_DESIGN.md`, `docs/IMPLEMENTATION_PLAN.md`. The authoritative
rulebook's pre-existing edits were preserved without modification.

**Inspected versions:** Node `24.21.0`, npm `11.19.0`, React/React DOM `19.3.1`,
Vite `8.3.4`, TypeScript `6.0.3`, Vitest `5.0.5`, Oxlint `1.88.0`, Prettier
`3.9.10`.

**Tests added:** the two toolchain tests check fixed host/port settings and Node
test discovery. At the Milestone 0 boundary, all five required commands passed
and Vitest reported 2 tests passing.

**Server check:** `npm run dev` reported Vite listening on port 5173. HTTP requests
to `http://127.0.0.1:5173/` and `/src/main.ts` succeeded and returned the HTML and
transformed module. The Dev Container already forwards this port. Actual
host-browser rendering/forwarding is **NOT VERIFIED** in this session.

**Rules used:** project scope and the Milestone 0 toolchain acceptance criteria.
No rule changes or ambiguities were required.

**Next milestone:** Milestone 1, completed below as part of the same authorized
first task.

## Milestone 1 — Domain and deterministic setup

**Implemented:** readonly JSON domain types, frozen snapshots, the exact approved
13-edge graph, explicit home allocation, seeded two/three-player setup, Standard
and Advanced hands, stable physical card IDs, supply/removed-box accounting,
control/instability/personal negotiation discs, random starting-player selection,
versioned RNG cursors, and a structured accepted `GameCreated` event containing
the explicit setup result. No React, browser, network, or provider imports exist
in the engine. Controller labels are retained without implementing or silently
substituting opponents.

**Files changed:** `src/game/domain.ts`, `board.ts`, `cards.ts`, `rng.ts`,
`immutable.ts`, `setup.ts`, `events.ts`, `invariants.ts`, plus the corresponding
`board.test.ts`, `rng.test.ts`, `setup.test.ts`, and `invariants.test.ts`.
`tsconfig.engine.json` and the extended `typecheck` script check the engine
without browser/Node globals. `README.md` documents the current scope, running,
verification, setup example, internal-state visibility, and remaining work.

**Tests added:** 82 domain/setup tests, bringing the total to 84 across 5 files.
These cover the independent adjacency table and exact degrees, home followers
before random top-up, 4 followers per region, 2 per court, 18 per faction
including the removed pool, two separate Assemble cards, the full shared Cunning
deck dealt without replacement, all initial discs, seed/start reproducibility,
JSON serialization, caller immutability, injected RNG cursors, all seat labels,
invalid configuration rejection, fixed RNG/reference/rejection paths, and
deliberate inventory corruption. Four test cases each exercise 100 seeds, for
400 setup regressions. Fixtures for conserved resolved regions check that the
invariant checker can accept later valid states without implementing struggles.

**Required check results:**

| Command                | Result | Evidence                                                         |
| ---------------------- | ------ | ---------------------------------------------------------------- |
| `npm run typecheck`    | PASS   | Main project and engine-only TypeScript checks exit 0            |
| `npm run lint`         | PASS   | Oxlint exits 0                                                   |
| `npm run test:run`     | PASS   | 5 files, 84 tests passing; includes 400 deterministic setup runs |
| `npm run format:check` | PASS   | Prettier reports all matched files use its code style            |
| `npm run build`        | PASS   | TypeScript and Vite produce `dist/index.html` and bundled module |

**Rules used:** Board Layout/Adjacency; Standard Setup; Two-Player Setup
Adjustment; Advanced Game Setup; components/inventory; persistence of accepted
setup and starting player. Immutable state and event shapes follow the design's
domain, setup, and audit contracts. Future phase/result types and invariant checks
are structural definitions, not an implementation of gameplay or scoring.

**Open ambiguities:** none encountered in these milestones. The authoritative
rulebook was not changed.

**Next milestone:** Milestone 2 — completed below.

## Milestone 2 — Turn framework and power struggles

**Implemented:** separate immutable drafts, reset, pass/card previews, stale-turn
and active-player validation, engine-side plan revalidation at atomic commit,
clockwise progression, consecutive-pass resolution, ordered follower transfers,
and mandatory post-effect summon or explicit zero with reason. App sessions append
only accepted event deltas and reject missing/truncated event cursors. Neither
drafts nor resets enter accepted history. Caller-owned data is not mutated or
frozen.

Power struggles resolve the lowest face-up numbered slot, use strict plurality,
return every regional follower, consume the appropriate control/instability disc,
retain negotiation markers, and leave resolved regions permanently empty. The
third instability triggers Invasion immediately; otherwise resolving all eight
regions triggers Coronation. Invasion wins precedence when both happen on the
eighth struggle. Both triggers halt normal play, with metadata retained for
future scoring.

**Files changed:** added `src/game/turnTypes.ts`, `turnContext.ts`, `turns.ts`,
`struggles.ts`, `summons.ts`, `plans.ts`, `errors.ts`, and `effects/common.ts`;
`src/app/draft.ts` and `session.ts`; `src/test/turnFixtures.ts`; and three test files
(`turns.test.ts`, `struggles.test.ts`, `summons.test.ts`). Updated `domain.ts`,
`setup.ts`, `events.ts`, `invariants.ts`, the invariant fixture, `README.md`, the
design, and the implementation plan. No dependencies or rulebook changes.

**Tests added:** 70 tests, bringing the total to 154 across 8 files. Coverage
includes 2/3-player pass sequences and seat order, interrupted streaks, acting
after passing, single-use physical cards, Plot rejection, incomplete/forged
plans, maximum-tier filtering, commit revalidation, failed-transfer atomicity,
reset with full canonical/history equality, stale commits, JSON continuation,
and caller immutability. Summon tests cover pre/post-effect differences, newly
placed followers, removal of the final follower, unrelated-region summons,
stocked-supply zero cases, invalid counts/sources, and resolved-region exclusions.
Struggle fixtures cover every faction's plurality, ties/empty regions, card-slot
reordering, marker retention, both ending triggers, and blocked terminal turns.

An additional 64 seeded pass-only progression cases (16 seeds × 2 counts × 2
modes), each run twice, verify deterministic bounded progression to scoring with
invariants after every commit. These are headless pass-only tests, not complete
card-play/bot games. The existing 400 seeded setup regressions also pass.

**Required check results:**

| Command                | Result | Evidence                                                        |
| ---------------------- | ------ | --------------------------------------------------------------- |
| `npm run typecheck`    | PASS   | Main project and engine-only TypeScript checks exit 0           |
| `npm run lint`         | PASS   | Oxlint exits 0                                                  |
| `npm run test:run`     | PASS   | 8 files, 154 tests passing                                      |
| `npm run format:check` | PASS   | Prettier reports all matched files use its code style           |
| `npm run build`        | PASS   | TypeScript and Vite build the development scaffold successfully |

**Stage boundaries:** Standard and Cunning card effects are not implemented.
The default engine accepts passes and rejects unsupported card rules explicitly;
only framework tests install the clearly marked test effect definitions. Winner
selection and Plot endgame choices are Milestone 4/7 work. A terminal struggle
emits `GameEndTriggered` and enters `scoring` with `result: null`; `GameFinished`
is typed and will be emitted when the scorer produces an actual result. Full
save validation/replay is still Milestone 6; JSON continuation is tested now.
The schema is version 2 because event cursors and ending metadata were added.
No migration/save-loader claim is made for the earlier schema.

**Rules used:** Turn Structure; Editing and Committing a Turn; Internal Action
Log; Power Struggles; Controlled vs. Uncontrolled Regions; Summoning Followers;
Card Management; Partial Actions; and the Invasion/Coronation ending triggers.
No new rule ambiguity was encountered. The scoring phase is an explicit
architectural staging boundary, not a new game rule.

**Not verified:** actual browser gameplay (there is no playable UI yet), real
Standard/Cunning effect integration, winner selection, and full-game replay.

**Next milestone:** Milestone 3 — Standard card effects and universal legality,
including faction Support, Assemble, Negotiate, swap priorities, and anti-undo.

## Milestone 3 — Standard cards and universal legality

**Implemented:** all seven Standard card types are registered in the production
turn engine. Support cards use their faction's controlled-region borders plus
the conditional unresolved-home fallback, with supply shortfalls. Assemble
enumerates all complete faction placements across uncontrolled regions and skips
only missing supply factions. The engine retains only globally maximum legal
partial-action tiers and revalidates canonical structured plans at commit.

Negotiate swaps two eligible face-up unmarked region cards and places the actor's
own available marker on either swapped card. An already-spent personal disc
permits the swap without another marker. Marker/location consistency survives
previews, reset, commits, and subsequent struggles. Manoeuvre supports arbitrary
distinct uncontrolled regions and same-faction exchanges. Outmanoeuvre requires
bordering regions and the full 1-for-2 tier before a 1-for-1 fallback. All cards
have explicit no-effect plans only when no legal text effect exists; mandatory
post-effect summoning still applies.

Anti-undo compares full transfer multisets before summoning, with counts rather
than cube identities. Passes, previews, resets, and struggles retain the latest
swap; any intervening committed card action replaces or clears that memory.
Only complete opposing reversals of the same effective swap type are excluded.
Partial non-reversals and another swap type remain legal. Filtering occurs
before maximum-tier selection. Copied swaps retain their effective type at the
turn boundary, verified through a test-only Spy adapter, not a full Spy effect.

**Files changed:** added `src/game/effects/standard.ts`, `swaps.ts`,
`regionCards.ts`, and `execute.ts`; `src/test/standardFixtures.ts`; and four test
files (`effects/standard.test.ts`, `effects/negotiate.test.ts`,
`effects/swaps.test.ts`, `standardGames.test.ts`). Updated domain/setup with
`lastSwap` and schema version 3, the effect-operation union, production registry,
swap-memory invariants, the isolated unsupported-definition test, and project
documentation. No dependencies or rulebook changes.

**Tests added:** 61, for 215 passing tests across 12 files. Fixtures cover all
Support factions, home fallback/foreign control/instability/remote anchors,
short/empty supply, all 512 full Assemble placements, missing factions and sole
targets, Negotiate marker/face-up eligibility, spent discs on unresolved or
resolved cards, fewer than two eligible cards, complete preview/reset equality,
Manoeuvre combinations and no-board-change swaps, Outmanoeuvre mixed/same-faction
pairs, global full-tier enforcement, original-source availability, no-effect,
and canonical deduplication. Anti-undo fixtures cover passes, resets, another
committed action, same-faction reversal, full-to-partial fallback, allowed reuse,
pre-summon comparison, effective copied identity, same-actor exemption, and
corrupted memory.

All enumerated initial Standard effects execute with physical invariants intact.
32 seeded Standard card-play cases (8 seeds × 2 player counts × 2 scripts), each
run twice, reach the scoring boundary. One script spends all eight cards per
player before passing; another interleaves actions with struggles. Four test-only
accepted-log reconstructions match every resulting state field and event,
including Negotiate changes and anti-undo memory. Existing setup/pass regressions
remain green.

**Required check results:**

| Command                | Result | Evidence                                              |
| ---------------------- | ------ | ----------------------------------------------------- |
| `npm run typecheck`    | PASS   | Main project and engine-only TypeScript checks exit 0 |
| `npm run lint`         | PASS   | Oxlint exits 0                                        |
| `npm run test:run`     | PASS   | 12 files, 215 tests passing                           |
| `npm run format:check` | PASS   | All matched files follow Prettier style               |
| `npm run build`        | PASS   | TypeScript and Vite build the development scaffold    |

**Rules used:** every Standard Action Cards Reference entry; Controlled vs.
Uncontrolled Regions; Partial Actions and its global tier rule; Summoning;
Negotiate's user-confirmed spent-disc interpretation; swap anti-undo and copied
swap clarifications; and the accepted-turn/log contracts. No new rule ambiguity
was encountered and the authoritative rulebook was not changed.

**Not verified/remaining:** winner selection and Plot endgame decisions (M4/7),
actual browser gameplay (M5), controller implementations and production
save/replay validation (M6), and Cunning effects including full Spy (M7). Headless
Standard games finish normal play at `scoring`; no win/draw is fabricated. Schema
3 adds swap memory; migration of earlier snapshots is not implemented.

**Next milestone:** Milestone 4 — Invasion/Coronation scoring, faction ranking,
project-specific timing and draw tiebreaks, Plot-ready endgame choices, and result
explanations.

## Milestone 4 — Scoring, Plot endgame, and result explanations

**Implemented:** pure deterministic Invasion and Coronation scoring, faction power
from controlled regions/latest won slots, every rule-consistent unwon-faction
ordering, project-specific timing, and explicit wins/draws. Invasion compares
complete sets then latest action among tied players; a no-action tie draws.
Coronation compares leading support, second support, Plot's conditional override,
then earliest final action, treating never acted as earliest. It never compares
third-faction support or chooses an arbitrary order for equally ranked factions.
All valid rankings must produce the same unique winner; otherwise the draw lists
possible winners/tied contenders and the cases evaluated.

Results contain structured physical/scoring courts, complete sets, final action
times, faction victory history, and each ranking case's comparison values,
survivors, and win/draw outcome, alongside a human-readable explanation. Player
IDs sort output only. Input player iteration order never breaks a tie. Invalid
action-time ties and faction victory histories are rejected. Finished state
invariants recompute the full cached result, including explanations and details.

Terminal turn commits now append `GameFinished` immediately when no Plot is held.
A held Plot instead produces `PlotRevealed` and `plot-choice`; it remains in hand
and unplayable as an ordinary action. The owner commits one faction against the
current event cursor, appending `PlotChosen` and `GameFinished` atomically. Its
follower is virtual, contributes to Invasion sets and Coronation comparisons, and
overrides only Coronation's final timing step. No physical court/supply/region,
card, normal turn/action timestamp, or RNG changes. Unowned/undealt Plot, wrong
owner, invalid faction, stale decisions, repeated choices, and replacement of a
committed faction are rejected. Pending virtual choices can be scored without
recording an event. Other Cunning effects are not implemented in this milestone.

**Files changed:** added `src/game/scoring.ts`, `endgame.ts`, `scoring.test.ts`,
and `endgame.test.ts`. Updated domain/setup to schema version 4 with Plot/result
details; typed reveal/choice/result events and PlotChoice; terminal turn
finalization; app session `choosePlot` and shared event appending; result/Plot
invariants; and existing struggle, summon, Standard simulation, and invariant
fixtures to assert current finalization instead of the former staging boundary.
Updated README, design, implementation plan, and this report. No dependencies,
UI/card effects, or authoritative rulebook changes.

**Tests added:** 54, for 269 passing tests across 14 files. The 31 scoring tests
cover every victory/timing step, filtering timing to tied players, leading/second
support priority, third-faction exclusion, never-acted wins/draws, faction count
and recency, zero-win permutations, agreement/disagreement across rankings,
virtual Plot support, conditional override, a single Plot choice across every
ranking, immutable inputs, JSON results, order independence, and invalid inputs.
The 23 endgame cases cover atomic finalization, real card actions with remaining
hands, temporary passes followed by later actions, held/undealt Plot, owner and
event-cursor validation, reveal/choice/result ordering, virtual-only accounting,
pending-choice reloads, deterministic re-scoring, stale/repeated decisions, caller
immutability, and tampered result/reveal rejection at both player counts.

The existing 32 seeded Standard card-play cases, each reproduced twice, now finish
with actual win/draw results. Four accepted-choice reconstructions also match the
entire final result, details, and event stream. The 64 seeded pass-only cases now
finish through scoring and, when needed, an explicit deterministic test Plot
choice. Existing setup/Standard card regressions remain green.

**Required check results:**

| Command                | Result | Evidence                                              |
| ---------------------- | ------ | ----------------------------------------------------- |
| `npm run typecheck`    | PASS   | Main project and engine-only TypeScript checks exit 0 |
| `npm run lint`         | PASS   | Oxlint exits 0 without warnings                       |
| `npm run test:run`     | PASS   | 14 files, 269 tests passing                           |
| `npm run format:check` | PASS   | All matched files follow Prettier style               |
| `npm run build`        | PASS   | TypeScript and Vite build the development scaffold    |

**Rules used:** Game End & Victory Conditions; all user-confirmed Invasion and
Coronation draw/timing interpretations; faction power ranking; Plot timing,
virtual follower and conditional final override; Internal Action Log; and the
draft/commit/irreversibility contracts. No new rule ambiguity was encountered.

**Not verified/remaining:** browser gameplay/UI (M5), controller implementations,
production save validation/replay and earlier-schema migration (M6), and other
Cunning effects/Advanced gameplay integration (M7). Plot's scoring foundation is
implemented; a complete Advanced game is not claimed. Browser content remains
the development scaffold.

**Next milestone:** Milestone 5 — playable React human UI, board/track/courts,
legal card/target/summon choices, previews, Reset/End Turn, privacy handoff,
scoring/Plot panels, and browser/UI verification.

## Milestone 5 — Playable React human UI

**Implemented:** React setup for Standard, two/three Human seats, optional
reproducible seed, and explicit unavailable states for Advanced, Algorithmic, and
unconfigured LLM seats. Unsupported choices disable Begin game with a reason;
they never silently switch modes or controllers. The app requests no external
fonts/assets, backend, or provider. Fresh seeds use browser cryptography outside
the deterministic engine.

An original SVG/CSS schematic renders all eight regions and the exact 13
approved edges. Eight numbered click-only cards separately show struggle order,
resolved status, and negotiation markers. Public courts, hand counts, top
discards, negotiation discs, supply, faction control/discs, and instability are
visible. A public-table projector explicitly selects permitted fields; no full
state/log is passed to board/court components. Accepted history becomes public
struggle/end notices only. Opponents' buried discards and undealt Cunning cards
are excluded. Only the revealed owner's hand enters the rendered hand panel.
Hide hand and every committed turn restore the privacy curtain, including when
the same player next receives control after a struggle.

Card selection uses engine enumeration and a narrowing choice wizard, offering
every legal candidate without a second implementation of rules. Placement
prompts identify the faction/count. Legal region choices can be clicked on the
board, track, or choice panel. The chosen effect is confirmed before the
mandatory post-effect summon, including explicit zero when required. The board
and courts show labeled previews, while a separate committed-position disclosure
remains available. Reset restores the committed position; Pass and card actions
both require a final summary and engine-validated End Turn. Privacy reveal,
effect stages, summon, final summary, and next-player handoff receive keyboard
focus. Native modal confirmation protects New game and supports Escape.

Power-struggle reports and history explain control/instability. Final win/draw
panels expose court comparisons, faction control/recency, action timing, ranking
cases, Plot support, and the exact scoring steps. The Plot-owner terminal choice
panel is integrated with `choosePlot` and tested with legal Advanced fixtures;
normal Advanced gameplay stays unavailable pending Milestone 7.

**Files changed:** replaced `src/main.ts` with the React `src/main.tsx` mount;
updated `index.html`; added `src/ui/App.tsx`, `Setup.tsx`, `Board.tsx`,
`Result.tsx`, `presentation.ts`, `styles.css`, and `App.test.tsx`; enabled TSX
test discovery in Vite and its toolchain regression; updated package/lockfile,
README, design, plan, and this report. The pure engine and authoritative rulebook
were not changed in this milestone. The rulebook's pre-existing 146 additions /
19 deletions remain intact.

**Dependencies:** added only the planned UI test dependencies:
`@testing-library/react` 16.3.3, `@testing-library/user-event` 14.6.8, and jsdom
30.1.3. These supply accessible DOM assertions and realistic input in Vitest;
runtime dependencies are unchanged. Chromium/Playwright were installed only in
temporary QA tooling under `/tmp/king-ui-qa`, outside the repository dependencies.

**Tests added:** 14 tests, for **283 passing tests across 15 files**. UI coverage
includes configured setup/seeds, unsupported mode/controller guards, keyboard
focus, hidden Cunning cards, handoff/hide, card and pass reset, full-preview
reset, effect selection/highlighting, required summon, explicit zero, one-card
commit, both player-count endings, result details, Plot handoff/choice, and
cancel/confirm New game. Projection assertions exclude opponent hands, buried
discards, and undealt Cunning cards. Wizard traversal reaches every legal effect
of every Standard card in the deterministic fixture without losing candidates.
All earlier engine/setup/scoring regressions remain green.

**Browser verification:** real headless Chromium with Playwright against Vite
on `127.0.0.1:5173`, using only public DOM controls:

- Complete 2-player Standard game: all 16 physical cards spent, 30 turns, then
  actual engine result. Complete 3-player Standard game: all 24 cards spent,
  33 turns, then actual engine result. Both include pass-triggered struggles.
- Keyboard-only reveal → card → effect → summon → summary → End Turn → focused
  private handoff; mouse region choice, Reset, and native dialog Escape.
- Inspected screenshots at 1440×900, 1280×800, and 390×844; no horizontal
  overflow, all region controls inside the viewport, eight nodes and 13 edges.
- Refresh returns safely to setup with no saved game, as expected before M6.
- No uncaught browser errors or external resource requests throughout the run.

This is automated browser interaction plus screenshot inspection, not a claim
of manual play on a physical MacBook or verification of the user's port-forwarded
host browser. That external environment remains **NOT VERIFIED**.

**Required check results:**

| Command                | Result | Evidence                                              |
| ---------------------- | ------ | ----------------------------------------------------- |
| `npm run typecheck`    | PASS   | Main project and engine-only TypeScript checks exit 0 |
| `npm run lint`         | PASS   | Oxlint exits 0 without warnings                       |
| `npm run test:run`     | PASS   | 15 files, 283 tests passing                           |
| `npm run format:check` | PASS   | All matched files follow Prettier style               |
| `npm run build`        | PASS   | TypeScript and Vite build the playable React app      |

**Rules used:** Standard card effects and globally maximal partial plans,
post-effect summon, Negotiate-disc and swap anti-undo constraints, draft/commit
boundary, private/public information, power struggles, and M4's scoring/Plot
contracts. No rules or ambiguity resolutions were added to presentation code.

**Remaining:** bots/controller observations, versioned save/resume, validated
production replay, and unconnected LLM adapter (M6); complete Advanced/Cunning
effects including Spy (M7). Refresh deliberately resets the app; no persistence
is claimed. The complete multi-milestone game is not yet finished.

**Next milestone:** Milestone 6 — algorithmic controllers, shared observations,
audit/replay verification, versioned persistence, and provider-neutral mock LLM.

## Post-game log — Milestone 5 follow-up

**Implemented 2026-10-18:** the final-result screen now offers **View game log** /
**Hide game log**. The expandable, scrollable timeline projects the actual
accepted events in chronological sequence, including:

- Original regional and court follower allocations, common supply, removed
  followers, seed, clockwise seats, starting player, struggle order, and discs.
- Every committed card action and pass, turn/action numbers, ordered effects,
  region-card exchanges and negotiation markers, mandatory summons/explicit zero.
- Power struggles with faction counts at resolution, control/instability reasons,
  follower returns, and region-card flips; Invasion/Coronation ending triggers.
- Plot reveal and faction choice when applicable; final win/draw and the recorded
  scoring comparisons for each faction-ranking case.

The log is available only after `finished` with a final result, including waiting
for a pending Plot choice. Historical played actions are shown after the game as
requested; initial/unplayed hands, raw discard arrays, undealt Cunning cards, and
RNG internals are excluded from the view projection. Draft edits and resets
never become entries. The panel receives formatted entries, not raw state or
events. There are no rules-engine/schema changes, new dependencies, or rulebook
edits. This follow-up does not implement M6 persistence or production replay.

**Files:** added `src/ui/finishedLog.ts`, `GameLogPanel.tsx`, and
`gameLog.test.ts`; updated `App.tsx`, `App.test.tsx`, styles, README, design,
and this report.

**Verification:** seven additional tests cover original setup at both player
counts, exact committed effects/summons and passes, no-effect/zero actions,
ordered transfers, plurality/tied/empty struggles, chronological sequence,
Plot finalization/privacy, and keyboard expand/collapse after the final commit.
A reset before that commit produces no extra log entry. All **290 tests across
16 files pass**. Typecheck, lint, formatting, and production build also pass.

Real Chromium completed both Standard games again and checked their logs against
the public game outcomes: 2 players, 16 card actions + 14 passes + 7 struggles;
3 players, 24 card actions + 9 passes + 3 struggles. Each timeline includes one
setup, all turns/struggles, the ending trigger, and final result. Expand/collapse,
keyboard scrolling, and 390px layout passed; desktop/mobile screenshots were
inspected. No uncaught browser errors or external resource requests occurred.
Physical-device/host port-forwarding remains unverified. Games still reset on
refresh until the planned persistence work.

**Next milestone remains:** Milestone 6 — controllers, observations, save/resume,
and validated replay.

## Light and dark appearance — Milestone 5 follow-up

**Implemented 2026-10-18:** a persistent Light/Dark mode control in the header,
available during setup, play, and after the final result. Narrow screens use an
accessible moon/sun icon button. Light remains the default parchment style;
dark uses deep green surfaces, warm gold accents, and brighter faction colors.
Shared CSS variables cover the board/SVG, controls, cards, previews, courts,
notices, dialogs, results, and completed-game log. Native controls follow the
selected color scheme, and the browser theme-color metadata updates with it.

`localStorage` remembers only the appearance preference, under
`king-is-dead:theme`. Initialization applies it before React mounts. Missing or
invalid preferences fall back to light; blocked/full storage does not prevent
changing the current appearance or using the game. Switching palettes preserves
the active player, private hand, and in-progress draft. Games still are not
saved; game persistence remains Milestone 6.

**Files:** added `src/ui/theme.ts`, `ThemeToggle.tsx`, `themes.css`, and
`theme.test.tsx`; updated `main.tsx`, the App header, shared styles, README,
design, and this report. No new dependencies, rules, engine/schema, or log
changes.

**Verification:** four new tests cover persisted selection/restoring light,
invalid preference fallback, blocked storage reads/writes, and switching palettes
without losing an active hand/draft or interrupting the next handoff. All
**294 tests across 17 files pass**. Typecheck, lint, formatting, and production
build pass.

Real Chromium verified keyboard switching, both saved palettes on reload, a
complete three-player game with a card action and subsequent passes, preserved
drafts, private handoff, dialogs, final result, and expanded game log. Desktop,
320px, and 390px layouts have no horizontal overflow. Setup, board, mobile,
dialog, result, and log screenshots were inspected. Eight representative dark
text/background combinations exceeded 4.5:1 contrast, including selected-card
help (5.04:1), preview hints, primary controls, and all three faction counters.
No uncaught browser errors occurred. Physical-device/host forwarding remains
unverified; the selected palette was tested in headless Chromium.

**Next milestone remains:** Milestone 6 — controllers, observations, save/resume,
and validated replay.
