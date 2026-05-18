# Balance Tuning Audit (Phase C, Narrow)

## Scope and Constraints

This audit is documentation-first and intentionally conservative.

- Goal: evaluate current mutator balance inputs and release-readiness risk.
- Non-goal: changing runtime gameplay semantics in this PR.
- Production behavior changes: none.

Confirmed non-changes in this PR:
- No gameplay rule/semantics changes.
- No move-handling changes.
- No room lifecycle changes.
- No turn-clock changes.
- No bot logic/behavior changes.
- No frontend UI changes.
- No Socket.IO payload contract changes.

## Files inspected

Primary design docs and inventories:
- `docs/GAME_COMPLETION_ROADMAP.md`
- `docs/RULE_SEMANTICS_AUDIT.md`
- `docs/PRESET_RULE_MODES.md`
- `docs/MUTATOR_COMBINATION_COVERAGE.md`

Runtime mutator/balance inputs:
- `mutators/mutatorDefs.js`
- `mutators/mutatorEngine.js`
- `mutators/ruleHooks.js`
- `handlers/moveHandler.js`
- `handlers/mutatorHandler.js`
- `utils/gameLifecycle.js`
- `utils/pendingState.js`

Coverage references used for this audit:
- `test/mutatorHandler.selectMutator.test.js`
- `test/mutatorHandler.specialFlows.test.js`
- `test/moveHandler.parryRps.test.js`
- `test/coinFlip.pending.test.js`
- `test/coinFlip.riskItRook.test.js`
- `test/rps.test.js`
- `test/mutatorCombinations.allOnRedIceAge.test.js`
- `test/mutatorCombinations.riskItRookAllOnRed.test.js`
- `test/mutatorCombinations.riskItRookMinefield.test.js`
- `test/mutatorCombinations.parryAllOnRed.test.js`
- `test/mutatorCombinations.parryLivingBomb.test.js`
- `test/mutatorCombinations.draftedLivingBomb.test.js`
- `test/mutatorCombinations.draftedTraps.test.js`
- `test/mutatorCombinations.mitosisLivingBomb.test.js`
- `test/mutatorCombinations.mitosisTraps.test.js`
- `test/mutatorMitosis.expiry.test.js`

## Current implemented balance inventory (code facts)

### Selection cadence and pool shape
- Mutator selection cadence is every 3rd move (`CHOICE_INTERVAL = 3`).
- Each choice offers 3 weighted random options from eligible mutators.
- Active mutators are excluded from re-offer while active (via eligible filtering).

### Current weight baseline
From `mutators/mutatorDefs.js`:
- Total mutators in pool: **66**.
- Total raw weight sum: **381**.
- Prompt-heavy mutators (`requiresChoice || secondPlayerChoice`): **15** mutators, total weight **81** (~21.3% of total weighted mass).

### High-impact mutator weight snapshot
- `risk_it_rook`: weight 7.
- `all_on_red`: weight 5.
- `parry`: weight 5.
- `drafted_for_battle`: weight 4.
- `living_bomb`: weight 5.
- `mitosis`: weight 6.
- `minefield`: weight 7.
- `bottomless_pit`: weight 5.

### Prompt/interaction-heavy systems
- `Parry` introduces capture-time RPS and pending RPS resolution flow.
- `All On Red` introduces per-turn coin flip gating (manual or automatic).
- `Risk It Rook` has its own coin-flip phase and sequencing protections.
- Pending flow gatekeepers reject move progression until pending work resolves.

### Trap / spawn pressure inputs
- Trap-creating mutators include Minefield and Bottomless Pit (persistent terrain pressure).
- Spawn pressure includes Risk It Rook, Hot Drop, Summoning-style effects, and Mitosis-related duplication pressure.
- Persistent trap state can overlap with move-resolution mutators, increasing sequencing complexity.

## Risk and readability hotspots

### 1) High-impact clustering risk
Risk profile: medium-high in Standard if multiple high-swing mutators are simultaneously active or sequenced close together.

Hot cluster examples:
- `parry + all_on_red` (RPS + coin flip gating).
- `risk_it_rook + all_on_red` (dual coin-flip pathways).
- `drafted_for_battle + traps` (king/champion swap into lethal squares).
- `mitosis + living_bomb` (piece/square identity readability).

### 2) Prompt-heavy frequency and pending-state load
- Prompt-heavy weighted mass (~21.3%) is substantial for onboarding and spectator clarity.
- Second-player choice mutators and chained pending states increase turn-latency and comprehension cost.

