# Human vs Human Flow Audit (Phase E)

## Scope and guardrails

This Phase E audit is intentionally narrow: it reviews the end-to-end **human vs human** player experience from room creation/join through active play, pending prompts, disconnect/reconnect, game end, exit, and the current rematch expectation. It does **not** change gameplay rules, mutator semantics, move legality, room lifecycle internals, turn-clock lifecycle, bot behavior, balance, Socket.IO event names, or existing payload shapes.

## Files inspected

### Planning and prior audits

- `docs/GAME_COMPLETION_ROADMAP.md`
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

### Frontend runtime

- `public/js/main.js`
- `public/js/events.js`
- `public/js/socketHandlers.js`
- `public/js/state.js`
- `public/js/storage.js`
- `public/js/ui.js`
- `public/js/mutatorUI.js`
- `public/js/board.js`
- `public/index.html`
- `public/styles.css`

### Backend flow context

- `handlers/joinHandler.js`
- `handlers/playerHandlers.js`
- `handlers/moveHandler.js`
- `handlers/mutatorHandler.js`
- `gameManager.js`
- `server.js` (socket wiring only)

## Flow inventory

| Surface | Current source / code path | Current frontend behavior | Usability / reliability risk | Recommended UX treatment | Implementation timing |
| --- | --- | --- | --- | --- | --- |
| Host creates public room | `bindLandingEvents()` emits `createRoom`; `handleCreateRoom()` validates, creates a waiting room, stores mutator settings, assigns color, emits `joinSuccess`; `onJoinSuccess()` persists token/name and calls `showWaiting()` when status is waiting. | Host lands in the waiting panel with hidden/copyable room code, assigned color, open color, rule pool, and coin-flip setting. Public room appears in the open rooms list. | Low. The host can leave by Cancel, but cancellation is implemented as disconnect/reconnect plus session clearing rather than an explicit leave event; this is understandable to the user but internally indirect. | Keep current lifecycle. Preserve existing waiting copy and metadata. Consider later explicit room-leave UX only if backend lifecycle work is already planned. | No runtime implementation now. |
| Host creates private room | Same as public room, with `isPrivate` passed to `gameManager.createRoom()` and room omitted from public waiting list. | Host sees the same waiting panel and must share the room code manually. | Low. Private/public distinction is clear at creation, but the waiting panel does not restate that a private room will not appear in the public list. | Optional later copy: show private/public visibility in waiting metadata if backend payload exposes it. Do not add payload shape in this PR. | Later. |
| Guest joins public room from list | `renderRoomsList()` creates waiting-room rows and Join buttons; `_bindJoinBtn()` opens the rules confirmation modal; confirmation emits `joinRoom`; `handleJoinRoom()` emits `joinSuccess`, then starts the game when full. | Guest sees a confirmation modal with active rule pool and flags, then receives `joinSuccess`; room immediately transitions to game via `gameStarted`. | Low. The confirmation modal is strong. Race risk remains if another guest joins first; existing `joinError` copy covers room not joinable. | Keep confirmation. If a join race occurs, show existing error and refresh room list. | No runtime implementation now. |
| Guest joins private room by code | `submitJoinCode()` normalizes input and emits `joinRoom` directly; `handleJoinRoom()` validates and starts when full. | Guest bypasses the rule-pool confirmation modal for direct code join and sees either a join error or the game. | Medium. Direct-code guests may not see the custom rule pool/manual coin setting before entering, unlike public-list guests. Fixing this properly requires a preflight room-inspection path or server payload before joining. | Later PR: add a backward-compatible pre-join room-preview event/API or reuse existing room list data when available. Avoid implementing now because it touches backend contract and join flow. | Later dedicated UX/backend-contract PR. |
| Automatic game start when room fills | `handleJoinRoom()` calls `startGame(room)` after adding the second player; `startGame()` emits `gameStarted` with board, white, and black; `onGameStarted()` resets local transient state and calls `showGame()`. | Both players transition automatically to the game panel. Mutator panel is initialized and status flashes “Game started!”. | Low. If `joinSuccess` and `gameStarted` arrive in rapid succession, the frontend handles both. | Keep automatic start. Manual QA should confirm both clients render names/colors and timer. | No runtime implementation now. |
| Assigned colors and player names | `buildGameStatePayload()` and `startGame()` include public white/black player objects; `updatePlayerBars()` renders “Name (White/Black)” from `state.myColor`. | Each player sees themselves on the bottom bar and opponent on top with color labels. Spectators see White/Black. | Low for active games. During waiting, only assigned color/open color are shown; the host name is implicit. | Keep current player bars. Optional later: include host name in waiting metadata if useful. | No runtime implementation now. |
| Turn indicator and timer visibility | `gameStarted`, `moveApplied`, and resume payloads set board turn; `updateTurnIndicator()` flips the title card; `turnClockUpdate` calls `startTurnClock()` and game end stops it. | The title card shows White/Black turn, and the move timer appears when the server sends clock state. | Medium-low. If the server clock event is delayed, the title card still shows turn but timer may be hidden briefly. On resume, timer is restored only if the server reports an active clock. | Keep current behavior. Manual QA should verify first-turn timer and resumed timer. Avoid lifecycle changes here. | No runtime implementation now. |
| Legal move selection | `handleSquareClick()` blocks non-turn clicks, selects own pieces, shows legal destinations from `getLegalMovesForSquare()`, and `attemptMove()` emits `move`. | Current player can select a piece and destination; non-turn player gets “It's not your turn.” | Low. Mutator-aware client hints can diverge from server legality in edge cases, but server rejection is authoritative. | Keep server authority. Future work could add clearer no-legal-destination copy when a selected piece has no moves. | Later polish. |
| Move rejection copy | `handleMove()` emits `moveRejected` with `error`/`message`; `onMoveRejected()` flashes server copy. | Illegal moves and pending-state blockers display as transient status. | Medium-low. Some copy is generic (“Move blocked by active rule.”), but changing semantics/detail requires deeper rule-specific UX. | Keep current copy for contract safety. Later event feed/prompt PR can map common rejection reasons to richer explanations without changing server payloads. | Later. |
| Current-player mutator choice | `mutatorChoice` triggers `showChoiceCards(options, isChooser)`; chooser cards are clickable and emit `selectMutator`; non-chooser sees “Waiting for opponent to choose...”. | Current chooser gets three cards; opponent sees cards plus waiting text. | Low. Existing UX explains whose action is needed. | Keep. Manual QA should validate both clients during choice and after selected highlight. | No runtime implementation now. |
| Target-selection mutator action | `mutatorAction` calls `showTargetSelection()` with prompt/action type/valid squares and emits `mutatorActionResponse` after click. Resume restores eligible `pendingAction`. | Prompt bar appears near the board; valid squares are highlighted; selecting a target submits and hides the bar. | Medium. For non-acting opponent, there may be no explicit “waiting on opponent target” message unless another status flash is visible. A safe copy-only improvement is possible later using local state, but must avoid confusing cases where only one client receives `mutatorAction`. | Later frontend-only improvement: render a passive waiting banner when pending action exists for the other player on resume or broadcast state. | Later. |
| Second-player action flow | Resume restores `pendingSecondAction` for the required player; mutator handlers emit action prompts using existing event names. | Required player gets target-selection UI when applicable. | Medium. Similar to target selection: acting player is guided, other player may lack persistent context. | Add passive context in a future prompt-state banner once all pending states are modeled consistently. | Later. |
| RPS flow | Parry in `handleMove()` emits `rpsPrompt`; `onRPSPrompt()` opens RPS modal; choices emit `rpsChoice`; `rpsResult` animates outcome. Resume reopens RPS modal for players still needing a choice. | Both players see the RPS modal and choose rock/paper/scissors; result modal shows outcome then closes. | Low. If a player refreshes after choosing but before opponent chooses, resume only reopens when that player still needs a choice; this avoids duplicate choice but may not show a passive waiting modal. | Keep current safeguards. Later passive “waiting for opponent RPS” state could improve clarity. | Later. |
| Coin-flip flow | All On Red / Risk It Rook events are wired in `main.js`; coin flip prompts/results render in `mutatorUI.js`; resume restores `pendingCoinFlip` when it is for the current player. | Acting player gets coin UI; result overlay communicates outcome. | Low-medium. Manual honor-system coin flip is explicitly labeled in setup/waiting/join confirmation. Passive opponent context may still be sparse. | Keep semantics. Later prompt banner can show passive waiting for opponent coin flip. | Later. |
| Opponent disconnect / reconnect | `handleDisconnect()` marks player inactive and emits `opponentDisconnected` in active rooms; `onOpponentDisconnected()` updates base status and flash; `handleResume()` clears timer and emits `opponentReconnected`; `onOpponentReconnected()` updates status. | Remaining player sees a reconnect countdown message; reconnect shows a success message. If timeout expires, game ends by disconnect forfeit. | Low. Copy is clear, but the countdown is static rather than live. A live countdown would require local timer UI and careful timer sync. | Keep current static timeout copy. Later polish could use a local visual countdown without backend changes. | Later. |
| Host refresh/resume during waiting | `onConnect()` emits `resumeSession` when token exists; `handleResume()` accepts waiting rooms and `onResumeSuccess()` calls `showWaiting()`. Waiting-room disconnect cleanup has a timeout. | Host returns to waiting panel if within timeout; stale/expired session falls back through resume recovery. | Medium-low. Waiting refresh depends on token and server room still existing. Recovery UI can retry or clear stale session. | Keep current recovery. Manual QA should validate waiting refresh within and after timeout. | No runtime implementation now. |
| Either player refresh/resume during active game | Same resume path; active payload includes board, players, move history, captured pieces, serialized mutator state, clock metadata, and quiet resign state. | Player returns to game; pending choice/action/RPS/coin flip is restored when it requires that player. | Medium. Passive waiting states after refresh can be under-explained when the opponent has the pending action. | Later prompt-state banner. Avoid backend lifecycle changes in this PR. | Later. |
| Stale session / already-in-room recovery | `onConnect()` starts resume; resume timeout shows Retry/Clear Saved Session; create/join handlers reject existing non-ended room for the same socket; join own room is rejected by player hash. | User can clear a stale saved token; duplicate active-room attempts show “You are already in a room.” or “You can't join your own room.” | Medium-low. Recovery is practical, but “already in a room” has no one-click resume if the token is absent on another tab/device. | Keep current recovery. Later account/session UX could offer “return to current room” when safe. | Later. |
| Game-ended modal and reason | `gameEnded` stops timer, clears active token, renders board, formats result, and shows modal. | Modal shows winner/loser/draw and reason. | Medium. The old primary button label “Play Again” implied rematch, but current handler just clears session and returns to landing. | Implemented now: relabel primary action to “New Game” and add subtitle explaining that rematch is not automatic. | Done in this PR. |
| Quit / return to landing | `handleQuit()` hides modal, clears session, shows landing, clears name, and removes stored name. | Quit returns to landing and clears saved name. | Low. Behavior is clear and intentionally stronger than new game. | Keep. Manual QA should distinguish New Game vs Quit. | No additional implementation now. |
| Play Again / rematch expectation mismatch | `handlePlayAgain()` clears session and shows landing; no room rematch event/lifecycle exists. | Prior “Play Again” label suggested an in-room rematch but did not create one. | High UX expectation mismatch. True rematch needs backend room lifecycle and synchronization work. | Implemented now: copy says New Game, with explanatory subtitle. Future dedicated rematch PR should add explicit mutually accepted rematch lifecycle. | Copy fix now; true rematch later. |
| Mobile/narrow human-vs-human flow | Responsive CSS stacks game section under 1024px and compacts waiting/modal layouts under 560px. | Narrow screens stack board and choice column; waiting metadata becomes one column; modal buttons stack. | Medium. Full H2H prompt flows on portrait mobile still need real-device validation, especially RPS/coin overlays and target-selection bar. | Document manual QA. Avoid layout refactor without browser validation. | Manual QA required. |

