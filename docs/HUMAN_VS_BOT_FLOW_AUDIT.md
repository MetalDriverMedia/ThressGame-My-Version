# Human vs Bot Flow Audit (Phase E)

## Purpose and scope

This Phase E audit reviews the player-facing human-vs-bot flow from the landing entry point through active play, bot turns, prompts, game end, and return-to-lobby behavior.

The audit is intentionally frontend/UX-first. It does **not** change gameplay rules, mutator semantics, move legality, room lifecycle internals, turn-clock behavior, Socket.IO event names or payload shapes, bot decision semantics, or balance tuning.

## Files inspected

### Planning and previous audits
- `docs/GAME_COMPLETION_ROADMAP.md`
- `docs/HUMAN_VS_HUMAN_FLOW_AUDIT.md`
- `docs/ROOM_CREATION_AUDIT.md`
- `docs/JOIN_FLOW_AUDIT.md`
- `docs/MOBILE_RESPONSIVE_UX_AUDIT.md`
- `docs/PLAYER_PROMPTS_AUDIT.md`
- `docs/BOARD_MARKERS_AUDIT.md`
- `docs/ACTIVE_MUTATOR_DISPLAY_AUDIT.md`
- `docs/EVENT_FEED_AUDIT.md`
- `docs/RULE_SEMANTICS_AUDIT.md`
- `docs/PRESET_RULE_MODES.md`
- `docs/BALANCE_TUNING_AUDIT.md`

### Frontend flow and display code
- `public/index.html`
- `public/styles.css`
- `public/js/main.js`
- `public/js/events.js`
- `public/js/socketHandlers.js`
- `public/js/state.js`
- `public/js/storage.js`
- `public/js/ui.js`
- `public/js/mutatorUI.js`
- `public/js/board.js`

### Backend and bot wiring reviewed for contracts only
- `handlers/joinHandler.js`
- `handlers/playerHandlers.js`
- `handlers/moveHandler.js`
- `handlers/mutatorHandler.js`
- `botManager.js`
- `gameManager.js`
- `server.js`

## Files changed

- `docs/HUMAN_VS_BOT_FLOW_AUDIT.md`
  - Added this focused human-vs-bot flow inventory, risk list, QA checklist, deferrals, and future implementation plan.
- `public/index.html`
  - Moved mutator/manual coin-flip setup out of the Create Room-only panel into always-visible landing “Game Settings” so Play vs Bot users can discover and adjust bot-game settings before starting.
- `public/js/events.js`
  - Updated the custom-settings leaderboard notice copy so it applies to both Create Room and Play vs Bot.

## Human-vs-bot flow inventory

