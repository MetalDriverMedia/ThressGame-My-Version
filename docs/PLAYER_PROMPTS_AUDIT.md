# Player Prompts Audit (Phase D, Required Interactions)

## Scope

This audit is intentionally narrow and frontend-first.

- Focus: player-facing prompt clarity and visibility for required interactions.
- Non-goals: changing gameplay rules, mutator semantics, move legality, room lifecycle, turn clock lifecycle, bot behavior, or Socket.IO event names/payload shapes.

## Files inspected

- `docs/GAME_COMPLETION_ROADMAP.md`
- `docs/RULE_SEMANTICS_AUDIT.md`
- `docs/PRESET_RULE_MODES.md`
- `docs/BALANCE_TUNING_AUDIT.md`
- `public/js/ui.js`
- `public/js/socketHandlers.js`
- `public/js/main.js`
- `public/js/state.js`
- `public/js/mutatorUI.js`
- `public/index.html`
- `public/styles.css`
- `handlers/moveHandler.js` (event/message source only)
- `handlers/mutatorHandler.js` (event/prompt source only)

## Required Prompt Surface Inventory

| Prompt surface | Current event/source | Current frontend display behavior | Clarity risk | Recommendation | Implementation timing |
|---|---|---|---|---|---|
| Pending mutator choice prompt | `mutatorChoice` from backend | Choice cards render in right panel; non-chooser sees "Waiting for opponent to choose..." | Medium: chooser has no explicit top-line instruction beyond clickability | Add concise banner copy near choice panel: "Choose 1 mutator" for chooser and "Opponent is choosing" for non-chooser | Later (UI refinement PR) |
| Pending action target prompt | `mutatorAction` payload prompt | Target bar text + highlighted selectable squares | Medium-low: relies on backend prompt quality; fallback text historically generic | Keep payload prompt primary; improve client fallback copy when prompt absent | **Now (safe frontend copy fallback)** |
| Pending second-player action prompt | `pendingSecondAction` restore + `mutatorAction` events | Historically showed generic "Select a target" in resume path | High: second player may not know which mutator/action they are resolving | Generate contextual fallback: "<Rule>: select your target" with second-choice wording | **Now (safe frontend copy fallback)** |
| RPS prompt | `rpsPrompt` | Modal title + context text + R/P/S buttons | Medium: context can be terse during reconnect/restore | Keep modal; ensure fallback context explicitly references contested capture | Now (copy tweak) |
| RPS result display | `rpsResult` | Animated reveal with outcome line | Medium: tie text may not make attacker-win-on-tie obvious | Change tie copy to explicitly say attacker wins tie and capture proceeds | **Now (safe copy)** |
| Coin flip prompt | `coinFlip`, `coinFlipPrompt`, `riskItRookFlipPrompt` | Coin overlay/manual buttons | Medium-low: mostly clear already | Keep as-is; consider adding one-line rule reminder for tails restriction in overlay subtitle | Later |
| Coin flip result display | `coinFlipResult`, animation result | Heads/Tails text shown briefly | Low | Keep current concise outcome text | Not needed |
| Move rejection messages | `moveRejected` from move handler | Flash status with backend error/message string | Medium: mixed tone/format across backend branches | Future pass: normalize punctuation/tone and append short action hint where safe | Later (would touch backend strings) |
| Skipped turn message | `moveApplied.skipMessage` (e.g., Parry blocked) | Flash status | Low-medium: appears briefly and may be missed | Add optional icon/longer display duration for skip-turn critical notices | Later |
| Game-ended reason | `gameEnded` payload reason/winner | Modal message via `formatGameEndMessage` | Medium: some reasons terse/inconsistent punctuation | Future pass: reason-specific plain-language expansion and next-step hint | Later |
| Rematch / return to lobby flow | Game over modal buttons | "Play Again" and "Quit" both currently return to landing | Medium: "Play Again" implies rematch but acts as lobby return | Relabel buttons to actual behavior (e.g., "Return to Lobby" / "Leave Lobby") or implement true rematch event in separate PR | Later |

## Safe frontend changes included in this PR

1. Added robust fallback helper for mutator target prompts so players see contextual wording when payload prompt is missing.
2. Applied the helper to:
   - live `mutatorAction` handling
   - restored `pendingAction` and `pendingSecondAction` on resume
3. Updated RPS fallback context copy to be explicit about contested captures.
4. Updated RPS tie result copy to explicitly state attacker wins ties in Parry.

These changes are copy/visibility-only on the frontend and do not alter backend contracts.

## Clarity risks found (summary)

- Second-player action restore path had generic copy and weak context.
- RPS tie message could be misread as neutral instead of attacker-favored under current semantics.
- Game over action labels do not match actual behavior (rematch expectation mismatch).
- Move rejection strings vary in tone and granularity because they are emitted from many backend branches.

## Future implementation plan (next prompt-focused frontend PR)

1. Add consistent prompt header system ("Action required", "Waiting on opponent", "Result") with iconography.
2. Improve game-over modal CTA wording to match current behavior unless true rematch is implemented.
3. Add optional sticky event feed row for high-impact events (skip turn, rejected move, coin flip outcome).
4. Add accessibility pass:
   - `aria-live` escalation for urgent prompts,
   - focus management for modals,
   - keyboard hints for target selection.
5. Add lightweight frontend prompt snapshot tests (string regression checks for critical flows).

## Explicit contract confirmation

Confirmed for this PR:

- No gameplay rule changes.
- No mutator behavior changes.
- No move legality or move handling contract changes.
- No room lifecycle changes.
- No turn clock lifecycle changes.
- No bot behavior changes.
- No Socket.IO event name changes.
- No Socket.IO payload shape changes.