## Safe UX fixes added in this PR

- The game-over primary action is now labeled **New Game** instead of **Play Again**.
- The game-over modal now includes explanatory copy: starting a new game returns to the lobby and does not rematch the same opponent automatically.
- Modal styling was adjusted for the new explanatory copy only.

These changes are frontend display/copy-only and do not alter room lifecycle, scoring, events, payloads, turn clocks, gameplay, mutators, bot behavior, or balance.

## Rematch / Play Again recommendation

True rematch should be a later dedicated PR. Recommended future design:

1. Add explicit server-side rematch state for ended human-vs-human rooms.
2. Require both players to opt in from the ended-game modal.
3. Decide whether rematch preserves colors, swaps colors, or asks again.
4. Reset board/mutator/clock state through a new lifecycle transition without reusing stale timers or pending mutator state.
5. Broadcast clear waiting states: “You requested rematch” and “Opponent requested rematch.”
6. Add tests for one-player request, both-player accept, decline/quit, refresh while rematch pending, and room cleanup.

Do **not** implement true rematch as a frontend-only button; it would create misleading or divergent client state.

## Manual QA checklist

Manual browser validation was not run in this non-interactive environment. Required manual QA scenarios:

- [ ] Host creates public room, guest joins from list.
- [ ] Host creates private room, guest joins by code.
- [ ] Assigned colors and player names display correctly for both players.
- [ ] First turn/timer starts correctly.
- [ ] Normal legal move from each player.
- [ ] Illegal move rejection.
- [ ] Mutator choice by current player.
- [ ] Target-selection mutator flow.
- [ ] Second-player action flow.
- [ ] RPS flow.
- [ ] Coin flip flow.
- [ ] Opponent disconnect and reconnect.
- [ ] Host refresh/resume during waiting room.
- [ ] Either player refresh/resume during active game.
- [ ] Game end by king destruction or resignation.
- [ ] Quit / return to landing.
- [ ] New Game button returns to landing and does not imply an automatic rematch.
- [ ] Mobile portrait full human-vs-human flow.

## Future implementation plan

1. **Passive pending-state banner:** add consistent local copy for “waiting on opponent” during target action, second-player action, RPS after local choice, and coin flip after local choice.
2. **Direct-code join preview:** add a backward-compatible preview path so private-room guests can see active rule pool/manual coin setting before joining.
3. **Live disconnect countdown:** add a local countdown display seeded by the existing timeout value, without changing disconnect lifecycle semantics.
4. **No-move/no-target copy polish:** add clearer frontend-only status when a selected piece has no legal destinations or a target-selection prompt has narrow valid targets.
5. **True rematch lifecycle:** implement as a backend/frontend feature with explicit opt-in state, cleanup, timer safety, and tests.
6. **Mobile prompt validation pass:** validate RPS, coin overlays, target bar, mutator cards, and game-over actions on portrait phones.

## Contract-safety confirmation

This audit PR does not rename Socket.IO events, does not change existing Socket.IO payload shapes, does not change gameplay rules, does not change mutator behavior, does not change move legality, does not change room lifecycle internals, does not change turn-clock lifecycle, does not change bot behavior, and does not change balance.
