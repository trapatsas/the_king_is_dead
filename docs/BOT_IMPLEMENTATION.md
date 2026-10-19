# Standard bot implementation and evaluation

Implemented 2026-10-19 from the rewritten [research design](BOT_RESEARCH.md).
This is a playable development prototype, `standard-mcts-v2`. The research
release gate remains closed; Advanced, persistence and LLM integration are
separate unfinished work.

## Try the prototype

```sh
npm run dev
```

Open `http://localhost:5173/?bots=experimental`, choose **Standard**, and change
one or more controllers to **Algorithmic · experimental**. Two or three seats
are supported, including all-bot games. Human seats retain private handoffs;
bots act automatically without revealing their hands. The thinking panel has a
retry action if computation fails. Leaving a game cancels its worker.

The query enables the preview only in a development server. Normal setup and
production builds continue to gate algorithmic seats until the research exit
criteria pass. It is not an expert-strength claim.

## What is implemented

- `src/bot/observation.ts`: reconstructs Standard simulation positions from the
  existing redacted observation and public card memory. `src/app/botObservation.ts`
  strips accepted history down to witnessed face-up card plays and a cursor.
  Neither the private setup record nor real seed/RNG enters the Worker.
- `src/bot/simulation.ts`: raw Standard rule enumeration, global maximum-tier
  filtering, seeded sampling and trusted complete-turn transitions. Public
  commits and search share turn finalization, summon arithmetic, anti-undo,
  struggles and scoring. Search uses structural copies, not a duplicated mutable
  rule engine. Submitted plans still pass the full public engine validation.
- `src/bot/evaluation.ts`: per-seat court strength relative to opponents,
  projected faction control weighted by margins/track distance, Invasion set
  progress and risk, remaining cards and action timing. Terminal outcomes use
  exact engine results: win 1, loss 0, draw `1 / contenders` for contenders.
  Nonterminal values are heuristic preferences, not calibrated probabilities.
- `src/bot/search.ts`: multiplayer MCTS with actor-specific UCT selection,
  averaged utility vectors, heuristic bias, progressive widening, epsilon-greedy
  rollouts and exact-position tree reuse. Two Assemble copies are grouped; every
  distinct maximum-tier effect and legal summon remains sampleable.
- `src/bot/worker.ts`, `client.ts`, `src/ui/useBotTurn.ts`: asynchronous search,
  cancellation by worker termination, an independent watchdog, retry, and stale
  game/seat/turn protection. Only the final validated plan reaches accepted logs.

Each iteration extends a new tree path far enough that its two rollout turns
reach five complete turns at two players or seven at three, unless terminal
scoring occurs sooner. This includes the root action and the bot's next two
opportunities to act. The finite search still samples only a fraction of the
legal continuations. It cannot claim forced wins from a favourable rollout.

The browser requests up to 1,024 iterations with a 1,400 ms search cap; a separate
2,500 ms watchdog handles worker failures. Fixed-iteration headless runs omit
the time cap and inject their own search seed. Exact tree reuse also depends on
the prior search history; fresh instances reproduce fresh-instance decisions.

## Reproduce the evaluation

```sh
npm run bot:benchmark -- --bot=one-ply --opponent=random --seeds=100 --prefix=heldout-bot-v1
npm run bot:benchmark -- --seeds=100 --iterations=128 --prefix=validation-bot-v2
npm run bot:benchmark -- --seats=3 --seeds=34 --iterations=128 --prefix=validation-bot-v2
```

Each setup seed is reused with the tested controller rotated through every
seat. The random baseline samples pass with probability one third, otherwise a
card type, a legal maximum-tier effect and a legal summon. It is not uniform
over all complete turns. The one-ply baseline evaluates pass plus twelve sampled
complete turns per distinct card type using the same evaluator. Its successors
are exact, but its candidate set is not exhaustive.

Every real match move passes `turnEngine.commitTurn`, independently of the
trusted simulator. The runner checks the finite turn bound. Output includes
per-game outcomes and draw contenders, scores, search depths and counts. The
95% intervals bootstrap whole setup-seed clusters, preserving the dependency
between seat rotations. These intervals describe these fixed policies and
seeds, not performance against humans.

