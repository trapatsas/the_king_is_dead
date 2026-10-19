# Patient bot: reserve and respond

`patient-mcts-v1` is a separately selectable Standard strategy. The original
`standard-mcts-v2` remains the **Reference** strategy, with its evaluation
weights, search defaults and decision policy preserved. Both are experimental
and can share a two- or three-player game with humans or each other.

## Selecting opponents

Run the development server and open
`http://localhost:5173/?bots=experimental`. For each automated seat choose
**Algorithmic · experimental**, then choose its **Bot strategy**:

- **Reference · original aggressive bot**: the previous bot, kept for comparison.
- **Patient · reserve and respond**: values future responses and selective play.

Names remain editable. Courts and thinking panels identify the strategy. Setup,
saved public logs and exported JSON also record the per-seat profile. Legacy
algorithmic seats without a profile continue to mean Reference. The production
release gate remains closed; this addition does not claim expert strength.

## How patience is implemented

Both strategies use the same Standard legality, simulation, terminal scoring,
seeded candidate sampler, multiplayer MCTS and five/seven-turn minimum sampled
horizons. The patient policy changes evaluation and final root selection, rather
than prohibiting legal actions or requiring a fixed number of opening passes.

1. **Cards retain option value.** Unspent cards matter while struggles remain.
   Assemble and flexible response cards have different values from faction
   support. A soft reserve deficit discourages emptying a hand early. These
   values decline toward an ending, allowing cards to be spent when useful.
2. **The deadline stays uncertain while replies remain.** A current board that
   would produce an early Invasion does not establish that the game really ends
   early. The reserve horizon also considers unresolved regions and the number
   of cards still available to change them.
3. **Pass is a real alternative.** A card must improve the search estimate enough
   to justify giving up a response. The required margin increases when reserves
   are low. Early, before opponents have made several public commitments, a
   small positional gain can be deferred. Large gains can still justify action;
   this opening preference is exempted on the last pass before a struggle.
4. **Forecast the consequences of doing nothing.** Candidate ordering uses
   projected control and the engine's faction-ranking helper, including the
   latest-victory tiebreak. Leaf evaluation also resolves an exact all-pass
   continuation through the shared engine. While opponents retain cards, this
   is a conditional forecast blended with the heuristic, not a forced result.
5. **Spend the response when it matters.** The bot avoids passing into a proven
   terminal loss. When every opponent is out of cards, it can bank a winning
   pass continuation, choose a sampled card that establishes one, or keep acting
   to improve a losing position. This prevents reserve value from becoming an
   excuse to accept a known loss.

Waiting observes opponents' public commitments. Standard's card identities are
already deducible from witnessed plays; passing does not reveal new hidden
setup information.

The patient search uses the reference evaluator for known Reference opponents.
Patient opponents and unknown human preferences use its patient evaluator as a
search approximation. These are independent utility preferences, not calibrated
win probabilities or a guarantee that real opponents follow a rollout.

## Code and compatibility

- `src/bot/patient.ts`: patient evaluation, reserve horizon, exact conditional
  pass continuation, selective root policy and version identifier.
- `src/bot/search.ts`: optional evaluation/leaf/root-policy hooks. No-argument
  `StandardBot` retains the original reference defaults. Its original
  `src/bot/evaluation.ts` is unchanged.
- `src/bot/reference.test.ts` and snapshots: fixed-iteration reference plans and
  search statistics captured before the shared-search refactor, checked after
  it. Timing is excluded from these reproducibility checks.
- `PlayerConfig.botStrategy`: optional public `reference | patient` metadata,
  validated in setup/invariants and carried through redacted observations.
  Rules, card inventory, RNG and scoring are unchanged.
- `src/bot/worker.ts`: separate persistent reference and patient instances,
  selected from the active seat's profile. Tree keys include explicit profiles.
- `src/ui/Setup.tsx`, courts and archive projection: mixed-seat selection and
  identity in saved/exported public history. Optional metadata preserves old
  state/archive compatibility; it does not add game resumption.

Both policies still reconstruct simulation hands exclusively from redacted
observations and witnessed public plays. The browser budget remains up to
1,024 iterations and a 1,400 ms search cap, with the independent 2,500 ms Worker
watchdog. More expensive patient leaves can yield fewer iterations at the same
wall-clock cap.

