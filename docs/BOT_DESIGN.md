# Algorithmic opponent exploration

Explored 2026-10-19 against the committed Standard engine. This is a proposed
implementation and a reproducible move-generation probe, not an implemented bot
or a playing-strength claim. It refines the controller portion of Milestone 6;
persistence, production replay, and full Advanced play remain separate work.

## Recommendation

Start with an explainable Standard heuristic bot, alongside a seeded legal-random
baseline. Both choose engine-generated turns and submit them through the existing
commit boundary. Rank the card effect and its subsequent summon together. Preserve
a small, diverse shortlist for exact successor evaluation; introduce sampled
lookahead only after legality, privacy, speed, and baseline strength are measured.

This game rewards choosing which factions win and when regions settle, while
collecting court support. A bot must remain flexible about faction allegiance,
protect against Invasion, and conserve its eight cards. Simply maximizing court
size or always taking the currently strongest faction misses these tradeoffs.

## What already works

- `turnEngine.getAvailableCards`: playable physical cards for the active seat.
- `enumerateEffectPlans`: canonical effects at the globally greatest achievable
  tier, including no-effect plans, negotiation markers, and swap anti-undo.
- `previewTurn`: applies a legal effect and produces mandatory post-effect summon
  choices, including explicit zero; a complete draft previews both together.
- `commitTurn` / application `endTurn`: revalidates and atomically accepts a turn,
  advancing clocks, consuming the card, resolving consecutive passes and struggles,
  and finalizing scoring as appropriate.
- Seeded RNG, immutable state, inventory invariants, exact scoring/tiebreaks, and
  accepted event records already exist. The UI has a limited view projection.

The missing pieces are a shared controller observation boundary, efficient batch
candidate preparation, a policy/evaluator, controller orchestration, and a
strength/latency harness. Algorithmic seats should remain unavailable until those
pieces are implemented and tested.

## Measured branching and cost

Run the read-only probe with the existing dev dependencies:

```sh
node scripts/explore-bot-moves.mjs
```

It loads the TypeScript engine through Vite in middleware mode without opening an
HTTP server. It counts complete legal turns as one pass plus each physical card's
legal effects paired with every permitted post-effect summon. Counting reuses
engine effect execution and summon enumeration; it does not materialize, evaluate,
or commit every complete plan. There are no new rules or dependencies.

Eight deterministic opening positions, four seeds at each player count:

| Players | Complete turns, including pass and both Assemble instances |
| ------- | ---------------------------------------------------------- |
| 2       | 23,947; 30,061; 29,659; 25,605                             |
| 3       | 23,955; 27,342; 27,784; 29,866                             |

Every sampled opening had 512 effects per Assemble card, with 9,152–10,496 complete
effect/summon combinations per physical Assemble. These samples are not an upper
bound for every reachable position.

In the first container run, counting all choices took about 12–17 ms per position.
On `bot-exploration-3-0`, a warmed 32-effect Assemble sample averaged about 4.2 ms
per public `previewTurn` and 4.2 ms per complete `commitTurn`. These are Node
container timings, not browser latency guarantees or bot evaluation timings.

The public API intentionally re-enumerates, validates, clones, and freezes legal
plans on each preview/commit. Calling it independently for tens of thousands of
complete candidates is expensive. The fast count above does not demonstrate that
exhaustive evaluation already meets an interactive budget.

## Keep legality in the engine

Build a trusted engine/application candidate-preparation layer that enumerates
each card's legal effects once, applies each effect once, then generates summon
choices from that resulting position. Reuse the existing engine operations and
global-tier checks; do not copy card rules into the heuristic.

Use a cheap public-state evaluator to rank complete effect/summon combinations
incrementally. Retain perhaps 16–32 candidates across different cards, factions,
and target regions, plus pass. This size is a tuning starting point, not a proven
optimum. Avoid building an enormous array of cloned full states or sending it all
to a worker.

The two identical Assemble copies can share strategic evaluation while retaining
an actual held card ID in the chosen plan. Do not merge other moves merely because
their follower counts match: negotiation discs, track order, swap memory, hand
cost, and final-action timing can change their consequences.

Exactly simulate shortlisted turns through the engine. In particular, a pass
preview currently returns the unchanged state; it does not simulate the struggle.
Card previews also omit card consumption and clock advancement. A policy that
scores previews as complete successors would miss terminal passes and timing
tiebreaks. Use committed successor simulation for those evaluations, then submit
the selected plan through the normal, fully validating commit path.

Shortlisting is a strength/speed tradeoff and can miss good moves. Preserve pass
as a separate candidate, test tactical coverage explicitly, and benchmark against
broader evaluation before reducing the shortlist aggressively. A proven immediate
win takes priority over a positional estimate; a known losing terminal pass should
not be chosen when a legal card can keep the game going.

## Information boundary

Keep full `GameState`, the setup seed/RNG cursor, and `GameSession.events` inside
the trusted engine/application layer. The policy receives a typed observation
containing its own hand, permitted own discards, all courts and hand counts,
opponent discard tops, region followers/control, track/discs, public timing and
pass count, and the engine-provided legal choices. It never receives opponents'
hands, buried discard arrays, undealt cards, or the post-game full history.

A worker is a responsiveness mechanism, not an information filter. Passing full
state to the bot in a worker would still let it cheat. Candidate features and
successor observations must be projected before the policy can inspect them.

Do not generate opponent replies by reading the real opponent hands. If later
search needs hidden hands, sample plausible hands from information legitimately
available to that seat, using separate controller randomness. Public memory could
be an explicit later capability; it must not silently come from the internal log.