| Flow surface | Current source/code path | Current frontend behavior | Usability/reliability risk | Recommended UX treatment | Implementation timing |
| --- | --- | --- | --- | --- | --- |
| Play vs Bot entry point | `public/index.html` landing buttons; `public/js/events.js` `play-bot-btn` click handler; `handlers/joinHandler.js` `handleJoinBot`; `server.js` `joinBot` socket wiring | User clicks **Play vs Bot** and the client emits `joinBot` with name, browser id, disabled mutators, and manual coin-flip flag. Backend creates a private bot room and starts immediately. | Previously, mutator/manual coin-flip settings lived inside the Create Room options block, so bot players could miss the settings before the immediate start. | Keep one-click immediate start, but make game settings visible before Play vs Bot. | **Done now** via landing copy/layout only. |
| Player name validation before bot game | `public/js/events.js` `getPlayerName`; `handlers/joinHandler.js` `validateName` reused by `handleJoinBot` | Empty name is blocked client-side; length/characters/profanity are enforced server-side via `joinError`. | Client only checks non-empty, so invalid long/special/profane names show after server roundtrip. This is reliable but can feel delayed. | Keep server authority. Later add client helper copy mirroring max length/allowed characters without changing validation authority. | Later. |
| Bot game immediate room creation/start | `handlers/joinHandler.js` `handleJoinBot`; `server.js` `startGame`; `public/js/socketHandlers.js` `onJoinSuccess` and `onGameStarted` | Backend sends `joinSuccess`, then `gameStarted`; frontend may enter game immediately from either active join payload or gameStarted event. | Sequential events are acceptable, but users may briefly see a transition with no “bot match starting” copy. | Optional later status text such as “Starting bot match…” while buttons are loading. | Later. |
| Bot color assignment | `handlers/joinHandler.js` random `playerColor`; `botManager.js` `addBotToRoom`; `public/js/ui.js` `updatePlayerBars` | Player receives random White/Black. Bars display player and opponent names with colors once state is synced. | Random assignment is clear after game view loads, but not previewed before click. | Keep random assignment. Later add small “Color is random in bot games” hint if testing shows confusion. | Later. |
| Displayed names/colors | `botManager.js` bot naming; `gameController` public player payloads; `public/js/ui.js` player bars | Bot is named `Bot N`; player bars show `Name (White/Black)` and `Bot N (opposite color)`. | Multiple bot matches in a long server session increment bot names globally; harmless but can look odd. | Document as cosmetic only. If desired later, use room-local display copy without changing identities. | Later / bot-display work. |
| Mutator settings applying to bot games | `public/js/events.js` emits `disabledMutators`; `handlers/joinHandler.js` stores `room.disabledMutators`; mutator selection in backend consumes room setting | Bot games inherit the same disabled mutator set as created rooms. | Settings were discoverable only through Create Room expansion. | Make settings visible on landing for both Create Room and Play vs Bot. | **Done now**. |
| Manual coin flip applying to bot games | `public/js/events.js` emits `manualCoinFlip`; `handlers/joinHandler.js` stores `room.manualCoinFlip`; `handlers/mutatorHandler.js` uses pending coin-flip handling | Manual coin flip flag applies to bot rooms. Human chooses when prompted if the pending flip is for the human. | Visibility problem was the same as mutator settings. Bot-side manual prompt behavior should remain documented, not altered here. | Surface setting before bot start. Defer any bot-side/manual coin UX refinements. | **Display done now**; behavior deferred. |
| Turn indicator and timer visibility | `server.js` `turnClock.startClock`; `public/js/socketHandlers.js` `onTurnClockUpdate`; `public/js/ui.js` `startTurnClock`, `updateTurnIndicator` | Title card flips with board turn. Timer appears only when server emits clock data. Server comments indicate turn clock is skipped for bot games. | If no timer appears in bot games, players may wonder whether they have time pressure. This is not a rules bug if bot games intentionally skip clock. | Later add frontend explanatory copy if bot games are intentionally untimed; do not alter clock lifecycle in this PR. | Later. |
| Player legal move flow against bot | `public/js/board.js` selection/move emission; `server.js` `move` handler; `handlers/moveHandler.js`; `public/js/socketHandlers.js` `onMoveApplied` / `onMoveRejected` | Player moves are validated server-side; applied moves animate and update state; rejected moves flash a status. | Rejection messages depend on payload text. UX is acceptable; manual QA should cover illegal move rejection. | No immediate change. | Not now. |
| Bot response timing/status clarity | `server.js` schedules bot move after human move; `botManager.js` random 2-4s delay | Bot responds after a humanized delay. | There is no persistent “Bot is thinking…” status during the delay, so a quiet board can look idle on slow or prompt-heavy turns. | Later add frontend-only status when current turn belongs to an `isBot` player, avoiding protocol changes. | Later. |
| Bot behavior during pending mutator states | `botManager.js` checks pending RPS/choice/action/secondAction and reschedules; `handlers/mutatorHandler.js` `botAutoMutatorResponse` resolves bot-facing prompts | Bot does not move through pending choice/action/RPS states; bot auto-responds when it owns supported pending prompts. | `performBotMove` reschedule guard does not include `pendingCoinFlip`, though move-result progress tracking includes it. Coin-flip behavior is handled elsewhere, but this deserves dedicated backend characterization before changing. | Document as backend/bot audit follow-up. Do not modify behavior in UX PR. | Later dedicated bot-behavior work. |
| Bot behavior during RPS | `handlers/mutatorHandler.js` RPS choice handling and bot auto-response | Bot makes random RPS choice after a short delay when it is an attacker/defender needing a choice. | Frontend may not clearly distinguish “waiting on bot RPS choice” from a stalled prompt. | Later add prompt copy/status for bot-owned pending RPS. | Later. |
| Bot behavior during coin-flip flows | `handlers/mutatorHandler.js` `coinFlipChoice`, `coinFlipStart`, `riskItRookFlipChoice`; bot auto-response helpers | Automatic coin flips resolve server-side; manual coin flips require the assigned player choice. | Bot-owned manual coin flips and Risk It Rook prompt timing should be characterized with tests/manual QA before any change. | Keep current semantics. Document manual QA and later backend characterization. | Later dedicated bot-behavior work. |
| Quiet resign / disconnect relevance in bot games | `handlers/playerHandlers.js` disconnect/resign/quiet resign; `utils/turnClock`; `public/js/ui.js` quiet resign button | Quiet resign is server-controlled and only shown if available. Bot rooms are private active rooms with a bot socket id. | Quiet resign is likely irrelevant if bot games skip turn clock, but frontend safely hides unless server offers it. | No UI change. Confirm in QA that quiet resign does not appear unexpectedly in bot games. | Not now. |
| Game-ended modal | `public/js/socketHandlers.js` `onGameEnded`; `public/js/ui.js` `formatGameEndMessage`, `showGameOverModal` | Game end stops timer, clears quiet resign, renders board, and shows modal with New Game / Quit. | Modal text is generic and sufficient. No bot-specific contract required. | Keep behavior. Later optionally label bot outcome details if users ask. | Not now. |
| New Game / Quit after bot game | `public/js/ui.js` `handlePlayAgain`, `handleQuit`; `public/js/events.js` modal bindings | New Game returns to lobby with saved name retained. Quit returns to lobby and clears saved name. | Labels are acceptable. “New Game” does not immediately start another bot game, which matches current modal subtext. | Keep behavior; document QA. | Not now. |
| Refresh/resume during bot game | `public/js/main.js` resume guard; `public/js/socketHandlers.js` `onResumeSuccess`; `handlers/playerHandlers.js` `handleResume` | Saved token resumes active room, restores board/mutator/pending UI, clock when applicable, and quiet resign state. | Bot pending states can be restored for human prompts; bot-owned pending states may need backend characterization to ensure auto-response resumes. | Document manual QA; later add targeted tests for bot-owned pending state on resume. | Later. |
| Mobile/narrow bot flow | `public/styles.css`; mobile audit baseline; landing/game panels | Existing responsive layout applies to bot flow. Settings panel is scrollable/collapsible. | Moving settings to always-visible landing adds vertical content; still collapsible, but must be checked in portrait. | Manual QA on mobile portrait; no CSS change required now. | QA now; changes later if needed. |