| Tested policy           | Opponents                | Seats | Games / seeds | Score | 95% seed-bootstrap interval |
| ----------------------- | ------------------------ | ----- | ------------- | ----- | --------------------------- |
| Sampled one-ply         | Random                   | 2     | 200 / 100     | 84.0% | 79.0–89.0%                  |
| MCTS v2, 128 iterations | Sampled one-ply          | 2     | 200 / 100     | 69.5% | 63.0–75.5%                  |
| MCTS v2, 128 iterations | Two sampled one-ply bots | 3     | 102 / 34      | 46.1% | 39.2–52.9%                  |

Scores share one point between drawn contenders; baseline neutral scores are
50% with two seats and 33.3% with three. These results do **not** meet the stated
70% strength gate. The larger browser budget has not yet had a comparable
hundreds-of-games strength evaluation.

Raw results:
[one-ply/random](benchmarks/standard-oneply-random.json),
[two-player MCTS](benchmarks/standard-mcts-v2-two.json),
[three-player MCTS](benchmarks/standard-mcts-v2-three.json).

The first tree version scored 63% over 200 two-player games and sometimes failed
to reach seven plies in three-player openings, even at 1,024 iterations. That
identified the need to extend new paths. V2 reached the requested depth in about
86.7% / 86.9% of iterations in the two/three-player benchmark, with other paths
ending earlier. Terminal leaves were approximately 34.8% / 27.8% overall. These
whole-game statistics do not establish the research hypothesis that most
midgame lines reach final scoring.

## Browser and regression checks

Headless Chromium completed two all-bot Standard games: 32 turns at two seats
and 48 turns at three. Maximum search times were 1,401.5 / 1,402.8 ms; maximum
animation-frame gaps were 33.4 / 16.8 ms. These are local desktop/container
measurements, not guarantees for slower devices. The run also checked mixed
human/bot handoff, absent bot hands, final logs, cancellation by leaving the
game, and a 390-pixel mobile layout, with no uncaught browser errors.

Regression tests compare simulation results with public commits over sixteen
complete seeded games, reconstruct all hands from public plays after every
turn, check privacy and reproducibility, and exercise exact terminal scoring.
Tactical positions cover winning Invasion/Coronation passes, avoiding a losing
third instability, completing a set, conserving cards with a winning pass and
postponing a losing struggle with Negotiate. Worker/controller tests cover
cancellation, stale replies, retry, worker failure and watchdog termination.

## Remaining release work

1. Profile candidate evaluation and raw enumeration in browsers. The design's
   thousands-of-truncated-simulations-per-second target has not been established
   on target devices. Retain structural copies unless a measured bottleneck
   justifies a more invasive simulator representation.
2. Improve and evaluate strength with separate tuning and held-out seed sets,
   including the actual browser budget. Extend the version ladder and compare
   against broader/exhaustive one-ply candidates on tractable positions.
3. Add dedicated opponent-set-denial and leading-support-preservation fixtures,
   plus human play-testing for exploitable pass/kingmaking behaviour. Existing
   tactical checks are useful but not the full research suite.
4. Keep the setup gate closed until the specified strength/tactical/latency bars
   pass. A three-player score should always be reported separately from a
   two-player win rate; do not silently change the research's 70% criterion.
5. Implement full Cunning effects before determinization/ISMCTS or bot Plot
   choices. No Advanced samples are currently generated or accepted.

## Follow-up: opening card use and public logs

A six-opening audit at 128 iterations (`browser-bot-2`, `browser-bot-3`,
`opening-audit-1`, `opening-audit-2`, with two/three bot seats) confirmed exactly
one card consumed per card turn. All three two-player games used both hands
before the first struggle on turn 18. In the three-player games, the first
struggle was on turns 27, 26 and 27, with only one card retained across all seats
in the middle case. These observations identify a tendency to spend cards too
early, not a multiple-cards-per-turn engine bug. They do not establish that
spending every card early is strategically best. Card conservation and pass
policy need further strategy work and comparative evaluation.

The UI now accepts player/bot names and displays each seat's last accepted card
or pass, with effect/summon details. A UUID game ID identifies each game in a
local public-log archive. Logs can be searched by ID/name and reopened after
reload, including partial games. Archive entries contain public projections,
not engine state, private hands, undealt cards or RNG. The seed is added only
after a game finishes. This archive does not implement game resumption or
cross-device/server storage.
