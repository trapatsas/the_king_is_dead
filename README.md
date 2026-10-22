# KingIsDead

A local-first implementation of **The King Is Dead — Second Edition**, following
the [project ruleset](the_king_is_dead_2nd_edition_rulebook.md) for two or three
independent players.

**Current stage: Milestones 0–5 complete; Milestone 6 in progress.** Standard games are playable in the browser for
two or three local human players, with immediately available cards, legal action choices,
draft previews, and full result explanations. Easy, Medium and Hard bots are
available in normal setup in both development and production builds.
Save/resume and Advanced gameplay follow the ordered
[implementation plan](docs/IMPLEMENTATION_PLAN.md). See the
[milestone report](docs/IMPLEMENTATION_STATUS.md) for verification.

## Run locally

Use the supplied Dev Container or Node 24:

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