Advanced needs another safeguard: speculative terminal simulation using the real
hidden hands can reveal an opponent's held Plot, or its scoring effect, before the
game has actually ended. Do not expose those counterfactual secrets through a
candidate's result. First deliver Standard, where Plot is absent; design Advanced
search around permissible information sets rather than an oracle into real hands.

## First useful heuristic

| Concern         | What the bot should value                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Actual ending   | Exact engine win/draw/loss and official tiebreaks; never replace a recorded draw with a made-up winner                                  |
| Invasion        | Complete court sets relative to the strongest opponent, progress toward the next set, and the danger/opportunity of a third instability |
| Coronation      | Relative court support for factions likely to finish first and second, including controlled-region count and victory recency            |
| Next struggle   | Whether the move changes the next contested region's likely winner or instability, and whether the opponent can still intervene         |
| Summon          | Court gain together with the regional damage from removing that follower; evaluate after the effect                                     |
| Card economy    | Spending a scarce action now versus preserving flexible effects for later; no automatic preference for emptying the hand                |
| Tempo and order | Pass streak, remaining opponent hand counts, negotiation changes to struggle order, and conditional final-action timing                 |

Use actual controlled regions as facts and unresolved regions as forecasts.
Near-term struggles deserve more weight than distant regions that can still be
changed. Do not treat a projected faction ordering as certain or use an arbitrary
ordering for factions that remain tied under the project rules. Blend plausible
Coronation outcomes with Invasion risk rather than scoring only one ending.

Weights and forecasts are heuristic choices to tune, not new game rules. For
three players, compare against the threatening opponents separately; assuming
that both always sacrifice their own chances to oppose the bot is a poor default
model of independent seats. Terminal utility can use win = 1, loss = 0, and a
declared draw preference such as 1 divided by the number of contenders when the
bot is among them. This convention ranks bot choices; it does not change results.

The policy should return a short explanation, such as “complete a court set while
preserving Welsh control in the next struggle.” Log the actual accepted move as
usual; keep forecasts and abandoned candidates out of accepted game history.

## Baseline, responsiveness, and search

The random baseline should choose pass deliberately, then a card/effect/summon
hierarchically when acting. Uniformly sampling all complete plans makes pass
almost nonexistent in the measured openings and overweights cards with many
equivalent choices. Give the baseline an explicit documented pass probability
and seed its decisions separately from setup randomness.

Aim initially for a few hundred milliseconds per heuristic turn on the target
browser, and measure generation, projection, evaluation, simulation, and worker
transfer costs separately. Prefer fixed operation/sample budgets for reproducible
choices, with a separate cancellation/watchdog mechanism. Every async result must
match the current game instance, player, and turn/event cursor; discard stale
results after New game or other state changes. Show a visible thinking/error
state, prevent human controls acting for bot seats, and do not reveal bot hands.

After the heuristic beats the baseline and tactical tests, test limited rollouts
on the shortlist. For three independent players, maintain one utility per player.
Max-n and multiplayer UCT provide established models for independent player
objectives, with practical opponent-modeling limitations; this supports testing a
multiplayer approach rather than importing two-player coalition assumptions.
[Sturtevant, An Analysis of UCT in Multi-Player Games](https://webdocs.cs.ualberta.ca/~nathanst/papers/multi-player_UCT.pdf).

For genuinely unknown cards, Information Set MCTS searches across information
sets rather than treating one secretly known state as available to the agent. It
is a later candidate, not evidence that it will outperform this game's heuristic.
[Cowling, Powley, and Whitehouse, Information Set Monte Carlo Tree Search](https://eprints.whiterose.ac.uk/id/eprint/75048/).

## How to establish “valid and decent”

1. Every selected turn passes the existing engine validator; conservation,
   anti-undo, disc ownership, maximum partial tiers, and mandatory summons hold.
2. Changing only hidden opponent hands/undealt cards leaves observations and
   Standard bot decisions unchanged; future Advanced candidate preparation must
   also avoid leaking hypothetical Plot reveals. Never seed the bot from private
   setup RNG state.
3. Tactical fixtures cover taking an immediate winning pass, avoiding a losing
   third-instability pass, completing/denying sets, preserving leading-faction
   support, track manipulation, and conserving cards when passing is better.
4. Seeded two- and three-player simulations reproduce decisions and accepted
   events. With eight cards per player and eight struggles, normal Standard play
   has a bound of `n × (8n + 8)` committed turns: 48 at two players and 96 at
   three. At most `n−1` passes can precede a card without a struggle; each
   struggle consumes `n` passes. This matches the existing simulation guard.
5. Run paired seeds with controller assignments swapped across seats. At three
   players, test one heuristic versus two random bots and two heuristics versus
   one random bot, alongside all-heuristic games. Report wins/draws/losses and
   contender membership, sample size, and uncertainty; do not manufacture wins
   from draws or claim strength from self-play alone.
6. Use separate seed sets to tune and evaluate. Start with hundreds of games and
   record decision latency. Play human games to find exploitable mistakes that
   random-opponent results miss. No win rate is measured in this exploration.

## Suggested implementation slices

1. Shared redacted observation/controller types and engine-backed batch candidate
   preparation, with privacy and legality tests.
2. Seeded random baseline and headless simulation/latency harness.
3. Public-state heuristic, exact shortlisted successors, tactical regressions,
   and seat-balanced evaluation versus the baseline.
4. Human-versus-bot and mixed three-player UI orchestration, cancellation, and
   visible thinking/error states. Enable only the implemented Standard bot seat.
5. Tune from recorded results; add sampled lookahead if the evidence supports it.

The remaining Milestone 6 save/replay and unconnected LLM contracts still need
their own implementation and verification. No live model/provider is necessary
for this opponent.
