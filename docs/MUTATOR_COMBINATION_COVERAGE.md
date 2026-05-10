# Mutator Combination Coverage Index / Audit

## Purpose
This document maps current mutator combination test coverage, highlights characterized behavior (including intentionally weird behavior), and identifies production cleanup follow-up work.

Scope of this audit:
- Documentation only (no production/test changes).
- Source inventories:
  - Mutator definitions: `mutators/mutatorDefs.js`
  - Mutator-related tests: `test/mutatorCombinations*.test.js` plus supporting mutator flow tests.

## 1) Mutator Inventory (`mutators/mutatorDefs.js`)

Current mutator count: **66**.

- going_woke
- march_of_the_pawnguins
- the_rumbling
- they_deserved_it
- born_again_christian
- dub_thee_knight
- back_that_shit_up
- column_swap
- mind_control
- drafted_for_battle
- hot_drop
- minefield
- risk_it_rook
- two_kids_in_a_trenchcoat
- chaaaarge
- the_enemy_is_routed
- nuclear_fallout
- get_up_in_their_face
- a_light_breeze
- anti_camping
- bottomless_pit
- moving_up_the_corporate_ladder
- hurricane
- sophies_choice
- proletariat
- short_stop
- pawns_with_viagra
- trains_rights
- estrogen
- ice_physics
- pacman_style
- god_kings
- early_promotion
- knee_surgery
- pawns_learned_strength
- down_with_the_ship
- second_chance
- kamikaze
- christmas_truce
- hobbit_slaughter
- soul_link
- critical_strike
- invulnerability_potion
- parry
- severe_constipation
- hobbit_battle
- bloodthirsty
- ice_age
- no_cowards
- all_on_red
- blood_sacrifice
- portal_storm
- religious_conversion
- living_bomb
- mitosis
- treasure_chest
- mr_freeze
- portal_3
- no_mans_land
- cash_grab
- tornado
- summoning_ritual
- call_down_lightning
- get_the_fuck_off
- gigachad_aura
- time_bomb

## 2) Mutator Test Inventory (`test/`)

### Combination-focused files
- `test/mutatorCombinations.allOnRedIceAge.test.js`
- `test/mutatorCombinations.allOnRedNoCowards.test.js`
- `test/mutatorCombinations.draftedLivingBomb.test.js`
- `test/mutatorCombinations.draftedTraps.test.js`
- `test/mutatorCombinations.mindControlGodKings.test.js`
- `test/mutatorCombinations.mindControlTraps.test.js`
- `test/mutatorCombinations.mitosisDrafted.test.js`
- `test/mutatorCombinations.mitosisLivingBomb.test.js`
- `test/mutatorCombinations.mitosisTraps.test.js`
- `test/mutatorCombinations.pacmanIceAge.test.js`
- `test/mutatorCombinations.pacmanNoCowards.test.js`
- `test/mutatorCombinations.pacmanShortStop.test.js`
- `test/mutatorCombinations.parryAllOnRed.test.js`
- `test/mutatorCombinations.parryLivingBomb.test.js`
- `test/mutatorCombinations.parryPacmanStyle.test.js`
- `test/mutatorCombinations.parryShortStop.test.js`
- `test/mutatorCombinations.riskItRookAllOnRed.test.js`
- `test/mutatorCombinations.riskItRookBottomlessPit.test.js`
- `test/mutatorCombinations.riskItRookMinefield.test.js`
- `test/mutatorCombinations.twoKidsDrafted.test.js`
- `test/mutatorCombinations.twoKidsMitosis.test.js`
- `test/mutatorCombinations.twoKidsTraps.test.js`

### Supporting mutator lifecycle/flow files
- `test/mutatorHandler.actionResponse.test.js`
- `test/mutatorHandler.selectMutator.test.js`
- `test/mutatorHandler.specialFlows.test.js`
- `test/mutatorMitosis.expiry.test.js`
- `test/moveHandler.mutators.test.js`
- `test/coinFlip.pending.test.js`
- `test/coinFlip.riskItRook.test.js`

## 3) Coverage Table (Combinations)

