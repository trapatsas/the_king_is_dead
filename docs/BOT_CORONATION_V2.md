# Coronation tactics and training continuations

The recorded game `king-c0253275-1aef-4383-9733-69ad7dc93f47` ended with
Scottish controlling four regions and TRAP holding six Scottish followers,
against Informed's four and ML's one. ML spent four actions collecting Welsh
followers despite Welsh being unable to lead after struggle seven. The saved
linear model was substantially optimistic in these losing positions.

## Changes

- `src/bot/coronation.ts` proves a leading faction from resolved discs: its
  wins must strictly exceed every rival's wins plus all remaining regions.
  There must also be fewer unresolved regions than remaining instability
  discs, ruling out Invasion. A faction tie or possible Invasion falls back to
  normal search and scoring.
- Informed's forecast uses this proof instead of soft faction probabilities.
  Its last-region root policy collects the relevant faction while behind or
  while available stock can let an opponent catch it. It prefers spending
  otherwise unusable cards, retains production cards, and minimizes newly
  created winning support left for opponents. It preserves an immediate
  winning pass and does not generate followers when waiting already wins.
- ML shares this root policy and bypasses learned leaf evaluation throughout
  a proven Coronation endgame. The deployed weights and feature format remain
  unchanged. Nonterminal values are still estimates; the proof settles the
  leading faction, not the winning player.
- Informed and ML policy versions are now `informed-mcts-v2` and
  `ml-mcts-v2`. Live capture and generated games record these versions.
- `ml:branch` creates complete legal continuations from authoritative saved
  games; `equal-family-v1` weighting prevents one heavily branched setup from
  dominating a frozen dataset. See [commands and data semantics](../ml/README.md).

## Verification

The regression fixture is the public observation and witnessed cards before
turn 33. Tests cover collecting the leading faction for all three faction
identities, using Assemble without leaving a new winning follower for the
next seat, a losing pass with only one search iteration, excluding the learned
model in a proven endgame, rejecting uncertain faction leads and possible
Invasions, and legal alternate summons. Repository tests verify that related
continuations share a split and that each deduplicated family has total
training weight one.

The initial run generated 16 branches from turns 27, 33, 36 and 45 at 32
iterations, plus 30 fresh Reference/Patient/Informed games at two and three
seats with 10% random replacements and two random opening turns. All 46 games
passed replay validation. The family-weighted export contains 2,179 positions
from 13 setup families: train 1,771 / 10 families; validation 170 / 1 family;
test 238 / 2 families. The Python trainer successfully read and validated all
three splits. Local artifacts are `artifacts/ml/coronation-family-v1.sqlite`
and `artifacts/ml/coronation-branches-v1.json`; the capture database is
`.data/coronation-training-v1.sqlite`. This is a small development dataset,
not evidence that a retrained model is stronger.

An exploratory fixed-iteration comparison used four new setup seeds per seat
count and all seat rotations, with the revised Informed bot against the
previous version: 50% across eight two-player games and 33.3% across twelve
three-player games. These are neutral scores, so this check does not establish
a general playing-strength improvement. It does show that the specific case
fix is not accompanied by a loss in this small screen. Raw results and the
baseline revision are in [the comparison report](benchmarks/coronation-v2-comparison.json).

Validation: all 420 Vitest tests, type checking, lint, production build, five
Python trainer tests and 13 SQLite-contract checks passed. All changed files
pass formatting. The full formatting command still reports the pre-existing
`.devcontainer/devcontainer.json` and the supplied display archive.

This change improves a specific endgame policy; broader human strength and
checkpoint promotion require independent evaluation. It does not change
Reference or Patient. New training continuations are teacher outcomes rather
than expert move-imitation labels, and do not automatically update live
weights. A nonlinear candidate model can be trained using the existing
`--hidden=32` or `--hidden=128` trainer, then compared with the linear baseline
on independent setup families and equal-time matches before deployment.
