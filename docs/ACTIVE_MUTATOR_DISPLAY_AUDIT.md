# Active Mutator Display Audit (Phase D, Narrow)

## Scope

This audit is intentionally frontend-first and readability-focused.

- Goal: improve player understanding of currently active mutators (what is active, for how long, who chose it, what it targets, and whether it leaves persistent effects).
- Non-goals: changing gameplay rules, mutator semantics, move legality, room lifecycle, turn clock lifecycle, bot behavior, or Socket.IO event names/payload shapes.

## Files inspected

- `docs/GAME_COMPLETION_ROADMAP.md`
- `docs/PLAYER_PROMPTS_AUDIT.md`
- `docs/BOARD_MARKERS_AUDIT.md`
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
- `mutators/ruleHooks.js` (active-rule metadata context only)
- `mutators/mutatorDefs.js` (rule names/descriptions/choice types only)
- `mutators/mutatorEngine.js` (active-rule serialization shape only)

## Active mutator display inventory

| Surface | Current state source | Current frontend behavior | Readability risk | Recommended treatment | Timing |
|---|---|---|---|---|---|
| Active rule list (bottom row) | `mutatorState.activeRules[*]` from `serializeMutatorState` | Card shows name + status/duration only | Medium: omits owner/target context for many rules | Add lightweight metadata line for owner/chooser and target where available | **Now (safe frontend-only)** |
| Turns remaining | `activeRule.expiresAtMove - mutatorState.moveCount` | Shown as `N moves left`; persistent shows `Persistent`; fallback `Active` | Low-medium: generally clear but easy to miss context without owner/target | Keep current duration text, pair with metadata line and richer tooltip | **Now (paired with metadata)** |
| Rule owner / chooser | `activeRule.chooser` (`w`/`b`) | Not displayed on active cards | Medium-high: players may not know who initiated a rule | Display owner line (`Chosen by: White/Black`) on each active card | **Now** |
| Rule target (when applicable) | `activeRule.choiceData` (string/object/array varying by mutator) | Not displayed on active cards; hidden inside state only | High for targeted rules (e.g., square/piece/file) | Add compact target summary line with safe normalization and truncation | **Now** |
| Persistent terrain/effect summary | `activeRule.persistent` and `boardModifiers` | Persistent cards marked `Persistent`; board overlays exist separately | Medium: persistence and board state are split across surfaces | Keep row marker + tooltip summary; later add dedicated compact “Persistent Effects” summary strip | Later |
| Tooltip / glossary text | `activeRule.description` | Tooltip shows static rule description only | Medium: lacks runtime context (owner/target/duration) | Expand tooltip to include runtime metadata lines under description | **Now** |

## Readability risks found

1. Active cards previously omitted **chooser ownership** despite owner being present in mutator state.
2. Active cards previously omitted **target details** for targeted rules (square/file/row/piece metadata).
3. Tooltip text was static and lacked runtime context (who chose, what target, duration snapshot).
4. Persistent effects are somewhat legible via board markers, but active-row cards did not bridge that context.

## Safe frontend changes included in this PR

1. Added runtime metadata extraction in active mutator cards for:
   - chooser (`Chosen by: White/Black`)
   - target (`Target: ...`) when derivable from `choiceData`
2. Added a compact metadata line on active cards below name.
3. Expanded active-card tooltip content to include:
   - base description,
   - chooser,
   - target (when available),
   - duration/persistent status snapshot.
4. Added subtle styling for the metadata line to keep visual hierarchy readable.

These changes are frontend display/copy-only and do not alter backend or gameplay behavior.

## Recommended display treatments (next PR candidates)

1. Add a tiny glossary/legend near the active row clarifying `Persistent`, `Active`, and target notation.
2. Add a compact “Global Effects” summary chip row sourced from `activeRules` + `boardModifiers`.
3. Add explicit owner-target phrasing for second-player-choice mutators (e.g., “Chosen by White • Resolved by Black”).
4. Add frontend snapshot tests for active-card metadata rendering from synthetic `mutatorState` fixtures.

## Future implementation plan

1. **Metadata completeness pass:** map additional mutator-specific `choiceData` structures into friendlier target strings.
2. **Global effect strip:** present persistent board modifiers (mines, pits, locked squares, etc.) in one textual strip.
3. **Tooltip glossary pass:** append one-line effect semantics for common persistent effects.
4. **A11y pass:** ensure tooltip metadata is also available in non-hover contexts and screen reader-friendly labels.
5. **Regression tests:** add deterministic rendering tests for owner/target/duration copy.

## Explicit contract confirmation

Confirmed for this PR:

- No gameplay rule or mutator semantics changes.
- No move legality changes.
- No room lifecycle changes.
- No turn-clock lifecycle changes.
- No bot behavior changes.
- No Socket.IO event name changes.
- No Socket.IO payload shape changes.
- No backend state mutation changes.