| Mutator / combination | Covered? | Test file(s) | Current characterized behavior | Known weirdness / cleanup candidate | Priority |
|---|---|---|---|---|---|
| Risk It Rook + All On Red | Yes | `mutatorCombinations.riskItRookAllOnRed.test.js` | Coin-flip gates and movement restrictions remain enforced when both flows coexist. | Coin-flip pending/result ordering sensitivity across moveCount. | Complete |
| Parry + Living Bomb | Yes | `mutatorCombinations.parryLivingBomb.test.js` | Parry capture flow and bomb resolution order is characterized. | Square-vs-piece bomb tracking creates edge-case ambiguity after piece transforms/swaps. | Cleanup Needed |
| Drafted for Battle + Trap Squares (Minefield/Bottomless Pit) | Yes | `mutatorCombinations.draftedTraps.test.js` | King swap into trap/pit outcomes are validated; trap semantics persist/consume per trap type. | Drafted-triggered trap handling should be normalized and explicitly codified. | Cleanup Needed |
| Mind Control + Trap Squares | Yes | `mutatorCombinations.mindControlTraps.test.js` | Converted piece ownership and trap interactions are characterized. | Locked-square and ownership transition cleanup still needed. | Medium |
| Mitosis + Living Bomb | Yes | `mutatorCombinations.mitosisLivingBomb.test.js` | Bomb marker survives mitosis-style board changes per current implementation contracts. | Piece identity vs square identity tracking needs cleanup. | Cleanup Needed |
| Mitosis + Drafted for Battle | Yes | `mutatorCombinations.mitosisDrafted.test.js` | Sequential mutator ordering and relocated-piece behavior are explicitly tested. | Target relocation semantics are non-intuitive and should be formalized. | Cleanup Needed |
| Two Kids in a Trenchcoat + Drafted for Battle | Yes | `mutatorCombinations.twoKidsDrafted.test.js` | Combined king/stacking movement constraints and drafted swaps are characterized. | Pending-state ordering and post-swap validation need hardening. | Medium |
| Two Kids in a Trenchcoat + Traps | Yes | `mutatorCombinations.twoKidsTraps.test.js` | Trap trigger behavior with trenchcoat state is covered. | Trap-trigger consistency vs special piece state still brittle. | Medium |
| Two Kids in a Trenchcoat + Mitosis | Yes | `mutatorCombinations.twoKidsMitosis.test.js` | Interaction of split/spawn logic with trenchcoat rule constraints is covered. | Cleanup may be needed for invariants around generated targets. | Medium |
| Mitosis + Traps | Yes | `mutatorCombinations.mitosisTraps.test.js` | Trap consumption/persistence with mitosis-generated movement targets is characterized. | Cleanup of trap lifecycle and pending ordering recommended. | Cleanup Needed |
| Drafted for Battle + Living Bomb | Yes | `mutatorCombinations.draftedLivingBomb.test.js` | Order-dependent outcomes (bomb then drafted vs drafted then bomb) are explicitly documented by tests. | Living bomb metadata can mismatch post-relocation expectations. | Cleanup Needed |
| Mind Control + God Kings | Yes | `mutatorCombinations.mindControlGodKings.test.js` | King-capture restrictions and controlled-piece behavior coexist under current rules. | Additional backend guardrails likely needed for edge timing windows. | Medium |
| Parry + All On Red | Yes | `mutatorCombinations.parryAllOnRed.test.js` | RPS flow and coin-flip movement restrictions both gate move application. | `handleMove` flow contract complexity makes regression risk high. | High |
| Pacman Style + Short Stop | Yes | `mutatorCombinations.pacmanShortStop.test.js` | Wrap movement + synthetic move validation path is covered. | Backend legal-move path divergence can cause subtle mismatch bugs. | Medium |
| Parry + Pacman Style | Yes | `mutatorCombinations.parryPacmanStyle.test.js` | Capture-triggered RPS on wrapped capture paths is covered. | RPS + synthetic path ordering should be kept under regression watch. | Medium |
| Parry + Short Stop | Yes | `mutatorCombinations.parryShortStop.test.js` | RPS pending flow coexists with short-stop custom movement. | Pending stack ordering still a cleanup target. | Medium |
| All On Red + Ice Age | Yes | `mutatorCombinations.allOnRedIceAge.test.js` | Heads/tails outcomes still respect frozen-file restrictions. | Deadlock/skip-turn interactions deserve additional production cleanup. | Low |
| All On Red + No Cowards | Yes | `mutatorCombinations.allOnRedNoCowards.test.js` | Directional-move restrictions compose with heads/tails gating. | Pending coin flip lifecycle remains sensitive to sequencing. | Low |
| Pacman Style + Ice Age | Yes | `mutatorCombinations.pacmanIceAge.test.js` | Wrap mechanics still blocked by ice-age frozen-file constraints where applicable. | Could benefit from explicit UX messaging cleanup. | Low |
| Pacman Style + No Cowards | Yes | `mutatorCombinations.pacmanNoCowards.test.js` | Wrap movement still constrained by no-cowards directional logic. | Movement reason reporting likely needs cleanup. | Low |
| Risk It Rook + Bottomless Pit | Yes | `mutatorCombinations.riskItRookBottomlessPit.test.js` | Spawned rook outcomes with pit destruction are covered. | Spawn lifecycle plus trap semantics should be unified. | Medium |
| Risk It Rook + Minefield | Yes | `mutatorCombinations.riskItRookMinefield.test.js` | Spawned rook outcomes with mine consumption are covered. | Minefield activeRule lifecycle consistency cleanup needed. | Cleanup Needed |
| Unlisted pairwise combinations | No (explicitly not audited in current suite) | N/A | Only selected high-risk intersections are currently covered. | Expand matrix only after production cleanup to avoid freezing bugs into behavior. | High |

