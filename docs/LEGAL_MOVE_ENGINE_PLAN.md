# Legal Move Engine Refactor Plan (Server-Side Source of Truth)

## Goal
Create one server-side source of truth for **effective legal move computation** (base legal moves + mutator-aware additions + restriction filtering + mutator-aware king safety), while keeping gameplay behavior unchanged during migration.

This is a planning-only document. No gameplay code changes are included in this step.

## Current Duplication and Why It Is Risky
Legal move filtering logic is currently duplicated in at least three runtime call paths:

1. **Player move validation path** (`handlers/moveHandler.js`)
   - Builds legal move list from `chess.moves({ verbose: true })`.
   - Injects custom moves from mutators.
   - Injects Pacman wrap moves when active.
   - Adds fake-check fallback pseudo-legal moves when chess.js says in-check but mutator-aware check disagrees.
   - Applies mutator restriction filters in forced-rule-aware order.
   - Performs mutator-aware self-check prevention.

2. **Bot move pool path** (`botManager.js`)
   - Independently computes a filtered legal move pool for bot decisions.
   - Injects custom and wrap moves.
   - Applies restriction filters with forced-rule ordering.
   - Does not currently share one canonical helper with player validation.

3. **Deadlock detection path** (`utils/gameLifecycle.js`)
   - Computes “effective legal moves” for deadlock and Parry deadlock checks.
   - Adds fake-check fallback.
   - Applies restriction filters.
   - Injects custom and wrap moves.

Because these paths are separate, bug fixes or new mutator interactions can drift across files and produce behavior mismatches (player allowed vs bot allowed vs deadlock/no-deadlock).

## Proposed New Module
Create a new module (in a future implementation step):

- `mutators/legalMoveEngine.js`

This module becomes the single source of truth for effective legal moves.

### Proposed Public API

1. `getEffectiveLegalMoves(room, color, options = {})`
   - Returns the authoritative list of legal/effective move objects for a color.
   - Includes base legal moves from chess.js, mutator additions, restriction filtering, and mutator-aware self-check screening.

2. `getLegalTargetsForSquare(room, color, square, options = {})`
   - Convenience helper returning legal target squares (or verbose moves) for one origin square.

3. `isMoveAllowed(room, color, from, to, promotion, options = {})`
   - Boolean/structured result for server-side move allowance checks.
   - Must be authoritative for handler and optionally reusable by bot pre-checks.

4. `applyRestrictionRules(room, color, moves, options = {})`
   - Applies mutator restriction hooks in deterministic order, including forced-rule ordering semantics.

5. `includeCustomMoves(room, color, moves, options = {})`
   - Injects mutator custom moves (short_stop, estrogen, god_kings, etc.) without duplicates.

6. `includeWrapMoves(room, color, moves, options = {})`
   - Injects Pacman-style wrap moves when active, without duplicates.

7. `includeFakeCheckFallbackMoves(room, color, moves, options = {})`
   - Adds pseudo-legal destinations when chess.js in-check filtering is incompatible with mutator-aware check state.

## Scope Boundaries

### Logic that should move into `mutators/legalMoveEngine.js`

#### From `utils/gameLifecycle.js`
- Existing `getEffectiveLegalMoves(room)` implementation should be moved first and replaced by a delegating call.
- Move assembly sequence and dedupe behavior:
  - base chess.js verbose moves
  - fake-check fallback injection
  - restriction filtering with forced-rule ordering
  - custom move injection
  - Pacman wrap injection

#### From `botManager.js`
- `getMutatorFilteredMoves(room, playerColor)` logic should migrate to legalMoveEngine and become a consumer wrapper over canonical functions.
- Bot should request canonical effective move list rather than recomputing restriction/filtering locally.

#### From `handlers/moveHandler.js`
- Move-allowed evaluation currently done inline in mutator restriction block should move behind `isMoveAllowed(...)`.
- Inline fake-check fallback + restriction filtering + custom/wrap inclusion logic should be removed from handler and delegated.
- Handler should keep input/socket/turn checks and call engine only for move legality/effective legality concerns.

### Logic that should stay where it currently is
- **Actual board mutation/application** stays in move execution and mutator hook code.
- **Socket event handling** stays in handlers.
- **Bot evaluation heuristics** (move scoring, trap preference randomness) stay in `botManager.js` and bot AI modules.
- **Turn clock behavior** stays in `utils/turnClock` and current lifecycle/handler orchestration.
- **Mutator activation/expiration hooks** stay in mutator engine/hook modules.
- **Check detection primitives** stay in `mutators/checkDetector.js`.
- **Board utility primitives** stay in `mutators/boardUtils.js`.

## Detailed Function Responsibilities

### `getEffectiveLegalMoves(room, color, options = {})`
Recommended pipeline:
1. Acquire base moves (`chess.moves({ verbose: true })`) for the target side.
2. If applicable, apply `includeFakeCheckFallbackMoves(...)`.
3. Inject custom moves via `includeCustomMoves(...)`.
4. Inject wrap moves via `includeWrapMoves(...)`.
5. Apply `applyRestrictionRules(...)`.
6. Final mutator-aware king-safety pass (`wouldLeaveKingInCheck`) for all moves, including synthetic/custom moves.
7. Return deduped stable order output.

Notes:
- Preserve existing runtime behavior initially (compat mode); if reordering impacts behavior, gate with `options` and migrate gradually.
- Keep forced-rule ordering semantics currently used (`tornado`, `bloodthirsty` last).

