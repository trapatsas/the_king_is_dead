# Informed bot: card-aware forecast and tempo

`informed-mcts-v2` is the third selectable Standard strategy, built after a
review of the [Reference](BOT_IMPLEMENTATION.md) and [Patient](PATIENT_BOT.md)
bots. It shares their legality, simulation, scoring, multiplayer MCTS and
Worker plumbing; it changes what the search proposes, how it values positions,
and when it acts. Both older strategies are preserved unchanged for comparison.
The production release gate is unchanged by this work.

The v2 change addresses the [TRAP game case study](BOT_CORONATION_V2.md): once
resolved control discs prove which faction must lead, and too few unresolved
regions remain for Invasion, the forecast assigns that faction full leading
probability. In the final region the root policy collects scarce winning
support before an opponent can take it. It spends otherwise unusable cards
first and avoids leaving newly created winning followers for the next seat.
This rule applies before the ordinary passing margin, including searches too
small to expand a card at the root. Immediate winning passes and the
spent-opponent solver retain precedence. The ordinary 0.12 margin is retained
for positions without this proof.

## Review of the existing bots

**Reference** samples a few random effects per card and a random summon at every
expansion, so with up to 512 Assemble effects and ~20 summons it rarely sees
the best complete turn. Its evaluator softens region control by a global
"cards remaining" temperature even though Standard is perfect information: every
seat's remaining cards are public. It spends cards early.

**Patient** keeps that search and adds an exact all-pass forecast at leaves,
never passes into a proven loss, and banks proven wins. It beats Reference
(98% / 92%) mainly by conserving cards. Its weaknesses: the same blind
candidates, an opening pass margin so large that two Patients resolve the
setup board almost untouched (first struggle around turn 8–9 in self-play), and
a one-ply rule once opponents are spent.

Measured on a midgame position: reference evaluation 5.5 µs, patient
evaluation 11.6 µs, exact all-pass forecast 23 µs, scoring every effect of a
64-effect Assemble 0.4 ms. There is ample budget to rank candidates rather than
sample them.

## The decisive observation: tempo

The first Informed build had better candidates and a card-aware forecast but
lost **19 of 20** games to Patient. Traces showed why. In a deterministic game
with public hands, whoever still holds cards when the last struggles resolve
has the last word. Informed kept acting when the all-pass line already
favoured it; Patient answered each move, and by the end Informed was one card
short of ever replying. A second effect reinforced this: with a five-turn
horizon the leaf follows the searcher's own move, so an exact forecast at the
leaf always looks as if the searcher moved last.

The fix is to model card parity explicitly:

- **Forecast confidence depends on card lead.** The all-pass outcome is trusted
  most for a seat holding more cards than every opponent, less at parity, little
  when behind, and least with an empty hand while opponents can still act.
- **Tempo term.** The evaluation values holding at least as many cards as the
  strongest opponent, fading as the board locks up.
- **Pass when already winning.** If the exact all-pass line already wins
  outright, pass: keep parity and let opponents spend first.
- **Root margin.** A card must beat passing by a clear search margin; this
  single parameter had the strongest measured effect.

With these, the same build went from 0/20 to 16/20 against Patient.

## How it decides

1. **Reconstruct** the Standard position from the redacted observation and the
   witnessed public plays (unchanged privacy boundary).
2. **Propose ordered candidates** (`propose` hook in `search.ts`). Pass first.
   For each held card type: enumerate maximum-tier effects, cheaply score a
   sample (all 64 at the root, 6 inside the tree), keep the best effects plus
   one random one, rank each one's legal summons by a court-gain versus
   region-damage heuristic, then fully value the top summons. The tree consumes
   proposals best first with 15% exploration and falls back to sampling once a
   node's list is exhausted.
3. **Value positions** with a blend of the card-aware heuristic and the exact
   all-pass forecast, weighted by parity-aware confidence.
   - Per unresolved region: leader margin against each opposing seat's real
     swing capacity from the cards it holds (Support +2 where eligible,
     Outmanoeuvre +3, Manoeuvre +2, Assemble +1, plus the summon). Regions no
     one can flip count as decided; contested regions and ties stay soft.
   - Faction ranking probabilities from forecast power; coronation support for
     the first and second factions; invasion sets; option value only for cards
     that can still do something; the tempo term.
4. **Search** with the shared max^n MCTS (unchanged constants, horizon and
   rollouts).
5. **Choose at the root.** Never pass into a proven loss; take a proven win;
   pass if the all-pass line already wins; otherwise play only if the best card
   beats passing by the margin (larger when the hand is below a small reserve).
6. **Endgame solver.** Once every opponent is out of cards, the all-pass
   continuation after the bot's own sequence is exact, so a depth-3 beam search
   over its own cards replaces the tree's estimate. This generalises Patient's
   one-ply rule and finds two-card winning sequences (covered by a test).

Every chosen plan still passes `turnEngine.commitTurn`, independently of the
trusted simulator.

## Parameters

`InformedBot` accepts `Partial<InformedParams>`; the Worker and UI use
`DEFAULT_INFORMED_PARAMS`. The benchmark runner reads `INFORMED_PARAMS` as JSON
from the environment and records it in its output.

| Parameter                        | Default                | Meaning                                                   |
| -------------------------------- | ---------------------- | --------------------------------------------------------- |
| `tempo`                          | 0.6                    | Score per card of lead over the strongest opponent        |
| `option`                         | 0.5                    | Scale of per-card option value                            |
| `confBase`, `confSlope`          | 0.2, 0.3               | Forecast confidence floor and slope with opponents' cards |
| `parityAhead/Level/Behind/Empty` | 1.4 / 0.8 / 0.45 / 0.3 | Confidence multipliers by card parity                     |
| `margin`                         | 0.12                   | Root: search value a card needs over passing              |
| `passWhenWinning`                | true                   | Root: pass when the exact all-pass line already wins      |

