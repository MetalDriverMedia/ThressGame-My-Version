# Preset Rule Modes (Phase C Design)

## Status and Scope

This document is a **design recommendation** for Phase C preset rule modes. It does **not** describe currently implemented room behavior.

- **Implemented behavior today:** room setup still uses `disabledMutators` + `manualCoinFlip` options and a practical mutator on/off posture through client configuration; there is no shipped preset selector contract yet.
- **Design recommendation in this doc:** define a conservative, implementation-ready preset matrix that can be added in a follow-up PR without changing existing gameplay semantics.

Explicit non-goals in this design PR:
- No gameplay rules or mutator semantics changes.
- No move handling changes.
- No room lifecycle changes.
- No turn clock changes.
- No bot behavior changes.
- No frontend UI changes.
- No Socket.IO payload contract changes.

## Inputs and Constraints

This design is based on:
- Phase C roadmap requirement to add preset rule modes. See `docs/GAME_COMPLETION_ROADMAP.md`.
- Locked final semantics from `docs/RULE_SEMANTICS_AUDIT.md`.
- Combination risk/readability notes from `docs/MUTATOR_COMBINATION_COVERAGE.md`.
- Existing mutator inventory and weights in `mutators/mutatorDefs.js`.
- Existing room creation options (`disabledMutators`, `manualCoinFlip`) in `handlers/joinHandler.js`.

## Locked Semantics Used by This Design (No Changes Proposed)

The following are treated as fixed for preset design:
- **All On Red** remains an optional mutator and should be mode-gated rather than globally default.
- **Risk It Rook** remains constrained by existing pending-state sequencing.
- **Parry** applies to both normal capture flow and mutator-driven destruction paths.
- **Drafted for Battle** remains high-chaos and trap-interaction-heavy.
- **Living Bomb** remains king-lethal in current semantics.
- **Mitosis** remains non-king-only targeting and allows friendly/enemy non-king targeting.

## Preset Mode Matrix (Design Recommendation)

Legend:
- ✅ included
- ❌ excluded
- ⚙️ optional/tunable in later balancing pass

| Preset | Purpose | Audience | All On Red | Risk It Rook | Parry | Drafted for Battle | Living Bomb | Mitosis | Manual Coin Flip Default |
|---|---|---|---|---|---|---|---|---|---|
| Classic / No Mutators | Chess-like baseline, onboarding fallback | New users, deterministic play | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | false |
| Beginner / Light Chaos | Low cognitive load intro to mutators | First-time mutator players | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | false |
| Standard Thress | Intended default chaos/fairness balance | Most players | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | false |
| Full Chaos | Maximum unpredictability | Chaos-seekers/private lobbies | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚙️ (false default; host may opt-in true) |
| Stream Mode | Spectator readability + high-visibility moments | Creators/casters/audiences | ✅ | ⚙️ | ⚙️ | ❌ | ✅ | ❌ | true |

## Preset Details

### 1) Classic / No Mutators

**Design recommendation**
- Purpose: strict baseline game mode with no mutator systems.
- Intended audience: players who want deterministic play, practice, or tournament-like consistency.
- Included mutators: none.
- Excluded mutators: all mutators.
- Frequency/weight approach: mutator selection bypassed entirely.
- Readability concerns: lowest complexity; easiest to teach.
- Fairness concerns: highest fairness consistency, minimal hidden state.
- Spectator/streaming concerns: less spectacle, strongest clarity.

**Implemented behavior today**
- Not a first-class preset yet.

### 2) Beginner / Light Chaos

**Design recommendation**
- Purpose: approachable mutator introduction while avoiding highest sequencing complexity.
- Intended audience: new mutator players and casual public matchmaking.
- Included mutators: conservative subset emphasizing board-visible, low-pending-flow effects.
- Excluded mutators (initial): **All On Red, Risk It Rook, Parry, Drafted for Battle, Living Bomb, Mitosis**.
- Frequency/weight approach:
  - Use reduced trigger frequency versus Standard.
  - Bias toward short-duration or instantly legible board effects.
  - Cap simultaneous high-impact/pending-heavy rules.
- Readability concerns: keep event feed understandable in under one glance; avoid overlapping prompts.
- Fairness concerns: reduce RNG swing and prompt-order edge cases.
- Spectator/streaming concerns: moderate spectacle, high comprehension.

**Implemented behavior today**
- No dedicated beginner preset contract yet.

### 3) Standard Thress

**Design recommendation**
- Purpose: primary default game identity for release.
- Intended audience: general player base.
- Included mutators: full curated standard pool, including **All On Red, Risk It Rook, Parry, Drafted for Battle, Living Bomb, Mitosis**.
- Excluded mutators: only those disabled by explicit balance policy in future tuning (none proposed here).
- Frequency/weight approach:
  - Preserve current baseline weights initially.
  - Apply only conservative weight trims after telemetry/playtest confirmation.
  - Keep pending-state-heavy mutators from clustering too frequently.
