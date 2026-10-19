# KingIsDead

A local-first implementation of **The King Is Dead — Second Edition**, following
the [project ruleset](the_king_is_dead_2nd_edition_rulebook.md) for two or three
independent players.

**Current stage: Milestones 0–5 complete; Milestone 6 in progress.** Standard games are playable in the browser for
two or three local human players, with private handoffs, legal action choices,
draft previews, and full result explanations. A Standard MCTS bot is available
in an explicit development preview; its strength release gate remains closed.
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

## Try the experimental Standard bot

With the development server running, open
`http://localhost:5173/?bots=experimental` and select **Algorithmic · experimental**
for one or more seats. Each bot has a **Bot strategy** selector: **Reference**
keeps the original aggressive policy; **Patient** reserves cards for later
responses and can wait for others to commit; **Informed** ranks its options
against what every seat can still do with the cards they hold and keeps card
parity so it has the last word. All three can play with humans and each other. Bots run in a Worker and play automatically. The preview
supports two or three players; ordinary setup and production builds remain gated
because the research strength criterion has not passed. See the
[implementation and measured results](docs/BOT_IMPLEMENTATION.md) and the
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
2. Pass the device to the named player, who reveals their hand.
3. Choose a card, follow its legal effect choices, then summon a follower. The
   board and courts show a labeled preview.
4. Review the summary and select **End Turn** to commit. **Reset Turn** restores
   the committed position. Passing also needs End Turn.

When everyone passes consecutively, the next struggle resolves.

- **Board or panel:** click highlighted regions, region cards or follower
  tokens on the map, or use the same choices in the side panel. Each token
  click selects one follower; click a faction twice to choose two.
- **Keyboard:** focus follows each step through effect, summon, summary and
  handoff, including after choices made on the board.
- **Appearance:** **Dark mode**/**Light mode** in the header (moon/sun on narrow
  screens). The choice is remembered on this browser and never resets a game.
- **Last moves:** each player court shows the latest accepted card or pass and
  its turn number. **Move details** lists the effect and summon. Draft choices
  remain private until committed.
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
connected and the app requests no external resources.

## Privacy between players

Hands are absent from the page until their owner reveals them, and the privacy
curtain returns after every End Turn. Courts, supply, control discs,
instability, and the top card of each discard pile are public. Buried discards
and other hands never are. The setup seed is shown only after the game ends,
because in Advanced games it would let anyone recompute the hidden Cunning
deal. Everything on screen comes from the engine's redacted per-seat
observation, also used by the Standard bot. The bot remembers publicly witnessed
plays from setup to infer remaining Standard cards; see
[hidden information](docs/ENGINE_API.md#hidden-information).

This is a shared-device game with no backend. Players are trusted not to open
browser developer tools.

## Project references

- [Authoritative rules](the_king_is_dead_2nd_edition_rulebook.md)
- [Engine and API reference](docs/ENGINE_API.md)
- [Architecture and contracts](docs/HIGH_LEVEL_DESIGN.md)
- [Ordered milestones](docs/IMPLEMENTATION_PLAN.md)
- [Algorithmic opponent exploration](docs/BOT_DESIGN.md)
- [Bot research and annotated bibliography](docs/BOT_RESEARCH.md)
- [Bot implementation, preview and benchmarks](docs/BOT_IMPLEMENTATION.md)
- [Patient strategy and reference comparison](docs/PATIENT_BOT.md)
- [Informed strategy: review, design and benchmarks](docs/BOT_INFORMED.md)
- [Agent kickoff and first-task scope](docs/AGENT_KICKOFF_PROMPT.md)
