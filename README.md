# KingIsDead

A local-first implementation of **The King Is Dead — Second Edition**, following
the [project ruleset](the_king_is_dead_2nd_edition_rulebook.md) for two or three
independent players.

**Current stage: Milestones 0–5.** Standard games are playable in the browser for
two or three local human players, with private handoffs, legal action choices,
draft previews, and full result explanations. Bots, save/resume and Advanced
gameplay follow the ordered [implementation plan](docs/IMPLEMENTATION_PLAN.md);
Advanced and automated seats are visibly unavailable in setup. See the
[milestone report](docs/IMPLEMENTATION_STATUS.md) for verification.

## Run locally

Use the supplied Dev Container or Node 24:

```sh
npm ci
npm run dev
```

Vite listens on `0.0.0.0:5173`; the Dev Container forwards port 5173. Open
`http://localhost:5173`. The fixed port fails explicitly if occupied.

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

1. Choose Standard, two or three Human seats and, optionally, a setup seed.
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
- **After the game:** the result explains every comparison. **View game log**
  shows the committed history, seed and starting player.

**Games are not saved yet:** refreshing returns to setup. Starting another game
asks before discarding the current one. If an unexpected error interrupts a
turn, **Restart this turn** resumes from the last committed turn. No provider is
connected and the app requests no external resources.

## Privacy between players

Hands are absent from the page until their owner reveals them, and the privacy
curtain returns after every End Turn. Courts, supply, control discs,
instability, and the top card of each discard pile are public. Buried discards
and other hands never are. The setup seed is shown only after the game ends,
because in Advanced games it would let anyone recompute the hidden Cunning
deal. Everything on screen comes from the engine's redacted per-seat
observation, which future bots will share; see
[hidden information](docs/ENGINE_API.md#hidden-information).

This is a shared-device game with no backend. Players are trusted not to open
browser developer tools.

## Project references

- [Authoritative rules](the_king_is_dead_2nd_edition_rulebook.md)
- [Engine and API reference](docs/ENGINE_API.md)
- [Architecture and contracts](docs/HIGH_LEVEL_DESIGN.md)
- [Ordered milestones](docs/IMPLEMENTATION_PLAN.md)
- [Algorithmic opponent exploration](docs/BOT_DESIGN.md)
- [Agent kickoff and first-task scope](docs/AGENT_KICKOFF_PROMPT.md)
