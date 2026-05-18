# Board Markers Audit (Phase D, Narrow)

## Scope

This PR is a **frontend readability audit** for board-state markers.

- Focus: visual clarity of marker surfaces and action-target cues.
- Non-goals: gameplay rules, mutator semantics, move legality, room lifecycle, turn clock lifecycle, bot behavior, or Socket.IO contracts.

## Files inspected

- `docs/GAME_COMPLETION_ROADMAP.md`
- `docs/PLAYER_PROMPTS_AUDIT.md`
- `docs/RULE_SEMANTICS_AUDIT.md`
- `docs/PRESET_RULE_MODES.md`
- `docs/BALANCE_TUNING_AUDIT.md`
- `public/js/ui.js`
- `public/js/socketHandlers.js`
- `public/js/main.js`
- `public/js/state.js`
- `public/js/mutatorUI.js`
- `public/js/board.js`
- `public/index.html`
- `public/styles.css`
- `handlers/moveHandler.js` (state/event source review only)
- `handlers/mutatorHandler.js` (state/event source review only)
- `mutators/ruleHooks.js` (marker source semantics only)
- `mutators/mutatorDefs.js` (rule inventory/context only)

## Board marker inventory

| Marker surface | Current state source | Current frontend display behavior | Readability risk | Recommended treatment | Timing |
|---|---|---|---|---|---|
| Minefield squares | `mutatorState.boardModifiers.mines` | Overlay icon 💣 (`board-overlay-mine`) | Medium: icon-only, no label | Keep icon, add explicit label/tooltip text | **Now** |
| Bottomless Pit squares | `mutatorState.boardModifiers.bottomlessPits` | Overlay icon 💀 (`board-overlay-pit`) | Medium: icon-only, no label | Keep icon, add explicit label/tooltip text | **Now** |
| Living Bomb markers | `mutatorState.boardModifiers.livingBombs` | Overlay icon 💥 (`board-overlay-bomb`) | Medium: could be confused with mines | Keep icon + red style, add explicit label/tooltip text | **Now** |
| Mitosis target | `mutatorState.activeRules[*].id === 'mitosis'` with `choiceData` | Overlay icon 🧬 (`board-overlay-mitosis`) | Medium-low | Keep, add explicit label/tooltip text | **Now** |
| `lockedSquares` | `mutatorState.boardModifiers.lockedSquares` | **No dedicated board overlay**; only move restriction in legal-move filtering | **High**: hidden restriction source | Add dedicated lock overlay 🔒 + label/tooltip | **Now** |
| hard-blocked squares | `mutatorState.boardModifiers.blockedSquares` | Overlay icon ✕ (`board-overlay-blocked`) | Medium: symbol can be mistaken for no-man's-land | Keep style, add explicit label/tooltip text | **Now** |
| frozen columns | `mutatorState.boardModifiers.frozenColumns` (+ `ice_age` active rule) | Snowflake overlays across column squares | Low-medium | Keep, add explicit label/tooltip text | **Now** |
| invulnerable pieces | `mutatorState.boardModifiers.invulnerable` | Shield overlay 🛡️ | Medium-low | Keep, add explicit label/tooltip text | **Now** |
| active global effects | `mutatorState.activeRules` | Primarily in mutator cards/history; some effects also render board overlays | Medium: board-only viewer may miss non-square global effect context | Later: compact "Global Effects" strip with plain-language summaries | Later |
| current selected action target | `showTargetSelection(...)` + highlight classes | Target bar + highlighted valid squares | Low-medium | Keep current UX; later add target legend chip and persistent instruction header | Later |

## Safe frontend changes included in this PR

1. Added **dedicated locked-square board marker overlays** (`🔒`) sourced from `mutatorState.boardModifiers.lockedSquares`.
2. Added **human-readable marker labels** to overlays via `title` + `aria-label`, including:
   - Minefield
   - Hard-blocked
   - Bottomless Pit
   - Portal
   - Treasure
   - Death square
   - Tornado
   - Frozen column
   - Invulnerable piece
   - Living Bomb
   - Mitosis target
   - No Man's Land
   - Ice Age frozen file
   - Time Bomb lane
   - Locked square

These are frontend-only visual/accessibility/copy improvements.

## Readability risks found

1. `lockedSquares` had no visible board marker despite move restriction impact.
2. Several marker surfaces were icon-only and lacked textual explanation for quick player comprehension/accessibility.
3. Hard-blocked (`✕`) and no-man's-land (`✘`) can look semantically similar without label context.
4. Some global effects are only implicit in mutator cards and not summarized as a concise global-state list.

## Future implementation plan (next board-marker PR)

1. Add a compact **Global Effects panel** in the game column, fed from `mutatorState.activeRules`.
2. Add a lightweight **board marker legend** (static icon → meaning) near board or mutator panel.
3. Add optional severity layering (e.g., lethal vs blocked vs info) via border/ring styles in addition to icon glyphs.
4. Add targeted frontend tests for overlay inventory rendering from synthetic `mutatorState` fixtures.
5. Add accessibility pass to ensure urgent marker changes are conveyed with clear announcements where appropriate.

## Explicit contract confirmation

Confirmed for this PR:

- No gameplay/backend behavior changes.
- No mutator semantics changes.
- No move legality engine changes.
- No room lifecycle changes.
- No turn-clock lifecycle changes.
- No bot behavior changes.
- No Socket.IO event name changes.
- No Socket.IO payload shape changes.
