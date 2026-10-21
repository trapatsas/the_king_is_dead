# ML bot implementation and first pilot

Implemented 2026-10-21. The initial learned-value pipeline is usable end to end:
SQLite capture/replay, feature encoding, frozen datasets, CPU training/export,
shared TypeScript inference, Worker/UI integration, benchmarks and manual
self-play generation. This implements the foundation and first pilot of
[BOT_ML_PLAN.md](BOT_ML_PLAN.md), not its later strength/promotion milestones.
See [the runnable workflow](../ml/README.md) for commands.

## Behavior and integration

`ml-mcts-v1` reuses Informed's legal candidate generation, rollout evaluation,
pass/root preferences and limited spent-opponent beam search. A 474-feature
neural value model evaluates leaves; the bundled pilot blends learned and
baseline values equally. Weight zero follows the original Informed leaf path
without inference. Exact terminal scoring bypasses the model. Reference,
Patient and Informed retain their decision policies; their regression tests
pass unchanged.

Inputs are encoded only from public-memory Standard reconstructions or their
simulated successors. The encoder preserves track order, courts, real remaining
card inventories, null action timing and directed swap memory. Canonical seat
outputs are restored before search uses them. Two-seat padding is masked before
softmax and training loss. No setup seed/RNG, names or controller labels enter
model features.

The synchronous runtime accepts a bounded dense/ReLU model description and
checks layer shapes, finite weights, model/feature versions and SHA-256 before
use. It adds no npm inference dependency. Browser preparation downloads the
model only for ML turns, uses a separate 15-second watchdog, and supports
cancellation/retry. Warm search retains the existing 1.4-second soft cap and
2.5-second watchdog. SHA-256 verification uses Web Crypto; browser ML play
requires localhost or HTTPS. Device-specific performance remains unvalidated.

## SQLite and training tooling

The Node repository uses Node 24's built-in SQLite module and the two versioned
SQL migrations. Schema checksums, bound statements, foreign keys, WAL and atomic
accepted-command batches protect history. Exact repeated requests are
idempotent; conflicting/stale commands fail. Public API reads return redacted
observations/logs. The private database is denied by the Vite file server.

Live Standard games save through a same-origin development/local-preview API.
A per-request local outbox retains pending typed commands across reload and
keeps separate tabs from overwriting each other's games. Failed saves are
visible and retryable; an available server can still save when browser storage
is full. Active-game UI resume is still separate unfinished work;
accepted history survives through SQLite and the existing public browser log.

Completed games must replay to identical events, checkpoints and final results
before ML admission. Features are cached as float32 BLOBs. Dataset membership
is frozen with a content hash, setup-family splits, trajectory deduplication
and equal-total-game weights. Portable training-only SQLite exports omit names
and raw private states. Human collection needs no model/background analysis.
Bot diagnostics on accepted turns record budget, seed, search statistics and
actual model identity where available; exploratory random replacements have
no fabricated search record. Failed/cancelled Worker attempts are not yet sent
to SQLite.

The Python trainer uses pinned CPU PyTorch/NumPy, read-only indexed batch loads,
masked outcome cross-entropy, AdamW, early stopping, best-model export and
resumable optimizer checkpoints. It never implements rules or assigns realized
outcomes to unplayed alternatives. Linear and two-hidden-layer MLP models are
available. TypeScript/Python parity fixtures accompany exported artifacts.

## First dataset and checkpoint

Generated `ml-boot-pilot-v1` with Reference/Patient/Informed teachers, 16
iterations, 5% random replacements, ten setup seeds at each seat count and all
seat rotations:

