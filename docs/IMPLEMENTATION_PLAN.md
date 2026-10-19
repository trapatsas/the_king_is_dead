# KingIsDead — Agent Implementation Plan

**Authoritative source:** `the_king_is_dead_2nd_edition_rulebook.md`. Read it completely before writing game rules. In case of ambiguity, stop **that rule's implementation**, log the question, and request a user clarification. Continue independent tasks if possible; never substitute an arbitrary default. Once answered, add the clarification to the rulebook, tests, architecture, and kickoff instructions.

**Target stack:** React + TypeScript + Vite + Vitest in the existing Node 24 Dev Container. Work _inside the current repository_, inspecting existing dependencies/configuration rather than blindly replacing them. No backend or live LLM integration.

## Execution protocol for the coding agent

1. Work in the ordered milestones below. Complete checks before moving on; **do not implement all cards or UI in one giant change**.
2. Start each milestone by reading affected rules and existing tests; end with working code, a small demo/test fixture, updated tests, and a concise report of changes, validation results, blockers.
3. Keep game rules independent of presentation, storage and controller implementations. Make engine functions pure and output immutable state; don't mutate inputs.
4. A chosen action must be legal if and only if the authoritative engine accepts it. Never write separate rule logic in components or bots.
5. Use an injectable seeded RNG in setup and bot choices, and store the resulting setup/accepted events; no `Math.random()` inside domain rules or replay.
6. Do not lose the chronological accepted action/pass log; never append draft edits. Preserve it through save/resume.
7. Support both player counts and both game modes in the domain from the outset; ship Standard gameplay first.
8. Any `NOT VERIFIED` result must be reported; no claims of having run commands without running them.

## Milestone 0 — Inspect and verify project tooling

