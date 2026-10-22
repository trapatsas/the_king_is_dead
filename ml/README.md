# ML bot and training workflow

The browser's **Hard bot** uses the v2 linear checkpoint
`ml-pilot-69f477be34b9`, packaged in `public/models/linear-v2/`. It reuses Informed's
legal candidates, rollouts and root rules with a learned, masked outcome-value
evaluator at leaves, blended equally with the baseline. It supports two and
three Standard seats. Difficulty labels are relative; Advanced and automatic
promotion remain outside this implementation.

The original pilot stays in `public/models/pilot/` for reproducible research
comparisons. Headless tools keep explicit model paths (and their original pilot
default); supply `--model=public/models/linear-v2/manifest.json` to use the browser
checkpoint there.

## Play and collect human games

Use Node 24 and start from the repository root:

```sh
npm ci
npm run dev
```

Open `http://localhost:5173/`. Use the single **Player type** menu to choose **Human**, **Easy bot** (Patient),
**Medium bot** (Informed), or **Hard bot** (ML v2). Agent names stay visible in
setup and during play. Model assets load only when a Hard turn starts. Human
cards/actions appear immediately with no private-screen handoff.

Standard games, including human games, save accepted typed commands to
`.data/king.sqlite` through the same-origin API. The server validates each move
with the existing engine and commits event/projection/checkpoint/result rows
atomically. Set `KING_DB_PATH` before starting Vite to use another file.
Pending saves survive reload in a per-request browser outbox when browser
storage is available; the UI reports
save errors and provides retry. Public browser Game history still uses its
existing local archive. Reloading does not restore the active game UI yet.

The local `npm run build && npm run preview` flow builds and serves both the
browser app and a Node API bundle (`dist-server/api.mjs`). Static-only hosting
needs that API deployed separately; it cannot save SQLite files by itself.
Keep the database and the Node API on trusted local/server disk. The dev server
denies direct access to databases, checkpoints and training directories. Do not
serve the private source database as a public download.

## Set up the isolated CPU trainer

```sh
npm run ml:setup
npm run ml:test
```

This creates `ml/.venv`, bootstrapping a pinned pip wheel if the host Python
lacks ensurepip, then installs the pinned CPU PyTorch/NumPy environment from
`requirements-lock.txt`. No npm runtime dependency was added; Node's built-in
`node:sqlite` performs storage. Python dependencies stay out of the browser and
engine. `ml/setup.py --venv=<path>` supports a different environment location.
Windows users can run the Python commands with that environment's interpreter.

## Generate, validate and freeze a dataset

A small bootstrap run with teachers, noise, repeated setups and seat rotations:

```sh
npm run ml:generate -- --db=.data/training.sqlite --seeds=10 --seats=2,3 --iterations=32 --prefix=ml-boot-v2
npm run ml:dataset -- --db=.data/training.sqlite --name=bootstrap-v2 --cohort=ml-boot-v2
npm run ml:export -- --db=.data/training.sqlite --name=bootstrap-v2 --out=artifacts/ml/bootstrap-v2.sqlite
```

Ten seeds at both seat counts produce 50 games. Defaults use Reference, Patient
and Informed, 5% random action replacement and no random opening. Options:
`--policies=reference,patient,informed,random,ml`, `--noise=0.05`,
`--openings=2`, and `--model=<manifest>` for ML seats. These are complete legal
turns, not actions from another rules implementation.

Generation resumes by deterministic game IDs. Completed games are verified and
skipped. For an interrupted game it replays prior searches too, restoring tree
and RNG history before appending. A changed policy/config gets a different game
ID; mismatching existing decisions are rejected. Do not run two generators with
the same configuration against the same database concurrently.

Each completed trajectory is replay-validated against all stored events and
checkpoints before feature admission. Inputs use public observations and
witnessed plays. Features are 474 little-endian float32 values (1,896 bytes)
with explicit seat mapping; terminal labels are mapped to that frame. Only
actual visited positions receive the actual outcome.

Dataset construction deduplicates trajectories, assigns setup families to
80/10/10 splits using a deterministic split seed, and freezes membership/hash.
Weights give each included game equal total weight, rather than favoring long
games. Sources and seat counts remain queryable. The current builder does not
enforce a global final-holdout registry or a chosen human sampling percentage:
keep final evaluation data in a separate database and curate cohort/source mixes.
A new dataset name is required after changing membership/configuration.

To train on collected human games:

```sh
npm run ml:materialize -- --db=.data/king.sqlite
npm run ml:dataset -- --db=.data/king.sqlite --name=human-v1
npm run ml:export -- --db=.data/king.sqlite --name=human-v1 --out=artifacts/ml/human-v1.sqlite
```

Materialization includes completed Standard games only. Incomplete games remain
stored and unlabeled. If a tiny cohort yields no independent validation family,
collect/generate more setups. Raw version-1 display archives cannot be directly
used; a legacy importer is not implemented.

## Train and check a model

```sh
ml/.venv/bin/python ml/train.py --data artifacts/ml/bootstrap-v2.sqlite --out artifacts/ml/model-v2 --hidden 128 --epochs 30
npm run ml:verify -- --model=artifacts/ml/model-v2/manifest.json
```

The trainer streams batches from a read-only SQLite export, masks the absent
seat before cross-entropy, uses AdamW and validation-based early stopping,
and saves optimizer/model state, learning curves, metadata and a best checkpoint.
`--hidden 0` trains the linear baseline; widths 32, 64, 128 and 256 are supported.
The 128-wide MLP has 77,699 parameters. No test-split results influence training.