| Quantity                                 | Observed                                                           |
| ---------------------------------------- | ------------------------------------------------------------------ |
| Recorded games                           | 50                                                                 |
| Actual visited positions                 | 2,375                                                              |
| After identical-trajectory deduplication | 47 games / 2,341 positions                                         |
| Training                                 | 28 games / 1,279 positions                                         |
| Validation                               | 18 games / 883 positions                                           |
| Internal test                            | 1 setup family, 3 games / 179 positions; not used to tune/train    |
| MLP architecture                         | 474 → 128 ReLU → 128 ReLU → 3 logits                               |
| Parameters / weight bytes                | 77,699 / 310,796                                                   |
| Checkpoint                               | `ml-pilot-62c91415c3d9`                                            |
| Weights SHA-256                          | `62c91415c3d946f6e8e5c9a500353d41bba6b91f166d77311cb6c5d3a061b407` |
| Dataset manifest hash                    | `420487d5d0522f163b8064b174b15f0b485dc824952373769927ce452179c438` |

Best MLP validation cross-entropy was 0.8953 (two-seat 0.5916, three-seat 1.0471).
The linear baseline scored **0.8637**, better on aggregate validation loss than
the MLP in this small sample. That is evidence to retain the linear comparison
and collect broader data, not to enlarge the MLP by assumption. The bundled MLP
is an integration pilot, not a promoted model selected by a strength gate.

Inputs, datasets and optimizer files remain under ignored `.data/` and
`artifacts/ml/`; the selected manifest/weights/parity fixture are under
`public/models/pilot/`. This checkpoint is explicitly `pilot-unvalidated`.

## Checks and measurements

- Python/TypeScript parity: maximum absolute logit difference
  `2.384185791015625e-7` on the exported fixture.
- Local Node inference medians over five measured repeats after warmup:
  batch 1: 0.365 ms; 16: 2.045 ms; 64: 4.996 ms; 512: 40.235 ms.
  These small local samples are not target-device latency guarantees.
- Chromium completed all-ML games at two seats (35 turns) and three seats
  (59 turns). Every accepted turn and corresponding search record reached
  SQLite; no uncaught page errors or failed API/model responses were observed.
  Subsequent offline replay/materialization validated all 94 positions.
- Maximum measured search time in these browser runs was about 1.408 / 1.482 s
  at two/three seats. The cap is checked between iterations; concurrent local
  work contributed contention. No 2.5-second watchdog failures were observed.
- Ten generated ML/teacher/self-play smoke games completed and replay-validated,
  including interrupted-run reuse of completed records; 468 visited positions.
- The full Vitest suite passed: 32 files, 398 tests. An earlier run under
  concurrent browser/generation load hit an existing Patient test's five-second
  timeout; the full rerun passed without changing its timeout or assertions.
- Five Python training checks cover masked gradients, dataset validation and
  model dimensions; all 13 SQL-contract checks also pass.
- The built local-preview API accepted setup/turn requests and redacted the seed.
  A mixed human/ML browser check saved a human pass with a Greek player name,
  drained its outbox, and confirmed direct database HTTP access returned 403.
- Typecheck, lint, full formatting check, browser/backend build and migration
  rollback/retry checks pass.

Tiny fixed-iteration matchup checks, 32 iterations per side:

| Matchup                      | Games / setup seeds | ML score |
| ---------------------------- | ------------------- | -------- |
| ML vs Informed, 2 seats      | 6 / 3               | 58.3%    |
| ML vs two Informeds, 3 seats | 6 / 2               | 33.3%    |

Raw records: [two seats](benchmarks/ml-pilot-two.json),
[three seats](benchmarks/ml-pilot-three.json). These are smoke comparisons,
with too few setup clusters for a useful strength conclusion. The three-seat
bootstrap interval collapses because each sampled seed has the same aggregate
score; it is not evidence of precise generalization. Equal-time comparisons,
large held-out cohorts and human strength testing remain to be done. The
production bot release gate is unchanged.

## Remaining phases

Learned proposal ordering/ranking, auxiliary heads, global final-test exclusions,
explicit source/seat-balanced sampling, automated opponent pools and promotion,
legacy public-log reconstruction, browser state resume and target-device/human
strength evaluation remain future work. The tooling now supports collecting
human games and iterating frozen checkpoints without depending on those phases.
