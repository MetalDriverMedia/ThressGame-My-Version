# Event Feed / Game Log Audit (Phase D, Narrow)

## Scope

This audit is intentionally **frontend readability-first**.

- Goal: improve player-facing event feed/game-log clarity so chaotic events have understandable cause-and-effect.
- Non-goals: gameplay changes, mutator semantic changes, move-legality changes, room lifecycle changes, turn-clock changes, bot behavior changes, or Socket.IO event contract changes.

## Files inspected

- `docs/GAME_COMPLETION_ROADMAP.md`
- `docs/PLAYER_PROMPTS_AUDIT.md`
- `docs/BOARD_MARKERS_AUDIT.md`
- `docs/ACTIVE_MUTATOR_DISPLAY_AUDIT.md`
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
- `handlers/moveHandler.js` (event source review only)
- `handlers/mutatorHandler.js` (event source review only)
- `utils/gameLifecycle.js` (event source review only)
- `mutators/ruleHooks.js` (event context review only)
- `mutators/mutatorDefs.js` (event context review only)

## Event feed inventory

| Surface | Current event/source | Current frontend behavior | Readability risk | Recommended treatment | Timing |
|---|---|---|---|---|---|
| Mutator activated | `mutatorActivated` | `flashStatus("<rule> activated")`; mutator history card inserted as instant/persistent | Medium: skip/failed activation path previously looked like activation | Treat skipped activations as skipped in history + status copy | **Now (implemented)** |
| Piece transformed | Usually represented via `mutatorActivated`/`mutatorBoardUpdate` + board animation | Visual board change but no explicit log line describing transform cause | Medium-high in chaotic turns | Add structured history sentence template later (e.g., `X transformed Y`) from existing payload context where available | Later |
| Trap triggered (generic) | Server resolves in move flow (`handleMove`/`triggerSoftRestrictions`); outcome mostly visible via board + optional end state | No dedicated event-feed line beyond resulting board update/status | High: cause of disappearance can be unclear | Add frontend-only derived feed copy when move resolves into trap outcomes (without changing event contracts) | Later |
| Mine consumed | `moveApplied` result after mine interaction, board modifier updates via `mutatorBoardUpdate` | Mine marker disappears; no explicit textual cause | Medium | Add feed line: `Mine triggered on <square>; mine removed` | Later |
| Pit triggered | `moveApplied` + board update and possible game end | Piece disappearance + maybe game-over modal reason | Medium | Add feed line explicitly naming pit trigger and victim square | Later |
| Living Bomb moved / exploded | state from `mutatorBoardUpdate`/`mutatorActivated`; explosion handled server-side | Board marker moves/disappears; no dedicated timeline sentence | High | Add explicit event-feed entries for bomb move/explosion outcomes using existing payload/state transitions | Later |
| Mitosis target moved / expired / duplicated | target from active rule `choiceData`; duplication during expiry path | Target marker visible; no explicit textual lifecycle entries | Medium-high | Add feed entries for target assigned, moved, duplication resolved, and expiry | Later |
| RPS started / resolved | `rpsPrompt`, `rpsResult` | Modal prompt/result shown; no persistent event history entry | Medium | Add concise timeline row (`Parry duel started`, `Parry resolved: capture proceeds/blocked`) | Later |
| Coin flip prompted / resolved | `coinFlipPrompt`, `coinFlip`, `coinFlipResult`, `riskItRookFlipPrompt`, `riskItRookFlipResult` | Overlay/manual bar + short status copy; limited persistence | Medium | Add persistent feed row with turn context and result consequence (`tails -> king-only`) | Later |
| Turn skipped | `moveApplied.skipTurn/skipMessage` from Parry or All On Red tails-no-king-moves | Flash status only, transient | Medium-high (easy to miss) | Add sticky history/feed row with skip reason and actor color | Later |
| Game ended | `gameEnded` | Modal with formatted reason; no event-feed row | Low-medium | Add terminal feed row matching modal reason and winner | Later |

## Readability risks found

1. Event history currently tracks mutator lifecycle cards but not many high-impact gameplay consequences (traps, skips, RPS/coin outcomes).
2. Transient `flashStatus` messaging can be missed during animation-heavy turns.
3. Prior behavior showed skipped mutator selections as if they activated, which can mislead cause-and-effect interpretation.

## Safe frontend changes included in this PR

1. **Skipped mutator activations now render as skipped** in the history panel rather than as normal usage entries.
2. **Activation status copy now distinguishes skipped vs activated** (`"<rule> was skipped."` vs `"<rule> activated!"`).

These are frontend-only display/copy changes using existing payload fields (`skipped`) and do not alter socket contracts or backend logic.

## Future implementation plan (next event-feed PR)

1. Add a dedicated chronological event-feed list component (separate from mutator card history).
2. Map existing socket events (`moveApplied`, `mutatorActivated`, `rps*`, `coinFlip*`, `gameEnded`) into concise cause→effect feed strings.
3. Introduce severity/stickiness levels for critical events (turn skipped, trap kill, game end).
4. Add reconnect-safe feed replay by rebuilding recent rows from available state snapshots where possible.
5. Add frontend tests for event-feed string rendering from representative payload fixtures.

## Explicit contract confirmation

Confirmed for this PR:

- No gameplay/backend rule changes.
- No mutator semantic changes.
- No move-legality changes.
- No room lifecycle changes.
- No turn-clock lifecycle changes.
- No bot behavior changes.
- No Socket.IO event name changes.
- No Socket.IO payload shape changes.