Resume explicitly:

```sh
ml/.venv/bin/python ml/train.py --data artifacts/ml/bootstrap-v2.sqlite --out artifacts/ml/model-v2 --hidden 128 --epochs 60 --resume artifacts/ml/model-v2/checkpoint.pt
```

The artifact is a bounded dense/ReLU architecture manifest plus hash-checked
float32 weights. Python exports golden inputs/logits; `ml:verify` compares them
with the same synchronous TypeScript runtime used in Node and browser, and
profiles batches 1, 16, 64 and 512. No ONNX/asynchronous search refactor is needed.
The default learned/control blend is 0.5; `--learned-weight=0` is the Informed
control, `1` uses only the learned leaf value. Changing it is an experiment, not
a model promotion.

## Evaluate and iterate

To run one three-player game with Informed, the original ML pilot and your
trained v2 linear model in separate seats:

```sh
npm run ml:match -- --seed=informed-pilot-v2-1 --iterations=1024 --timeMs=1400 --out=artifacts/ml/informed-pilot-v2-one.json
```

The default lineup is [informed-pilot-v2.json](../scripts/ml/lineups/informed-pilot-v2.json).
It requires the v2 artifact at `artifacts/ml/model-v2-linear/manifest.json`.
Each seat has a separate bot instance and its own model identity. The runner
saves accepted moves, per-seat model provenance and search statistics to
`.data/ml-matches.sqlite`, then replay-validates/materializes the completed game.
The JSON report includes final scoring and the full public game log under
`game`. This is a headless match; it does not change browser model selection.

Use `--lineup=<file>` for a JSON array of two or three `{ "name", "strategy" }`
entries, with a `"model"` manifest path for each `"ml"` seat. Paths resolve from
the working directory. `--db=<file>` selects another source database. Reports
require a new output path and never overwrite existing files. Omit `--timeMs`
for fixed-iteration reproduction; with a time cap, search choices can vary.
One game is a case study; compare multiple setups and seating permutations
before drawing strength conclusions.

For **60 games across 20 setup seeds**, with each bot occupying every seat once
per seed, use three cyclic rotations:

```sh
npm run ml:match -- --seeds=20 --rotations=3 --seed=informed-pilot-v2-screen --iterations=128 --out=artifacts/ml/informed-pilot-v2-60.json
```

Every game starts with fresh search trees. The batch freezes both models at
startup and saves every completed game and public log in the report, including
per-player win/draw/loss counts, shared-draw scores and setup-cluster bootstrap
intervals. Progress goes to the terminal; the report updates atomically after
each completed game. An interrupted/failed batch keeps completed games in the
report and accepted moves in SQLite; automatic batch resume is not implemented.
Three cyclic rotations cover all seats, while preserving clockwise relative
order; they do not cover all six three-player seating permutations. For the
browser search budget, replace `--iterations=128` with
`--iterations=1024 --timeMs=1400` (a substantially slower run).

```sh
npm run bot:benchmark -- --bot=ml --model=artifacts/ml/model-v2/manifest.json --opponent=informed --seeds=50 --iterations=128 --prefix=ml-promote-v2-two
npm run bot:benchmark -- --bot=ml --model=artifacts/ml/model-v2/manifest.json --opponent=informed --seats=3 --seeds=20 --iterations=128 --prefix=ml-promote-v2-three
```

Use `--timeMs=1400 --opponentTimeMs=1400 --iterations=1024` for an equal-time
comparison. Fixed iterations are the reproducibility/control comparison, not a
claim of equal compute. Separate ML opponents can use
`--opponent=ml --opponentModel=<champion-manifest>`.

New self-play data can use a frozen checkpoint:

```sh
npm run ml:generate -- --db=.data/training.sqlite --seeds=10 --seats=2,3 --iterations=128 --policies=ml,patient,informed --model=artifacts/ml/model-v2/manifest.json --prefix=ml-gen-v2
```

Keep generations immutable and evaluate candidate/champion separately. The
current tooling supports manual generation/training/evaluation cycles; an
automated opponent reservoir, promotion service, ranking head and Gumbel search
are future phases. Historical outcome labels are not expert move-imitation
labels, and games against humans should not automatically change live weights.

After evaluation, deploying a checkpoint means placing its `manifest.json`,
parity fixture and immutable weights under a new `public/models/<checkpoint>/`
directory, selecting its manifest in `src/bot/ml/deployment.ts`, and rebuilding.
The browser loader and SQLite setup provenance share that selection. Existing
game setup retries retain their originally recorded model provenance.
Keep its model ID/hash in reports. The Worker caches one loaded checkpoint for
that game's lifetime; restart the game to use a new deployment. Model preparation
has a separate 15-second watchdog; warm searches keep the 1.4-second soft cap
and 2.5-second watchdog. Load/hash/version failures show retry without switching
strategies.

## Verification and implementation evidence

```sh
npm run typecheck
npm run lint
npm run test:run
npm run format:check
npm run build
npm run ml:test
python3 docs/sqlite/validate_training.py
```

See [implementation report](../docs/BOT_ML_IMPLEMENTATION.md),
[ML plan](../docs/BOT_ML_PLAN.md), and
[SQLite contract](../docs/SQLITE_TRAINING.md). Generated databases, model
optimizer checkpoints and the Python environment are ignored by git; only the
selected pilot assets and small reports are checked in.