- Readability concerns: manageable chaos with clear prompt/event ordering.
- Fairness concerns: maintain strategic counterplay; avoid overstacking coin-flip/RPS bursts.
- Spectator/streaming concerns: strong highlights while retaining game-state legibility.

**Implemented behavior today**
- Approximate behavior exists via current mutator-enabled play, but no explicit `preset` selection contract.

### 4) Full Chaos

**Design recommendation**
- Purpose: maximum volatility and high-risk interactions.
- Intended audience: players intentionally seeking extreme randomness.
- Included mutators: all mutators, including **All On Red, Risk It Rook, Parry, Drafted for Battle, Living Bomb, Mitosis**.
- Excluded mutators: none by default.
- Frequency/weight approach:
  - Keep full pool available.
  - Optionally boost high-impact weights slightly in a future balance PR only.
  - Preserve current pending-state guards; no sequencing-rule relaxations.
- Readability concerns: highest cognitive load; warning text recommended when implemented.
- Fairness concerns: intentionally swingy; acceptable as opt-in mode.
- Spectator/streaming concerns: high spectacle, lower predictability.

**Implemented behavior today**
- Not a discrete preset; partially emulatable through current room mutator settings.

### 5) Stream Mode

**Design recommendation**
- Purpose: maximize audience readability while keeping big moments.
- Intended audience: streamers, shoutcasters, spectators.
- Included mutators: visually legible/high-event-value set; include **All On Red** and **Living Bomb** by default.
- Excluded mutators (initial): exclude or downweight high-rules-explanation mutators (**Drafted for Battle**, **Mitosis**). Keep **Risk It Rook** and **Parry** optional/tunable, not required at launch.
- Frequency/weight approach:
  - Prefer clear board-state mutators and obvious event outcomes.
  - Reduce stacked pending prompts per turn window.
  - Increase interval between cognitively dense interactions.
- Readability concerns: prioritize “viewer can explain what happened in one sentence.”
- Fairness concerns: avoid excessive hidden-resolution chains mid-broadcast.
- Spectator/streaming concerns: enable manual coin flip by default for show pacing and commentator framing.

**Implemented behavior today**
- No dedicated stream preset exists yet; manual coin flip already exists as a room option.

## Inclusion/Exclusion Snapshot for Required High-Impact Mutators

| Mutator | Classic | Beginner | Standard | Full Chaos | Stream (recommended launch) |
|---|---|---|---|---|---|
| All On Red | ❌ | ❌ | ✅ | ✅ | ✅ |
| Risk It Rook | ❌ | ❌ | ✅ | ✅ | ⚙️ optional/downweighted |
| Parry | ❌ | ❌ | ✅ | ✅ | ⚙️ optional/downweighted |
| Drafted for Battle | ❌ | ❌ | ✅ | ✅ | ❌ |
| Living Bomb | ❌ | ❌ | ✅ | ✅ | ✅ |
| Mitosis | ❌ | ❌ | ✅ | ✅ | ❌ |

## Recommended Frequency/Weight Policy (Conservative)

Design recommendation for implementation PR:
1. **Start from existing `mutatorDefs` weights** for Standard.
2. Build preset pools by **inclusion/exclusion first**, weight retuning second.
3. For Beginner and Stream, avoid large numeric weight redesign initially; instead:
   - remove highest complexity mutators,
   - optionally downweight remaining prompt-heavy rules.
4. Treat weight changes as a separate, test-backed balance patch after preset plumbing is stable.

## Migration Path: `mutatorsEnabled`/room options → Preset Selection

Current room creation and gameplay setup already supports:
- `disabledMutators` list on room object.
- `manualCoinFlip` room option.

Recommended migration path (future PR):
1. Introduce a **new optional room field**: `mutatorPreset` (string enum).
2. Server resolves preset into deterministic config at room creation:
   - `disabledMutators` derived from preset,
   - `manualCoinFlip` default derived from preset (host may override if policy allows).
3. Keep backward compatibility:
   - If `mutatorPreset` absent, preserve existing behavior.
   - Existing clients sending only `disabledMutators` / `manualCoinFlip` continue to work.
4. Add non-breaking payload echo of resolved preset metadata where convenient (later PR), without removing existing fields.
5. Deprecate direct free-form mutator toggling only after frontend migrates and compatibility window is complete.

## Future Implementation Plan (Later PR, Not This PR)

1. **Define preset constants** (single source of truth).
2. **Add resolver utility** mapping preset → `{ disabledMutators, manualCoinFlipDefault }`.
3. **Integrate resolver in room creation path** with backward-compatible fallbacks.
4. **Add tests**:
   - room creation defaults per preset,
   - backward compatibility when preset missing,
   - no change to gameplay semantics for active mutators.
5. **Frontend PR**:
   - preset selector UX,
   - explanatory copy for each mode,
   - defaults and advanced options.
6. **Balance follow-up PR**:
   - optional weight tuning using playtest telemetry.

## Implementation-vs-Design Summary

- **Implemented in this PR:** documentation of preset design only.
- **Not implemented in this PR:** preset selection contracts, resolver logic, UI, payload changes, gameplay behavior changes.

