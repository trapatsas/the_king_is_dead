# KingIsDead — Coding Agent Kickoff Prompt

You are implementing **KingIsDead** as a React + TypeScript + Vite web game, using Vitest for automated tests, in the existing VS Code Dev Container.

## Before doing anything

Read completely, in this order:

1. `the_king_is_dead_2nd_edition_rulebook.md` — **authoritative** rules for this project.
2. `HIGH_LEVEL_DESIGN.md` — architecture and contracts.
3. `IMPLEMENTATION_PLAN.md` — ordered milestones and acceptance criteria.
4. Existing `package.json`, `devcontainer.json`, Vite/TypeScript settings and repository source.

**Do not use general knowledge or the publisher's rulebook to override any project-specific rule.** In ambiguous cases, ask the user and do not silently choose a house rule. Update the project rulebook, tests and planning documents after any clarification.

## Mission

Build a complete, reliable, local-first implementation of **The King Is Dead — Second Edition, Project Ruleset for 2–3 Players**, including Standard and Advanced rules, using a pure deterministic TypeScript rules engine, React UI, interchangeably controlled human/algorithmic seats, and a provider-neutral, unconnected LLM adapter with deterministic test doubles.

Develop in small, verifiable milestones, **starting with Milestone 0 and Milestone 1 only**. At the end of each milestone, report actual code/files/tests/check outcomes before proceeding to the next one when instructed.

## Non-negotiable constraints

- Human and bots use the **same engine** to list, validate and apply moves.
- Rules are pure TypeScript; no React, browser APIs, or AI-provider code imported into the engine.
- Rules cover **2 or 3 players only**; 3 is primary. Start player is randomly selected once and persisted.
- Standard and Advanced cards are supported eventually; don't call the app complete until all Cunning cards, including Plot/Spy, work.
- Maintain mandatory post-effect summon (or explicit **zero** if no uncontrolled region has followers).
- Distinguish draft from committed state: Reset Turn discards draft; End Turn is an irreversible atomic commit; pass also uses this boundary.
- Persist and replay accepted setup, card actions/passes, ordered transfers, summons, power struggles, Plot decisions and result. Never log draft edits as accepted actions.
- Do not leak opponents' private hands, buried discards or undealt cards into UI/agent observations.
- Apply global maximum-achievable partial-action tiers; enforce confirmed Negotiate-disc and Spy/swap anti-undo behaviors.
- Respect project-specific invasion/coronation tiebreaks, including **draws** when no unique winner can be derived.
- No 4-player teams, server multiplayer, third-party backend, provider SDK, or live LLM calls. The LLM controller is an adapter/mock only; do not pretend it is connected or auto-substitute a different controller.
- Prefer the existing project dependencies; justify any new dependencies. Ensure Node/Vite dev server works through port 5173.
- Create tests that fail when a rule is wrong; don't weaken tests or type checking to get green results.

## First task: Milestone 0 + Milestone 1

1. Inspect the repo/toolchain, report versions/scripts/configuration issues, and minimally fix any blockers.
2. Establish core domain types, the user-approved 13-edge map, seeded setup, 2/3-player supply rules, Standard/Advanced hands and invariant checking.
3. Add deterministic Vitest tests for setup, graph, card uniqueness, inventory and starting-player reproducibility.
4. Run `npm run typecheck`, `npm run lint`, `npm run test:run`, `npm run format:check` and `npm run build`; report each PASS/FAIL/NOT VERIFIED with evidence.
5. Summarize changed files, any genuine rule ambiguities and next steps. **Do not begin game UI or card effects in this first task** unless those milestones are explicitly approved.