## Regression positions from the reported game

The fixtures in `src/bot/fixtures/patient-turn-*.json` are public observations and
witnessed plays from game `king-ff6a6837-a64f-4069-b147-b566f2569e12`, with the
observing seat configured as Patient. They contain no live setup seed or RNG.

- **Before turn 24:** hold the last Assemble while supply is empty, preserving a
  response after the first struggle rather than spending it for another summon.
- **Before turn 38:** act to repair the losing Invasion route when opponents
  cannot respond. The chosen legal card yields a winning all-pass continuation.
- **Before turn 47:** bank the already winning continuation instead of spending
  another card with both opponents' hands empty.

Additional tests cover selective waiting in a quiet opening, deterministic
search, immediate winning passes, intervention against a losing third
instability, mixed setup, strategy routing, public archive identity and old
reference decisions.

## Evaluation

The runner now accepts `patient`, `reference` (or legacy `mcts`), `one-ply` and
`random` for either side. Each setup seed rotates the tested strategy through
all seats. Every accepted move passes the public engine. The output records
hands at the first struggle as a behavioural measure alongside outcomes and
seed-cluster bootstrap intervals.

```sh
npm run bot:benchmark -- --bot=patient --opponent=reference --seeds=50 --iterations=128 --prefix=patient-heldout-v1
npm run bot:benchmark -- --bot=patient --opponent=reference --seats=3 --seeds=20 --iterations=128 --prefix=patient-heldout-v1
npm run bot:benchmark -- --bot=reference --opponent=patient --seeds=10 --iterations=128 --prefix=another-heldout-set
npm run bot:benchmark -- --bot=patient --opponent=patient --seats=3 --seeds=2 --iterations=64 --prefix=patient-self-check
```

The initial policy was adjusted using separate `patient-tuning` and
`patient-check` setup prefixes. The reported comparison uses the held-out
`patient-heldout-v1` prefix. First-struggle card retention is a style measure;
a high reserve alone does not prove strong play. Equal iteration counts also
do not imply equal CPU time, and these headless results are not a strength
evaluation of the browser's larger adaptive budget.

| Matchup                            | Games / setup seeds | Patient wins | 95% seed-cluster interval | Patient cards at first struggle | Reference cards at first struggle |
| ---------------------------------- | ------------------- | ------------ | ------------------------- | ------------------------------- | --------------------------------- |
| Patient vs Reference, 2 seats      | 100 / 50            | 98 (98.0%)   | 95.0–100.0%               | 2.10                            | 0.43                              |
| Patient vs two References, 3 seats | 60 / 20             | 55 (91.7%)   | 85.0–98.3%                | 2.05                            | 0.12                              |

There were no draws in these comparisons. The patient had an empty hand at the
first struggle in 13/100 two-player games and 6/60 three-player games. The
reference counts were 71/100 and 107/120 seats respectively. These are observed
style differences, not a rule requiring the patient to retain two cards.

These results exploit weaknesses of this particular frozen reference policy.
They do not establish equivalent strength against humans, a larger candidate
baseline or at equal wall-clock budgets. The existing release gate is not
silently changed or treated as satisfied by this comparison.

Raw comparison records:
[two-player matches](benchmarks/patient-reference-two.json),
[three-player matches](benchmarks/patient-reference-three.json).

Chromium completed a 32-turn Reference/Patient game and a 51-turn
human/Reference/Patient game. Maximum search time was below 1.402 seconds in
these local checks. Profile routing, hidden bot hands, archived strategy
identity and dark mobile setup also passed. Six three-player Patient-only
smoke games terminated within the engine's turn bound; their small sample is
not a strength claim. Mobile-device latency and broader human exploit testing
remain open.

A further browser run reused the reported setup seed and seat order, with Patient
controlling the Panos seat and Reference controlling the other two seats. It
finished in 50 turns with a Patient Coronation win. At the first struggle on
turn 29, Patient retained one card and both References had none; Patient kept
that final card through scoring because its pass continuation already won.
This was a new AI-played line from the same setup, not a replay of the human's
original decisions.