## Usability and reliability risks found

1. **Bot settings discoverability before immediate start**
   - Risk: Play vs Bot started immediately, while mutator/manual coin-flip settings were nested under Create Room setup.
   - Treatment: Moved settings to always-visible landing “Game Settings,” preserving existing controls and emitted payloads.

2. **No explicit “bot thinking” status**
   - Risk: The 2-4 second bot delay can look like inactivity, especially after prompt-heavy turns.
   - Treatment: Defer to a small frontend-only status pass; avoid socket or bot logic changes in this PR.

3. **Bot-owned manual coin-flip/RPS/pending states need characterization**
   - Risk: The code has bot auto-response support for several pending flows, but bot-owned manual/prompt-heavy edge cases need dedicated validation.
   - Treatment: Document as later backend/bot characterization, not a Phase E frontend UX patch.

4. **Bot games may be intentionally untimed but not explained**
   - Risk: If no timer appears, users may not know whether this is intentional.
   - Treatment: Defer explanatory copy until manual QA confirms the intended timer behavior in bot games.

5. **Refresh/resume during bot-owned pending prompts is under-documented**
   - Risk: Human prompt restoration exists; bot-owned prompt re-entry needs targeted validation.
   - Treatment: Include manual QA scenario and future test plan.

## Safe UX fixes added in this PR