### 3) Trap count / spawn count volatility risk
- Persistent traps + additional spawned/duplicated pieces can amplify accidental-loss states and reduce predictability.
- In narrow boards/late game, these interactions can create abrupt outcome spikes.

### 4) RPS frequency risk (Parry)
- Parry creates intermittent pause points during captures.
- Repeated capture attempts in tactical middlegame can create cadence drag and cognitive switching.

### 5) Coin flip frequency risk (All On Red + Risk It Rook adjacency)
- Coin-flip systems are already guarded for pending-state safety, but frequency can still create pacing variance.
- Manual coin flip increases theatricality but can slow average game completion.

### 6) Bot difficulty/readability impact
- Bots respect pending flows, but highly stacked mutator turns can still appear opaque to players observing bot decisions.
- Readability issue is primarily UX/explanation, not immediate correctness.

### 7) Beginner readability risk
- Combined prompt systems (choice + action + second action + RPS + coin flip) are the primary beginner risk.
- Trap persistence and non-standard move constraints add hidden-state burden for first-time players.

### 8) Spectator/stream pacing risk
- Spectacle is strong, but too-frequent prompt pauses can reduce narrative continuity.
- Stream mode should emphasize visually legible outcomes over compound deferred-resolution chains.

### 9) Fairness vs spectacle tradeoff
- High-swing mutators deliver memorable moments but can reduce perceived agency.
- Standard should preserve chaos identity while limiting repeated back-to-back swing events.

## Conservative tuning principles by preset (recommendations only)

These recommendations align with `docs/PRESET_RULE_MODES.md` and are intentionally low-risk.

### Standard Thress
- Keep current semantics and mostly current weights at first.
- Prefer small weight trims to reduce back-to-back prompt-heavy offerings.
- Keep all major mutators present unless telemetry flags severe pain points.

### Full Chaos
- Keep full mutator inclusion.
- Optional slight boosts for high-impact mutators can be considered later, but only after Standard is stable.
- Maintain current pending-state safety guards.

### Beginner / Light Chaos
- Exclude highest cognitive-load mutators initially:
  - `all_on_red`, `risk_it_rook`, `parry`, `drafted_for_battle`, `living_bomb`, `mitosis`.
- Reduce prompt-heavy exposure and avoid stacked deferred-resolution mechanics.
- Prefer board-visible, low-explanation mutators.

### Stream Mode
- Favor mutators with immediate visual readability and clear commentary hooks.
- Keep `all_on_red` for audience drama, but downweight optional compounding prompt systems.
- Exclude or downweight `drafted_for_battle` and `mitosis` at launch for clarity.
- Use manual coin flip by default for presenter pacing control.

## “Do not change yet” list (requires playtest telemetry first)

1. Global weight retune across the full 66-mutator pool.
2. Large Parry frequency changes.
3. Major All On Red frequency changes.
4. Trap count/spawn count numerical redesign.
5. Any sequencing-rule relaxations around pending states.
6. Bot decision heuristic rewrites for mutator complexity.
7. Semantics changes to king lethality behaviors (pit/bomb/mine asymmetry) already documented as intended.

## Current behavior vs future tuning separation

### Current implemented behavior (today)
- Weighted random choice model, every 3 moves, 3 options.
- Existing mutator semantics and pending-state protections remain as currently implemented.
- No preset resolver contract fully shipping yet; docs describe target design.

### Recommended future tuning (not implemented here)
- Preset-specific inclusion/exclusion first.
- Conservative per-preset weight deltas second.
- Telemetry-guided tuning before broad numeric rebalance.

## Later implementation PR plan (safe, incremental)

1. Add/confirm a single preset resolver source of truth (no semantics changes).
2. Encode inclusion/exclusion sets for Standard, Full Chaos, Beginner, Stream.
3. Keep Standard near current weights; apply only small initial deltas.
4. Add resolver tests for backward compatibility and deterministic outputs.
5. Add balance characterization tests validating:
   - no runtime semantic drift,
   - pending-state safety unchanged,
   - expected mutator availability per preset.
6. Add telemetry hooks/reporting fields for:
   - prompt count per game,
   - RPS events per game,
   - coin flip events per game,
   - game length and skip-turn incidence.
7. Run limited playtest window; tune only outlier mutators afterward.

## Release-readiness conclusion (Phase C narrow audit)

- No clearly broken correctness value found that requires immediate runtime patch.
- Balance work should proceed as preset-scoped, conservative, and telemetry-informed.
- This PR remains documentation-only by design.