## 4) Recently Completed High-Risk Combinations

The following are covered in the current suite and treated as recently completed high-risk work:
- Risk It Rook + All On Red
- Parry + Living Bomb
- Drafted for Battle + Trap Squares
- Mind Control + Trap Squares
- Mitosis + Living Bomb
- Mitosis + Drafted for Battle
- Two Kids + Drafted for Battle
- Two Kids + Traps
- Two Kids + Mitosis
- Mitosis + Traps
- Drafted + Living Bomb
- Mind Control + God Kings

## 5) Production Cleanup Candidates

1. **`lockedSquares` cleanup semantics**
   - Define a single cleanup point and ownership model for stale locks when mutators expire or pieces relocate.

2. **Minefield `activeRule` lifecycle**
   - Align marker persistence/consumption with explicit active-rule lifecycle rules so cleanup does not depend on incidental state.

3. **Living Bomb square-vs-piece tracking**
   - Decide whether bombs bind to original square, original piece identity, or transformed successor; enforce consistently.

4. **Mitosis target relocation behavior**
   - Normalize how target references are rewritten (or not) after board-changing mutators run in sequence.

5. **Drafted trap-trigger behavior**
   - Specify whether swaps trigger on-enter effects immediately and in what order per side.

6. **Pending state ordering**
   - Canonical ordering for `pendingAction`, `pendingSecondAction`, `pendingRPS`, and `pendingCoinFlip` should be centralized.

7. **`handleMove` return contract**
   - Define one stable contract for success, rejection, deferred resolution, and side-effect-only outcomes.

## 6) Recommended Next PRs (Ordered)

1. **Production cleanup pass**
   - Implement the cleanup-candidate semantics above without expanding feature scope.

2. **Backend stability pass**
   - Strengthen invariant checks, reducer-style state transitions, and regression tests around pending state + lifecycle.

3. **Frontend/UX pass**
   - Improve player-facing messaging for blocked/deferred/coin-flip/RPS outcomes; align with backend state machine.

4. **Balance/rules pass**
   - Revisit mutator interaction design only after deterministic backend semantics are locked.

5. **Deployment readiness**
   - Final pre-release hardening: smoke matrix, telemetry hooks, and operational runbook updates.

## 7) Validation Notes

- This PR is documentation-only.
- Intended changed file set: `docs/MUTATOR_COMBINATION_COVERAGE.md` only.