**Status:** Implemented 2026-10-18. See [results and verification](IMPLEMENTATION_STATUS.md#milestone-0--toolchain).

**Tasks**

- Inspect repository, `package.json`, lockfile, Dev Container, Vite, TypeScript, Oxlint and Prettier setup. Keep the existing stack and configuration where valid.
- Confirm Node 24 within container and a working `npm ci` or `npm install`.
- Confirm Vite runs on `0.0.0.0:5173`; no extra backend. Keep `package-lock.json` in version control.
- Add or verify `typecheck`, `lint`, `test:run`, `format:check`, and `build` scripts.
- Add a minimal Vitest test and ensure test discovery works. Add jsdom/React Testing Library/user-event only in the UI testing phase if needed.
- Put supplied rulebook in repository under `docs/rules/` (or reference its existing location); do not rewrite user-confirmed rules.

**Exit criteria**

- `npm run typecheck`, `npm run lint`, `npm run test:run`, `npm run format:check`, `npm run build` all pass.
- Vite server starts and is accessible via forwarded port 5173.

## Milestone 1 — Domain definitions, immutable state and deterministic setup

**Status:** Implemented 2026-10-18. See [results and verification](IMPLEMENTATION_STATUS.md#milestone-1--domain-and-deterministic-setup).

**Tasks**

- Model 8 regions, 3 factions, a symmetric **13-edge graph** from the supplied adjacency list, 8 numbered region-card slots, faction counts, supply, courts, discs, player order and distinct physical card instances.
- Represent the initial seed/RNG state explicitly; choose random start player once during setup, store chosen player.
- Implement 2-player (2 followers/faction removed to box) and 3-player setups. Home regions start with 2 specified faction followers; each region must end setup at exactly 4; each player's court receives 2 random followers; leftover goes to supply.
- Standard setup: 8-card hands, **two distinct Assemble** instances. Advanced setup: remove the 3 Support cards, draw 3 distinct Cunning cards/player from a shared set of 12 without replacement; unused Cunning cards never enter anyone's hand.
- Build `assertGameInvariants(state)` and structured setup events. Track supply, courts, resolved/unresolved region cubes, and removed-to-box counts.

**Tests and exit**

- Verify exact follower conservation by faction: 18 each in 3-player game and 16 active + 2 removed-to-box each in 2-player game.
- Verify exact home initial conditions before random top-up, 4 followers in every region after setup, 8 region-card permutation, all 13 symmetric adjacency edges and correct degrees.
- Verify 8 cards/player, duplicate Assemble distinct IDs, Cunning uniqueness, and reproducibility for same seed and settings.
- No React required for these tests.

## Milestone 2 — Turn framework and power struggles

**Status:** Implemented 2026-10-18. See [results and verification](IMPLEMENTATION_STATUS.md#milestone-2--turn-framework-and-power-struggles).
At its milestone boundary the turn framework used test-only effect definitions;
real Standard definitions are now implemented in Milestone 3. Terminal struggles
halt normal play and emit `GameEndTriggered`; the Milestone 4 scorer now emits
the result or waits for a held Plot's explicit faction choice.

**Tasks**

- Implement canonical committed state and separate `TurnDraft` with reset and preview; no accepted changes until End Turn.
- Add Pass draft/commit, clockwise progression and `consecutivePasses` reset on any accepted card action.
- When all players pass consecutively, resolve exactly one struggle using the **lowest-numbered face-up region card slot**; determine control by strict plurality versus each other faction; top ties or empty region cause instability.
- Transfer all followers in the resolved region to supply, mark region resolved, flip card face-down and prohibit future placements/moves into it.
- Third instability disc terminates immediately as Invasion; otherwise completing the eighth struggle terminates as Coronation. Track latest won struggle by faction using slot position.
- Create a mandatory **post-effect** summon choice from an unresolved region, or explicit zero summon with reason when none exists. Cards with no effect still require summon if available.
- Add typed, append-only `TurnCommitted`, `PowerStruggleResolved`, `GameFinished` events; action sequence increments only for accepted cards, not passes.

**Tests and exit**

- Pass → pass → pass triggers a struggle for 3 players; action between passes resets streak; passing never locks a player out.
- Control on 2–1–1, instability on top ties and on empty region, 3rd instability invasion, all 8 resolved coronation.
- Reset Turn restores all canonical fields, hand/disc/supply and log exactly. End Turn commits immediately and cannot be reverted.
- No follower in any resolved region; no placements there; no cards spent on a pass; no turn accepted after a terminal result.
- Exactly one summon if any follower exists after effect, otherwise zero with recorded reason.

## Milestone 3 — Standard cards and universal legality engine

**Status:** Implemented 2026-10-18. See [results and verification](IMPLEMENTATION_STATUS.md#milestone-3--standard-cards-and-universal-legality).
Headless Standard play runs through the ending trigger; Milestone 4 now adds
automatic final scoring.

**Tasks**

- Implement one common function to enumerate canonical legal effect plans and validate the submitted plan. Avoid moving individually-identifiable cubes; store faction/count transfer steps.
- Introduce global best-achievable **partial-action effect tiers** before displaying available targets. Do not permit choosing a worse target when a better legal plan exists elsewhere.
- Implement the 3 Support cards with faction-specific controlled-region adjacency and the conditional home-region fallback.
- Implement Assemble with 3 faction placements across eligible uncontrolled regions and missing supply cases.
- Implement Negotiate by swapping only two eligible face-up unmarked region cards; place actor's own disc on one swapped card when available; a **spent disc** still permits the eligible swap but no second disc. Marker follows region card rather than board slot.
- Implement Manoeuvre, including same-faction swaps and full-reversal anti-undo of the previous relevant opposing Manoeuvre without intervening card action.
- Implement Outmanoeuvre with 1-for-2 first, 1-for-1 fallback, bordering-region requirement, and corresponding anti-undo handling.
- Every action may be committed with an explicit no-effect plan if its text cannot be performed at any target; summon remains mandatory if possible.

**Tests and exit**

- All 7 distinct standard card types, edge and empty-supply cases, adjacency, marked face-up region-card restrictions, spent Negotiate disc path, same-faction swaps and effect tiers.
- Other players' relevant preceding swaps cannot be completely reversed without a new intervening committed card action. A pass and post-action summon do not release the restriction. Partial non-reversals are legal.
- Complete multi-turn Standard game runs end to end via domain commands (headless scripted play).

## Milestone 4 — Scoring, Plot-ready endgame model, explanation

**Status:** Implemented 2026-10-18. See [results and verification](IMPLEMENTATION_STATUS.md#milestone-4--scoring-plot-endgame-and-result-explanations).
Terminal struggles now finish automatically or reveal a held Plot and await its
owner's explicit choice. Other Cunning effects remain Milestone 7 work.

**Tasks**

- Implement Invasion scores = complete sets in court, then latest action among tied players; if all such players never acted return a draw.
- Implement faction power order by region wins, then latest won slot. If tied factions never won, enumerate every consistent ordering. Declare a unique winner only if all such orderings agree; otherwise draw with the rankings evaluated.
- Coronation: most followers of leading faction → second faction support → Plot override when applicable → earliest last committed card action. Never acted counts earliest; multiple remaining never-acted candidates draw.
- Define `GameResult` as a discriminated win/draw union, with structured explanations and deterministic ranking cases.
- Define a proper **Plot choice phase** for a holder at game end, but don't implement Cunning cards until Milestone 7; scoring code must accept an optional virtual Plot follower without mutating court/supply.

**Tests and exit**

- Every invasion and coronation tiebreak, zero-action fallbacks, zero-win faction permutation, same unique winner across permutations vs different winners, Plot override _after_ follower comparisons.
- A pass does not change the last-action timestamp. Save/replay won't accidentally re-roll winners.
- Terminal game outcomes never depend on player array iteration order where rules supply no such tiebreaker.

## Milestone 5 — Playable React human UI

**Status:** Implemented 2026-10-18. See [results and verification](IMPLEMENTATION_STATUS.md#milestone-5--playable-react-human-ui).
Standard human hotseat games are enabled. Advanced and automated seats are
explicitly unavailable until their respective milestones; they never silently
substitute another mode/controller. Plot's terminal panel is exercised by engine
fixtures while complete Advanced gameplay remains Milestone 7.

**Tasks**

- Add game setup: Standard/Advanced selection, 2/3 players, per-seat Human/Algorithmic/LLM (show clear unconfigured status), reproducible seeded option (optional developer advanced control).
- Render original SVG/CSS schematic showing all eight regions, their follower counts, and the **13 user-approved connections**. Show power-struggle ordering separately as eight numbered draggable-looking-but-click-only region-card slots.
- Render supply, faction discs/control, instability markers, courts, discard-top cards and current player's private hand.
- Implement stepwise interactive card and target selection, valid destination highlighting, accessibility hints, and preview changes separated from committed state.
- Show **Pass**, **Reset Turn**, **End Turn** with a confirmable final plan summary. End Turn must validate engine-side.
- Support keyboard focus and mouse selection; add a privacy handoff curtain when passing between local humans. Never display an opponent's buried discards or secret Cunning cards.
- Add power struggle and result explanation panels; make layout usable on standard MacBook viewport and at narrower widths.

**Tests and exit**

- Use Vitest UI tests with jsdom, React Testing Library and user-event for card selection, pass, cancel/reset, commit, summoned-cube selection, game end and hidden-information views.
- Manually smoke-test mouse and keyboard flows, a 2-player Standard game, a 3-player Standard game, and a pass-triggered struggle.
- Check page reload behavior (save added in Milestone 6); ensure no crash on refresh before then.

## Milestone 6 — Algorithmic controllers, audit log and persistence

**In progress:** the rewritten [research design](BOT_RESEARCH.md) now drives a
Standard MCTS development prototype with public memory, shared simulation,
Worker orchestration and a headless evaluation harness. See
[implementation and benchmark results](BOT_IMPLEMENTATION.md). The normal
algorithmic-seat gate remains closed because the strength criterion has not
passed. The original branching probe remains `node scripts/explore-bot-moves.mjs`.
Persistence, replay and the unconnected LLM adapter remain separate pending work.

**Tasks**

- Implement a shared controller API returning typed legal plans. Start with a seeded legal-random bot; add an inexpensive heuristic bot evaluating court sets/faction support, pending struggles, remaining hand and tempo. Make no claim of expert strength.
- Build one observation projector shared by human player UI and bots. Bots must not see opponents' hand cards, buried discards or unused Cunning cards. _(Done ahead of this milestone: `getObservation` in `src/game/visibility.ts`, already used by the UI. The Standard prototype now receives only witnessed public card plays from the app adapter.)_
- Add typed committed event records containing selected card, effective action, copied source, ordered transfers, disc, summon/zero reason, power struggles, Plot choice, and resulting scoring outcome.
- Implement versioned save/resume (`localStorage` plus optional Export/Import JSON) with canonical committed state, full event log and RNG state; validate schema and invariants on load.
- Implement replay from original setup event and accepted moves, compare reconstructed state to saved state. Explicitly surface corruption or incompatible versions.
- Define provider-neutral `LlmController` interface with deterministic fake responses and validation. Unconfigured LLM must show `NotConfigured` and not start a game as a pretend opponent. **Do not integrate any live provider in this milestone.**

**Tests and exit**

- Headless Standard bot-vs-bot seeded simulations at 2 and 3 players terminate with win/draw as permitted, never violate invariants, and are reproducible.
- Save → resume preserves player turn, state, log, RNG and tiebreak sequences; replay reproduces exact final outcome.
- Invalid bot or mock-LLM move rejected by engine; hidden-info tests confirm no leaks.
- Only committed events are logged; reset drafts leave zero events.

## Milestone 7 — Advanced cards, Spy and Plot

**Tasks**

- Enable full Advanced setup and every Cunning card with the shared legal-plan/partial-action mechanism.
- Implement Spy: choose another player's **visible top discard**; copy its effect (not the physical card ID). With Negotiate, acting player's own disc applies; with Manoeuvre/Outmanoeuvre, effective action identity and anti-undo apply.
- Implement Ambush, March, Aid, Influence, Dispute, Edict, Resist, Quell, Suppress, Muster respecting **ordered steps and global best effect tiers** exactly as in project rulebook.
- Implement Plot as a **held, unplayable** card; at terminal scoring, holder chooses a faction, gaining a virtual follower only for scoring. Handle Invasion sets and Coronation's special final tiebreak (not earlier court-count comparisons).
- Update AI move generation/evaluation for every Cunning effect; bot choosing Plot faction must use only permissible observation.
- Expand endgame UI for Plot choice and explanations.

**Card-specific test matrix**

| Card      | Mandatory corner cases                                                                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Spy       | Only top of other discard; empty opponent discards; spent personal Negotiate disc in both play orders; effective copied swap anti-undo |
| Ambush    | Placement before removal; returned cube may be just placed; low Scottish supply; same region                                           |
| March     | Two together > one; adjacency; can't enter resolved regions                                                                            |
| Plot      | Can't play; virtual only; Invasion sets; Coronation conditional final override; unselected/undealt Plot                                |
| Aid       | Largest supply faction, tied largest choice, supply shortfall, one target region                                                       |
| Influence | 1 English ↔ 2 non-English prioritized over 1-for-1; mixed factions                                                                     |
| Dispute   | Welsh ↔ non-Welsh; no valid exchange                                                                                                   |
| Edict     | 2-for-2 > (2-for-1 or 1-for-2) > 1-for-1; border restriction                                                                           |
| Resist    | Scottish-controlled border or Moray home fallback; non-Scottish mixed placements                                                       |
| Quell     | Welsh removal then placement; removal optional only when none eligible; freshly returned supply available                              |
| Suppress  | English removal, next removal, then placement; progressive no-follower fallback; same region                                           |
| Muster    | Scottish removal then up-to-two placement, home fallback, insufficient supply                                                          |

**Exit criteria**

- Automated 2/3-player Advanced games, including Spy cases and games with Plot, run end to end in headless mode and UI.
- Every Advanced card has explicit deterministic fixtures including insufficient resources and copy interactions.
- No full effect can be bypassed via a deficient target; invariant and full replay tests stay green.

## Milestone 8 — Hardening, complete acceptance and packaging

**Tasks**

- Run large seeded headless regression batches across 2/3 players and Standard/Advanced; collect seeds and action logs for any failing scenario.
- Run a no-summon scenario, unresolved Invasion and Coronation ties, repeated passes, disconnected-looking graph edges, same-faction swaps and all disc/Plot oddities.
- Audit visibility of hidden hand and buried discard information in JSX, UI tooltips, bot inputs, exported public logs and console messages.
- Ensure `README.md` documents how to run the app (`npm install`, `npm run dev`), control keys, modes, game limitations, seed/replay, and how the agent validates rules.
- Optional: add GitHub Actions for typecheck/lint/test/build (no backend needed). Avoid unrelated tooling and cosmetic dependencies.

**Final acceptance checklist**

- [ ] Play entire 2-player Standard game against algorithmic bot.
- [ ] Play entire 3-player Standard game with any combination of local human/algorithmic controllers.
- [ ] Play entire 2-player Advanced game, including Spy and Plot when dealt.
- [ ] Play entire 3-player Advanced game, including endgame choices when Plot is held.
- [ ] The approved board adjacency graph has exactly 13 undirected edges.
- [ ] End Turn irreversibly commits; Reset Turn fully resets any draft or draft pass.
- [ ] Mandatory summon selects one **after effect**, or records zero when unavailable.
- [ ] Every action's highest legal partial-effect tier is enforced globally.
- [ ] All project-specific corner cases match the rulebook; unresolved ties are explainable terminal draws.
- [ ] Another human's buried discards and hidden hand do not appear in player UI/agent observations.
- [ ] Bot controller uses the same rules and legality checks as human UI.
- [ ] LLM adapter tests pass with fakes; live integration remains **explicitly not configured**.
- [ ] Save/resume/replay reproduces setup, turn timing, action log and final outcome.
- [ ] `npm run typecheck` PASS.
- [ ] `npm run lint` PASS.
- [ ] `npm run test:run` PASS.
- [ ] `npm run format:check` PASS.
- [ ] `npm run build` PASS.
- [ ] Actual browser gameplay smoke test performed (not inferred from build success).

## Reporting format after each milestone

```text
Milestone:
Implemented:
Files changed:
Tests added:
Checks run with actual result (PASS / FAIL / NOT VERIFIED):
Rulebook references used:
Open ambiguities requiring user clarification:
Next milestone:
```

**Definition of done:** The user can play **the supplied project rules**, not a simplified approximation; the rule engine and bots share legality; reproducible tests, complete accepted action history and save/resume work; the UI handles all turn and scoring decisions; no silent house rules or fictitious LLM opponent.
