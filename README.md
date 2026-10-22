# KingIsDead

A local-first implementation of **The King Is Dead — Second Edition**, following
the [project ruleset](the_king_is_dead_2nd_edition_rulebook.md) for two or three
independent players.

Standard games are playable for two or three humans or bots, with legal action
choices, draft previews, automatic bot turns and full result explanations.
Completed and in-progress Standard histories save to SQLite when the local Node
API is available. Advanced gameplay and active-game resume are not implemented
yet; refreshing returns to setup.

## Run locally

Use the supplied Dev Container or **Node.js 24.x**. Python is optional and only
needed for training and SQL-contract checks; playing the game requires no
Python environment, GPU or external model service.

```sh
npm ci
npm run dev
```

Vite listens on `0.0.0.0:5173`; the Dev Container forwards port 5173. Open
`http://localhost:5173`. The fixed port fails explicitly if occupied.

## Play against bots

With the development server running, open
`http://localhost:5173/`. Each seat has one **Player type** menu:

| Choice     | Underlying agent                      |
| ---------- | ------------------------------------- |
| Human      | Local human player                    |
| Easy bot   | Patient                               |
| Medium bot | Informed                              |
| Hard bot   | ML v2, the trained linear value model |

Agent names remain visible below the selection and in the game courts/thinking
panel. Hard now uses checkpoint `ml-pilot-69f477be34b9` from
`public/models/linear-v2/`; the original pilot and Reference bot remain available
in research tools. The difficulty names are relative choices, rather than
validated human ratings. See [ML setup, SQLite capture and training commands](ml/README.md).
Bots run automatically in a Worker and support two or three players.
No experimental URL parameter is required.
See the [implementation and measured results](docs/BOT_IMPLEMENTATION.md) and
[Informed strategy's review, design and benchmarks](docs/BOT_INFORMED.md).

## Play locally

1. Choose Standard, two or three seats, names for the players/bots and, optionally, a setup seed.
2. The active human player’s cards and actions appear immediately, including after End Turn.
3. Choose a card, follow its legal effect choices, then summon a follower. The
   board and courts show a labeled preview.
4. Review the summary and select **End Turn** to commit. **Reset Turn** restores
   the committed position. Passing also needs End Turn.

When everyone passes consecutively, the next struggle resolves.

- **Board or panel:** click highlighted regions, region cards or follower
  tokens on the map, or use the same choices in the side panel. Each token
  click selects one follower; click a faction twice to choose two.
- **Keyboard:** focus follows each step through effect, summon, summary and
  the next turn, including after choices made on the board.
- **Appearance:** **Dark mode**/**Light mode** in the header (moon/sun on narrow
  screens). The choice is remembered on this browser and never resets a game.
- **Last moves:** each player court shows the latest accepted card or pass and
  its turn number. **Move details** lists the effect and summon. Draft choices
  enter the log only after they are committed.
- **Game history:** every new game has a unique ID beside its heading. Select it
  or use **Game history** to reopen a saved public log by ID or player name.
  Logs include setup followers, moves and struggles; finished logs also include
  the seed and final result. Logs stay in this browser after reloading. Use
  **Copy log** or **Download log** on the selected game to share its public JSON
  for review; an ID alone cannot retrieve another browser's stored log.
- **After the game:** the result explains every comparison. **View game log**
  shows the committed history, seed and starting player.

**Game positions cannot be resumed yet:** refreshing returns to setup; saved
public logs remain available. Starting another game asks before leaving the
current one. If an unexpected error interrupts a
turn, **Restart this turn** resumes from the last committed turn. No provider is
connected. The local development/preview server now saves accepted Standard
games to SQLite through same-origin API calls; model assets are served locally.

## SQLite storage and production preview

`npm run dev` saves accepted Standard moves to `.data/king.sqlite`. The server
validates commands with the same rules engine and stores moves, checkpoints,
results and bot/model provenance. Failed saves remain in a browser outbox for
retry; a pending-save message appears when the API is unavailable. The public
browser log is separate from the private SQLite history.

To choose a different database on a POSIX shell:

```sh
KING_DB_PATH=.data/my-games.sqlite npm run dev
```

To build and preview the normal production app:

```sh
npm run build
npm run preview
```

The build produces the browser app in `dist/` and the Node API bundle in
`dist-server/api.mjs`; preview serves both. Static-only hosting can run the game,
but SQLite capture needs a Node server adapter and persistent writable storage.
Browser ML inference uses Web Crypto and requires localhost or HTTPS.

## Training and mixed bot matches

The [ML workflow](ml/README.md) covers SQLite collection, dataset freezing,
training, model verification and evaluation. CPU training requires Python 3.11+
and the isolated environment created by `npm run ml:setup`. Optional checks:

```sh
npm run ml:setup
npm run ml:test
python3 docs/sqlite/validate_training.py
```

Mixed matches need only Node and the packaged model assets. For 60 games across
20 setups, rotating Informed, the original ML pilot and v2 through all three
seats:

```sh
npm run ml:match -- --seeds=20 --rotations=3 --seed=mixed-3p-v1 --iterations=128
```

The command prints its report path under `artifacts/ml/matches/` and saves
accepted games to `.data/ml-matches.sqlite`. Three cyclic rotations preserve
clockwise relative order; they do not cover all six seating permutations.
Use `--lineup=<file>` to select other agents/checkpoints. Training and human
games do not automatically update the deployed model.

## Verify

```sh
npm run typecheck
npm run lint
npm run test:run
npm run format:check
npm run build
```

`npm test` starts Vitest in watch mode. `npm run typecheck` also compiles the
engine with ES2022 libraries and no DOM/Node globals.

## Repository contents

Version control includes source, SQL migrations, tests/fixtures, dependency
lockfiles, documentation, selected benchmark/case-study records and the packaged
model manifests, parity fixtures and weights. The two immutable `.bin` files
under `public/models/` are intentional exceptions to the binary ignore rule:
v2 powers Hard, while the original pilot supports reproducible comparisons.
They let a fresh checkout run without retraining or model downloads.

`.gitignore` excludes dependencies, builds, caches, virtual environments, logs,
temporary exports, databases and SQLite sidecars, and generated ML checkpoints
or tensors, including those created outside `.data/` or `artifacts/`. Synthetic
SQLite examples are regenerated using
[`docs/sqlite/validate_training.py`](docs/sqlite/validate_training.py), rather
than committed. Adding an ignore rule does not remove files already tracked;
generated files must also be removed from Git's index.

## Cards and public information

The active human player's hand is displayed immediately. End Turn switches to
the next player automatically; there is no reveal/hide screen. Bot turns show
thinking status instead of manual card controls. Courts, supply, control discs,
instability and the top discard are public. Other players' hands, buried discards
and undealt Cunning cards stay outside the rendered observation. The setup seed
appears only after the game ends. Everything on screen comes from the engine's
redacted per-seat observation, also used by the Standard bot. The bot remembers
publicly witnessed plays to infer remaining Standard cards; see
[hidden information](docs/ENGINE_API.md#hidden-information).

This is a shared-device game; Standard game history also saves to the local
Node/SQLite service when it is available.

## Project references

- [Authoritative rules](the_king_is_dead_2nd_edition_rulebook.md)
- [Engine and API reference](docs/ENGINE_API.md)
- [Architecture and contracts](docs/HIGH_LEVEL_DESIGN.md)
- [Ordered milestones](docs/IMPLEMENTATION_PLAN.md)
- [Algorithmic opponent exploration](docs/BOT_DESIGN.md)
- [Bot research and annotated bibliography](docs/BOT_RESEARCH.md)
- [Bot implementation, preview and benchmarks](docs/BOT_IMPLEMENTATION.md)
- [ML bot implementation and pilot](docs/BOT_ML_IMPLEMENTATION.md)
- [ML training workflow](ml/README.md)
- [SQLite capture and training contract](docs/SQLITE_TRAINING.md)
- [Patient strategy and reference comparison](docs/PATIENT_BOT.md)
- [Informed strategy: review, design and benchmarks](docs/BOT_INFORMED.md)
- [Agent kickoff and first-task scope](docs/AGENT_KICKOFF_PROMPT.md)