## Tuning (separate seed sets, 128 iterations per side, 2 seats unless noted)

Set A, prefix `informed-tuning-a`, 10 seeds / 20 games against Patient:

| Variant                                  | Score | 95% seed-cluster interval |
| ---------------------------------------- | ----- | ------------------------- |
| Before the tempo model                   | 5%    | 0–15%                     |
| Same, after two wiring fixes             | 0%    | 0–0%                      |
| Tempo model, margin 0.03                 | 80%   | 65–95%                    |
| Tempo 1.0, lower level/behind confidence | 75%   | 55–95%                    |
| `passWhenWinning` off                    | 60%   | 35–80%                    |
| Tempo model vs **Reference**             | 95%   | 85–100%                   |
| Tempo model vs two Patients, **3 seats** | 70%   | 57–83% (neutral 33%)      |

Set B, prefix `informed-tuning-b`, 20 seeds / 40 games against Patient:

| Variant                                              | Score | 95% interval         |
| ---------------------------------------------------- | ----- | -------------------- |
| Margin 0                                             | 55%   | 40–70%               |
| Margin 0.03 (set-A default)                          | 72.5% | 60–85%               |
| Margin 0.08                                          | 80%   | 67.5–92.5%           |
| **Margin 0.12** (chosen default)                     | 95%   | 87.5–100%            |
| Margin 0.2                                           | 81%   | 70–91%               |
| Parity multipliers off (all 1.0)                     | 70%   | 57.5–82.5%           |
| Option 0.8                                           | 72.5% | 55–87.5%             |
| Margin 0.08, Patient at 320 iterations (≈ equal CPU) | 77.5% | 67.5–87.5%           |
| Margin 0.12, Patient at 320 iterations (≈ equal CPU) | 65%   | 45–82.5%             |
| Margin 0.12 vs two Patients, **3 seats** (10 seeds)  | 63%   | 47–80% (neutral 33%) |

Informed costs roughly 2–2.5× Patient's CPU per iteration (about 0.2 s per
128-iteration search in Node, uncontended), because it values ranked candidates
instead of random ones. The equal-CPU rows show the advantage survives a deeper-searching Patient,
though reduced; the two margins are indistinguishable at this sample size.
Because the browser applies one wall-clock cap to every strategy, Patient
completes more iterations there than Informed, so the equal-CPU rows are the
better guide to live play.

## Held-out validation

Prefix `informed-heldout-v1`, never used for tuning, default parameters, 128
iterations per side, every seat rotation.

| Matchup                    | Games / seeds | Informed score | 95% seed-cluster interval |
| -------------------------- | ------------- | -------------- | ------------------------- |
| vs Patient, 2 seats        | 100 / 50      | 87.0%          | 81.0–93.0%                |
| vs two Patients, 3 seats   | 60 / 20       | 83.3%          | 75.0–91.7%                |
| vs Reference, 2 seats      | 60 / 30       | 86.7%          | 76.7–95.0%                |
| vs two References, 3 seats | 45 / 15       | 86.7%          | 77.8–93.3%                |

Raw records: [Patient, two](benchmarks/informed-patient-two.json),
[Patient, three](benchmarks/informed-patient-three.json),
[Reference, two](benchmarks/informed-reference-two.json),
[Reference, three](benchmarks/informed-reference-three.json).

The two-seat results are balanced across seat order: against Patient, Informed
scored 88% from the first seat and 86% from the second; against Reference, 93%
and 80%. Patient self-play, by contrast, favoured the second seat 13–7 in a
20-game baseline.

Scores share one point between drawn contenders. Neutral is 50% at two seats
and 33.3% at three. These are results against two fixed bot policies with
fixed budgets; they are not a measurement against humans and do not by
themselves satisfy the research release gate.

## Reproduce

```sh
npm run bot:benchmark -- --bot=informed --opponent=patient --seeds=50 --iterations=128 --prefix=informed-heldout-v1
npm run bot:benchmark -- --bot=informed --opponent=patient --seats=3 --seeds=20 --iterations=128 --prefix=informed-heldout-v1
npm run bot:benchmark -- --bot=informed --opponent=reference --seeds=30 --iterations=128 --prefix=informed-heldout-v1
INFORMED_PARAMS='{"margin":0.08}' npm run bot:benchmark -- --bot=informed --opponent=patient --seeds=20 --iterations=128 --opponentIterations=320 --prefix=informed-tuning-b
```

## Code

- `src/bot/informed.ts`: forecast, evaluation, proposals, endgame solver, root
  policy and parameters.
- `src/bot/search.ts`: optional `propose` hook with a per-node proposal queue;
  the root may now adopt a legal plan the policy computed outside the tree.
  Reference and Patient behaviour is unchanged (snapshot test still passes).
- `src/bot/informed.test.ts`: determinism and legality, the three recorded
  Patient positions observed by an Informed seat, immediate wins and losing
  third-instability intervention, and a two-card winning sequence once
  opponents are spent.
- `scripts/benchmark-bot.mjs`: `informed` policy, `INFORMED_PARAMS`,
  `--opponentIterations`.
- Setup, courts, thinking panel and archive labels via `BOT_STRATEGY_LABELS`.

## Limitations and next steps

- The three-seat game is harder: two opponents can both keep parity. Kingmaking
  is not modelled beyond max^n.
- Swing capacity is a per-card maximum, not a plan; it ignores whether an
  opponent would actually spend a card on that region.
- Browser budget: at the 1,400 ms cap Informed completes fewer iterations than
  Patient. Measure on target devices before any release decision.
- Advanced mode is unsupported, like the other bots.
- Human play-testing has not been done for this strategy.