### `getLegalTargetsForSquare(room, color, square, options = {})`
- Use `getEffectiveLegalMoves` and filter by `from === square`.
- Return targets or verbose objects (decide via option flag).

### `isMoveAllowed(room, color, from, to, promotion, options = {})`
- Use canonical effective move list.
- Match move by from/to (+promotion where relevant).
- Return `{ allowed, reason, matchedMove }` to support precise rejection reasons.

### `applyRestrictionRules(room, color, moves, options = {})`
- Discover active rules exposing `getLegalMoveModifiers`.
- Sort by forced-rule ordering semantics.
- Apply each filter in order.
- Avoid side effects on input array where possible.

### `includeCustomMoves(room, color, moves, options = {})`
- Pull from `getCustomMoves(room, color)`.
- Normalize shape to engine move schema.
- Dedupe against existing moves.

### `includeWrapMoves(room, color, moves, options = {})`
- If `pacman_style` active, inject from `getWrapMoves(room, color)`.
- Dedupe against existing moves.

### `includeFakeCheckFallbackMoves(room, color, moves, options = {})`
- Run only when chess.js says in check and mutator-aware check says no real check.
- For each piece of color:
  - Generate pseudo-legal destinations.
  - Keep only those that do not leave king in mutator-aware check.
- Inject as synthetic/legal candidates for downstream rule filtering.

## Incremental Implementation Order

### Phase A (first)
1. Create `mutators/legalMoveEngine.js` with canonical helpers.
2. Move/port logic from `utils/gameLifecycle.js#getEffectiveLegalMoves` first.
3. Keep `utils/gameLifecycle.js` public API stable by delegating to new module.
4. Verify deadlock and Parry deadlock behavior unchanged.

### Phase B
1. Make `botManager.js` use `legalMoveEngine.getEffectiveLegalMoves(room, currentTurn, ...)`.
2. Remove/retire local duplicated mutator filtering helper.
3. Keep bot scoring/selection heuristics untouched.

### Phase C
1. Make `handlers/moveHandler.js` use `legalMoveEngine.isMoveAllowed(...)` for allowance checks.
2. Keep all non-legality handler responsibilities (socket responses, turn/membership checks, mutation flow, clocks) unchanged.
3. Ensure mutator-aware self-check behavior remains equivalent or stricter in intended ways.

### Phase D (optional)
1. Add server-authoritative legal move hints endpoint/event for client UI.
2. Client rendering can consume hints; server remains authoritative on submission.
3. Add mismatch diagnostics for client-predicted vs server-authoritative targets.

## Test Plan Requirements

### Before refactor (safety baseline)
Add/verify tests that characterize current behavior using existing APIs:
- Normal legal moves.
- Illegal moves.
- Self-check prevention.
- Pinned-piece movement.
- Fake-check fallback.
- Restriction rules.
- Custom moves.
- Pacman wrap moves.
- Deadlock detection.
- Bot move pool using shared legal logic (initially expected to expose duplication).

### During/after refactor
- Unit-test each legalMoveEngine helper with fixture boards + mutator states.
- Regression tests ensure behavior parity for:
  - move handler rejections/acceptances
  - bot available move pool
  - mutator deadlock and Parry deadlock outcomes
- Add invariants:
  - `isMoveAllowed(...)` agrees with membership in `getEffectiveLegalMoves(...)`
  - no duplicate `(from,to,promotion?)` entries
  - fake-check fallback never allows true self-check positions

### Existing relevant test surfaces inspected
- `test/boardUtils.test.js` (board primitives / blocked squares / nearest-square behavior)
- `test/checkDetector.test.js` (attack generation, mutator-aware check, pinned-piece/self-check baseline)

## Risk Areas and Mitigations

1. **Mutator combinations**
   - Risk: interaction explosions from stacked filters + movement modifiers.
   - Mitigation: matrix tests for common high-risk combos and explicit ordering assertions.

2. **Check/checkmate/stalemate behavior**
   - Risk: subtle divergence between chess.js and mutator-aware check semantics.
   - Mitigation: preserve fake-check fallback semantics and regression snapshots around deadlock resolution.

3. **Custom FEN load paths**
   - Risk: positions loaded with unusual metadata may alter effective move interpretation.
   - Mitigation: add fixtures from FEN load entry points and validate engine parity.

4. **Bot behavior drift**
   - Risk: changed move pool shape affects bot move selection distribution.
   - Mitigation: compare pool cardinality/content pre/post and keep heuristics untouched.

5. **Client/server legal move hint mismatch**
   - Risk: optional UI hints may disagree with server authority.
   - Mitigation: treat hints as advisory; authoritative revalidation on submit remains mandatory.

6. **Performance**
   - Risk: extra board simulations (fake fallback + self-check pass) increase CPU in busy rooms.
   - Mitigation: cache intermediate board parsing per call, short-circuit when no active rules, and benchmark bot turns and rapid move bursts.

## Migration Non-Goals (for this planning step)
- No gameplay behavior changes.
- No creation of `mutators/legalMoveEngine.js` yet.
- No edits to handler/bot/lifecycle/mutator primitive files in this planning-only change.
- No frontend/CSS/package metadata changes.

## Acceptance Criteria for the Future Refactor
- One canonical server legal-move engine used by deadlock detection, bot move pool, and move allowance checks.
- Existing gameplay behavior preserved (or intentionally changed behind explicit tests).
- Duplicated legal-move filtering logic removed from handler and bot manager.
- Adequate regression coverage for mutator-aware legality edge cases.
