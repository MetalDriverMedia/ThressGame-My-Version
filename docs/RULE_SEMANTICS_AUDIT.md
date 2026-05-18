# Phase C Rule Semantics Audit (Narrow)

## Scope
This audit locks **intended semantics** for high-impact mutator/rule interactions before balance tuning.

- Focus: documentation + characterization references.
- Production changes in this PR: **none**.
- Frontend/socket/room-clock/bot contracts: **unchanged**.

## Files inspected
- `docs/GAME_COMPLETION_ROADMAP.md`
- `docs/MUTATOR_COMBINATION_COVERAGE.md`
- `mutators/ruleHooks.js`
- `mutators/mutatorDefs.js`
- `mutators/checkDetector.js`
- `mutators/legalMoveEngine.js`
- `handlers/moveHandler.js`
- `utils/gameLifecycle.js`
- Existing tests covering Bottomless Pit, Minefield, Drafted for Battle, Living Bomb, Mitosis, Parry, Risk It Rook, All On Red.

## Final semantics checklist

| Question | Current implemented behavior | Current test coverage | Recommended final release behavior | Code change timing |
|---|---|---|---|---|
| Should Bottomless Pit always destroy kings? | Yes. Bottomless pit destroys any piece including kings in trap resolution paths (`triggerSoftRestrictions`, `safeSwapSquares`, `handleMove` destination/castling trap checks). | Covered by drafted trap scenarios and risk-it-rook + pit interactions (`test/mutatorCombinations.draftedTraps.test.js`, `test/mutatorCombinations.riskItRookBottomlessPit.test.js`). | **Keep yes**. Treat as intentional high-lethality rule identity for pit vs mine differentiation. | **No change now**. |
| Should Minefield always spare kings while consuming mines? | Yes. Kings survive mine triggers while mine is consumed and minefield lifecycle cleanup can remove the persistent rule when no mines remain. | Covered by drafted trap tests and risk-it-rook + mine tests (`test/mutatorCombinations.draftedTraps.test.js`, `test/mutatorCombinations.riskItRookMinefield.test.js`). | **Keep yes**. Preserve mine-vs-pit asymmetry and readability. | **No change now**. |
| Should Drafted for Battle remain highly chaotic or be made safer? | Current behavior is intentionally chaotic: king/champion swaps can resolve into traps and can end game via king destruction depending on destination/origin trap states. | Broadly characterized in drafted-specific matrix (`test/mutatorCombinations.draftedTraps.test.js`, `test/mutatorCombinations.mitosisDrafted.test.js`, `test/mutatorCombinations.draftedLivingBomb.test.js`, `test/mutatorCombinations.twoKidsDrafted.test.js`). | **Keep chaotic in Standard/Full Chaos**, consider safer presets only via future mode tuning (not correctness patching). | **Later (preset/balance phase), not now**. |
| Should Living Bomb explosions affect kings? | Yes in current implementation: explosion path calls mutator destruction helper capable of king removal, followed by standard king-destroyed endgame flow. | Covered indirectly by parry/living-bomb and drafted/living-bomb interaction characterization (`test/mutatorCombinations.parryLivingBomb.test.js`, `test/mutatorCombinations.draftedLivingBomb.test.js`, plus lifecycle sanity in `test/mutatorCombinations.mitosisLivingBomb.test.js`). | **Keep yes** for consistency with other lethal mutators. | **No change now**. |
| Should Mitosis duplicate only non-king pieces? | Yes by choice validation: king targets are rejected; non-king friendly/enemy targets allowed. | Explicitly covered in mitosis expiry tests (`test/mutatorMitosis.expiry.test.js`). | **Keep yes**. Prevent king-cloning edge cases and maintain predictable win conditions. | **No change now**. |
| Should Mitosis duplicate friendly and enemy pieces equally? | Yes. Target selection accepts enemy non-king and friendly non-king piece squares under same rule. | Explicitly covered for enemy acceptance + downstream behavior (`test/mutatorMitosis.expiry.test.js`, `test/mutatorCombinations.mitosisDrafted.test.js`). | **Keep yes**. Symmetric targeting preserves strategic counterplay. | **No change now**. |
| Should Parry apply to mutator destruction, normal captures, or both? | Both in current behavior for mutator-driven destruction that routes through `destroyPiece`; normal captures always go through Parry RPS flow in move handling when rule active. | Covered in capture flow tests and combo tests (`test/moveHandler.parryRps.test.js`, `test/mutatorCombinations.parryLivingBomb.test.js`, `test/mutatorCombinations.parryAllOnRed.test.js`). | **Keep both** for semantic consistency: “capture/destruction contest” rather than only move captures. | **No change now**. |
| Should Risk It Rook be allowed during all pending states? | No. Global pending blockers + dedicated `_riskItRookPending` sequencing prevent overlapping pending flows with coin-flip/RPS pipelines. | Covered by pending and risk-it-rook/all-on-red sequencing tests (`test/coinFlip.pending.test.js`, `test/mutatorCombinations.riskItRookAllOnRed.test.js`). | **Keep restricted sequencing** (disallow overlap with unresolved global pending states). | **No change now**. |
| Should All On Red be default, optional, or chaos-only? | Currently part of general mutator pool (weighted mutator), not a special default mode toggle. | Lifecycle and coexistence coverage exists (`test/coinFlip.pending.test.js`, `test/mutatorCombinations.riskItRookAllOnRed.test.js`, `test/mutatorCombinations.parryAllOnRed.test.js`, `test/mutatorCombinations.allOnRedIceAge.test.js`, `test/mutatorCombinations.allOnRedNoCowards.test.js`). | **Make optional by mode/preset** (not global default). Keep in Standard/Chaos pools unless preset tuning says otherwise. | **Later (preset design), not now**. |
| Should any mutators be excluded from beginner mode? | No explicit beginner exclusions are encoded in this backend path yet. | N/A (design-level preset concern, not unit-path behavior). | **Yes, in future preset work**: recommend excluding highest cognitive/ordering complexity mutators (Parry, All On Red, Risk It Rook, Drafted for Battle, Living Bomb, Mitosis) from beginner mode initially. | **Later (preset implementation), not now**. |

## Characterization test additions in this PR
None added. Existing coverage already characterizes current high-impact behaviors needed for this audit.

## Correctness vs balance determination
- No clear correctness contradiction found requiring immediate production patch.
- Outstanding concerns observed are mostly **semantics clarity / cleanup / balance** and should be handled in subsequent focused PRs.

## Explicit non-goals confirmed
- No frontend UI changes.
- No Socket.IO event name/payload changes.
- No room lifecycle changes.
- No turn-clock lifecycle changes.
- No bot behavior changes.