- Moved mutator/manual coin-flip controls from the Create Room-only section to an always-visible landing “Game Settings” block.
- Updated the help text to explicitly state that settings apply to both Create Room and Play vs Bot before the game starts.
- Updated the leaderboard notice copy from room-specific wording to generic game custom-settings wording.

These changes are display/copy/layout-only and reuse the existing DOM ids and event handlers. They do not rename events, change payload shapes, or alter backend behavior.

## Bot-behavior deferrals

Do **not** implement these in Phase E unless they are split into dedicated bot/backend characterization PRs:

1. Bot difficulty, evaluation, trap preference, or strategy tuning.
2. Any change to bot legal move selection or `getEffectiveLegalMoves` usage.
3. Bot timing changes beyond a frontend-only status indicator.
4. Manual coin-flip automation for bot-owned flips.
5. Risk It Rook bot flip choice behavior changes.
6. Pending coin-flip handling inside `performBotMove` without targeted tests.
7. Resume/reconnect behavior changes for bot-owned pending states.
8. Turn-clock lifecycle changes in bot rooms.

## Manual QA checklist

Run these in a browser before release. Use desktop and at least one narrow/mobile portrait viewport.

- [ ] Start Play vs Bot with default settings.
- [ ] Start Play vs Bot with manual coin flip off.
- [ ] Start Play vs Bot with manual coin flip on.
- [ ] Start Play vs Bot with all mutators disabled.
- [ ] Start Play vs Bot with mutators enabled.
- [ ] Confirm player assigned White displays the correct player/bot names and colors.
- [ ] Confirm player assigned Black displays the correct player/bot names and colors.
- [ ] Confirm first turn indicator is correct when the player is White.
- [ ] Confirm first turn indicator is correct when the player is Black and bot moves first.
- [ ] Confirm timer behavior at start matches intended bot-game behavior.
- [ ] Make a normal legal player move.
- [ ] Confirm bot responds with a legal move after the expected delay.
- [ ] Trigger a mutator choice/action owned by the player and complete it.
- [ ] Confirm bot turn after mutator choice/action proceeds correctly.
- [ ] Trigger or simulate bot behavior during pending RPS flow.
- [ ] Trigger or simulate bot behavior during pending manual coin-flip flow.
- [ ] Attempt an illegal player move and confirm rejection copy appears without board mutation.
- [ ] Refresh during a bot game and confirm resume restores board, names/colors, turn, mutators, and prompts.
- [ ] End a bot game by king destruction if reachable.
- [ ] End a bot game by resignation.
- [ ] Confirm New Game returns to the lobby and retains saved name.
- [ ] Confirm Quit returns to the lobby and clears the name field/saved name.
- [ ] Complete the full bot flow in mobile portrait, including settings expansion, move selection, prompts, game over, New Game, and Quit.

## Future implementation plan

1. **Frontend-only bot turn status**
   - Add copy such as “Bot is thinking…” when `state.currentTurn` belongs to an `isBot` player.
   - Keep it derived from existing `white`/`black` player payloads.
   - Do not add socket events.

2. **Bot-game timer explanation**
   - After QA confirms intended timer behavior, add a small untimed/timed hint in the side panel if needed.
   - Do not alter turn-clock lifecycle.

3. **Client-side name guidance**
   - Mirror existing server constraints in helper text and/or HTML attributes.
   - Server remains authoritative.

4. **Resume characterization tests**
   - Add targeted tests for bot rooms resumed during player-owned and bot-owned pending states.

5. **Bot pending-flow characterization**
   - Add tests for bot turns after pending mutator choice/action/RPS/coin flip without changing decisions.

6. **Prompt clarity polish**
   - Add frontend copy that distinguishes “your choice,” “waiting for bot,” and “resolving” states for prompt-heavy bot turns.

## Contract-safety confirmation

This Phase E audit PR does not intentionally change:

- Gameplay rules.
- Mutator semantics.
- Move legality.
- Room lifecycle internals.
- Turn-clock behavior.
- Socket.IO event names.
- Socket.IO payload shapes.
- Bot move decision semantics.
- Balance tuning.

The only runtime code change is landing-page display/copy that makes existing bot-game settings discoverable before Play vs Bot starts.
