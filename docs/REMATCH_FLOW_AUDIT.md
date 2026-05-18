# Rematch Flow Audit (Phase E)

## Scope and guardrails

This Phase E audit reviews Thress post-game surfaces that may be interpreted as **rematch**, **new game**, or **return to lobby** flows. It is intentionally documentation-first and UX-clarity-first.

This audit does **not** implement true rematch. A safe rematch lifecycle requires coordinated backend and frontend state design before any runtime feature work.

Guardrails for this PR:

- No gameplay rule changes.
- No mutator semantic changes.
- No move-legality changes.
- No room lifecycle internal changes.
- No turn-clock lifecycle changes.
- No bot behavior changes.
- No balance changes.
- No Socket.IO event name changes.
- No existing Socket.IO payload shape changes.
- No true rematch implementation.

## Files inspected

### Requested planning docs and audits

- `docs/GAME_COMPLETION_ROADMAP.md`
- `docs/HUMAN_VS_HUMAN_FLOW_AUDIT.md`
- `docs/HUMAN_VS_BOT_FLOW_AUDIT.md` — requested, but this file is not present in the repository at the time of this audit.
- `docs/ROOM_CREATION_AUDIT.md`
- `docs/JOIN_FLOW_AUDIT.md`
- `docs/MOBILE_RESPONSIVE_UX_AUDIT.md`
- `docs/PLAYER_PROMPTS_AUDIT.md`
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
- `public/index.html`
- `public/styles.css`

### Backend lifecycle and socket context

- `handlers/joinHandler.js`
- `handlers/playerHandlers.js`
- `handlers/moveHandler.js`
- `utils/gameLifecycle.js`
- `utils/turnClock.js`
- `gameManager.js`
- `server.js` — socket wiring only.

## Current post-game behavior summary

Current Thress behavior is **new-game/return-to-lobby only**, not rematch:

1. A terminal condition calls `room.endGame(...)` and `emitGameEnded(...)`.
2. `emitGameEnded(...)` clears the turn clock and quiet-resign state, emits the existing `gameEnded` payload, and leaves the ended room available for short-lived client display and cleanup.
3. The frontend `gameEnded` handler marks the local game inactive, stops the client turn clock, clears selection/check state, renders the final board, opens the game-over modal, and removes the saved resume token.
4. The game-over primary action is labeled **New Game** in the DOM, but it still calls the legacy `handlePlayAgain()` function. That function hides the modal, clears the current token, and returns to the landing panel.
5. **Quit** also hides the modal, clears the token, returns to the landing panel, clears the name input, and removes the saved name.
6. Ended rooms are deleted by scheduled cleanup and periodic cleanup, with instance/status/`endedAt` guards in the scheduled path.

## Rematch / new-game flow inventory

| Surface | Current source / code path | Current frontend/backend behavior | Usability / reliability risk | Recommended UX / lifecycle treatment | Timing |
| --- | --- | --- | --- | --- | --- |
| Game-over modal copy | `public/index.html` game-over modal, `public/js/ui.js` `showGameOverModal()`, `formatGameEndMessage()` | Modal shows the result headline and explicit copy: “Start a new game from the lobby. Automatic rematch is not available yet.” Primary CTA says **New Game**. | Low. Copy now accurately describes behavior. Function name `handlePlayAgain()` remains legacy/internal and could confuse future maintainers, but renaming would be unnecessary churn unless part of a broader cleanup. | Keep visible copy. Later, when true rematch exists, split CTAs into explicit **Request Rematch** and **New Game** actions. | No implementation now. |
| New Game button behavior | `public/js/events.js` binds `#game-over-new-game` to `handlePlayAgain()`; `public/js/ui.js` `handlePlayAgain()` | Hides the game-over modal, clears the saved session token, and returns to the landing panel. It does not notify the server and does not create or join a new room automatically. | Medium-low. UX is clear after copy fix, but backend socket-to-room mapping can remain until disconnect, ended-room cleanup, or a later create/join path removes an ended socket mapping. This is currently tolerated by create/join handlers for ended rooms. | Keep as lobby return. Do not make it a rematch button without backend lifecycle. Optional future cleanup: rename the internal handler to `handleNewGame()` in a low-risk refactor. | No implementation now. |
| Quit button behavior | `public/js/events.js` binds `#game-over-quit`; `public/js/ui.js` `handleQuit()` | Hides modal, clears the session token, returns to landing, clears the name input, and removes saved name. | Low. Behavior is intentionally stronger than **New Game** and matches a leave/forget action. | Keep. If true rematch is later added, **Quit** should cancel any local rematch request and return to landing. | No implementation now. |
| Token/session cleanup after game end | `public/js/socketHandlers.js` `onGameEnded()` removes `STORAGE_KEYS.token`; `public/js/storage.js` `clearSession()` removes the token; `gameManager.js` token mappings remain until room deletion or explicit delete path | Refresh after receiving `gameEnded` should not auto-resume because local storage no longer has the token. A stale in-memory token may exist until the page reloads or New Game/Quit clears it. Backend rejects resume for ended rooms. | Medium. If a client misses `gameEnded` due to network timing, it may try to resume later with a stale token and receive `resumeRejected: Game has ended.` Existing recovery UI can clear the stale session. | Keep current token cleanup. Future rematch pending state must decide whether a rematch token survives post-game refresh; do not overload the current gameplay resume token without a designed server state. | Later for true rematch. |
| Room cleanup after game end | `utils/gameLifecycle.js` `scheduleRoomDeletion()`; `gameManager.js` `cleanupOldRooms()` and `deleteRoom()` | Ended rooms are scheduled for deletion after five minutes. Scheduled deletion verifies the room instance, ended status, and original `endedAt` before deleting. Periodic cleanup also removes old ended rooms. | Low for current new-game flow. For future rematch, the existing cleanup timer could delete a room while rematch is pending unless rematch state deliberately owns/cancels cleanup. | True rematch must either cancel/suspend ended-room cleanup while both players are present and rematch is pending, or create a fresh room and avoid reusing ended-room cleanup entirely. | Later dedicated lifecycle PR. |
| Ended-room lifecycle | `gameManager.js` `GameRoom.status = 'ended'`, `endGame()`; `handlers/joinHandler.js` create/join/bot paths remove ended socket mappings; `handlers/playerHandlers.js` rejects ended resumes | Ended rooms are not joinable, not active, and not resumable. Create/join from a socket mapped to an ended room removes the socket mapping before continuing. | Low. Current behavior is safe for returning to lobby. It intentionally provides no in-room rematch affordance. | Preserve. Future rematch should introduce a separate explicit ended-room substate, such as `rematchPending`, only after defining cleanup and reconnect semantics. | Later. |
| Disconnect/reconnect after game end | `gameManager.js` `endGame()` clears disconnect timers; `handlers/playerHandlers.js` `handleResume()` rejects `room.status === 'ended'`; frontend recovery in `public/js/main.js` | Reconnect after game end is not a resume. If the frontend token was removed, the user lands in lobby; if a stale token remains, resume is rejected and recovery UI can clear saved session. | Medium-low. This is correct for current behavior but would be insufficient for a rematch-pending UX where users expect to return to the modal/request state. | Keep current ended-game rejection. Future rematch must add a durable rematch-pending resume path or explicitly state refresh cancels the request. Durable is recommended. | Later. |
| Human-vs-human rematch expectation | Visible game-over copy plus `docs/HUMAN_VS_HUMAN_FLOW_AUDIT.md`; no `rematch` socket event exists in `server.js` | The UI no longer promises automatic rematch. Both players must manually start/join a new game from the lobby. | Medium product gap. H2H players commonly expect a rematch option after game end. A frontend-only rematch button would be misleading and unsafe. | Future true rematch should be explicit, opt-in, synchronized, and server-authoritative. | Later dedicated feature PR. |
| Human-vs-bot new-game expectation | `handlers/joinHandler.js` `handleJoinBot()` creates a private bot room and starts immediately; game-over **New Game** returns to landing | Bot games currently use lobby-return **New Game**, then the player can click **Play vs Bot** again. There is no bot rematch/quick-restart path. | Low-medium. A one-click bot restart could be convenient, but it would still need to create a clean room and mutator state. | Keep **New Game** for bot games. Future bot UX may add **Play Bot Again** as a separate frontend action that emits existing/new room creation flow safely, not a shared H2H rematch state. | Later optional UX PR. |
| Future color handling | Current creation uses preferred/random color for H2H and random player color for bot. No rematch color policy exists. | New games use current room creation rules; no preserved/swap/randomized rematch behavior exists. | Medium design ambiguity. Color handling has fairness and expectation implications. | Recommended true-rematch default: offer a room setting or deterministic policy, but start with **swap colors** for H2H rematch fairness. Preserve current bot randomization for bot “New Game”; do not call bot restart “rematch.” | Later design/implementation. |
| Future mutator settings handling | Room creation stores `disabledMutators` and `manualCoinFlip`; `GameRoom.startGame()` creates fresh `mutatorState`; bot room creation does the same | New games use whatever settings the player currently has selected on the landing page. No automatic reuse exists after game end. | Medium. Players may expect a rematch to use the same custom rule pool. Reusing active mutator state would be dangerous; reusing static settings is likely desirable. | Future true rematch should preserve static room settings (`disabledMutators`, `manualCoinFlip`, private/public intent) by default, while creating a brand-new `mutatorState` and board. | Later. |
| Active/pending mutator cleanup | `GameRoom.startGame()` creates mutator state; `emitGameEnded()` stops clock but does not deep-reset `mutatorState`; frontend `onGameStarted()` resets local transient UI; `onGameEnded()` clears selected square/legal moves/check state | Current ended rooms retain final server mutator state until deletion, which is acceptable because ended rooms are not resumed or reused. Frontend clears some transient state but not every mutator UI concept because the modal overlays the final board. | Medium if room reuse were attempted. Pending choices, actions, RPS, coin flips, active rules, locked squares, trap state, and completed history must never carry into a rematch. | True rematch must allocate a fresh game state, fresh `Chess`, fresh `mutatorState`, empty history/captures, clear pending UI and overlays, and avoid reusing the ended room's live pending structures. | Later dedicated implementation. |
| Turn clock cleanup and restart | `emitGameEnded()` calls `turnClock.clearClock()` and `clearQuietResign()`; `turnClock.shouldRunClock()` runs only active H2H rooms; `startClock()` clears stale clock before starting | Current clock stops at game end and does not run for bot games. A new room/game starts its own server clock when gameplay begins. | Low now; high for true rematch if implemented by mutating an ended room in place without clearing timers. | Future rematch must clear old clock/quiet-resign state before pending rematch, avoid clock while pending, and start exactly one fresh clock when the rematch begins. | Later with tests. |
| Stale timers / pending states risk | `turnClock` has timer guards; `scheduleRoomDeletion()` guards instance/status/`endedAt`; bot scheduling checks room status in existing flow; mutator pending state exists on `room.mutatorState` | Current ended-room cleanup is guarded. Future in-place rematch could inherit cleanup timers, bot timers, pending callbacks, or delayed mutator auto-responses unless explicitly fenced. | High for future rematch. | Prefer creating a fresh room/game instance for rematch, or define a strict `resetForRematch()` that clears cleanup timers, turn timers, disconnect timers, bot timers, pending state, and all mutator artifacts before setting active. | Later with tests. |
| Mobile game-over/rematch UX | `public/styles.css` `.game-over-buttons` and mobile media rules; `public/index.html` modal copy | Game-over buttons stack on narrow screens. Copy is short enough for portrait modal use. | Medium. Needs device validation, especially because the game board remains behind the modal and post-game actions must be thumb-friendly. | Keep current narrow copy. If true rematch adds more buttons, mobile layout should prioritize one primary action and avoid three cramped CTAs. | Manual QA now; implementation later only if issues found. |
| Socket contract | `server.js` registered events; frontend socket handlers in `public/js/main.js` and `public/js/socketHandlers.js` | No rematch event exists. Existing post-game uses `gameEnded`, `resumeSession`, room creation/join events, and existing errors. | Low now. Any rematch feature would require new events or payload fields and must be versioned carefully. | Do not rename existing events or change payload shapes. Future rematch should add new explicit events such as `requestRematch`, `cancelRematch`, and `rematchState` rather than overloading `gameEnded`. | Later. |

## Usability and reliability risks found

1. **True rematch is a real product gap for H2H.** Current copy avoids promising it, but players may still want a synchronized same-opponent flow.
2. **Frontend-only rematch would be unsafe.** It could desynchronize clients, reuse stale room state, or imply the opponent accepted when they did not.
3. **In-place room reuse is risky.** Current ended rooms retain final mutator state until cleanup and may have cleanup timers attached.
4. **Refresh while rematch is pending is undefined because rematch pending does not exist.** This must be designed before adding a rematch CTA.
5. **Bot “rematch” should not share H2H semantics.** Bot games should use a clean quick-new-game path instead of two-party opt-in rematch.
6. **Mobile modal complexity can grow quickly.** A future rematch UI should avoid crowding the game-over modal with too many equal-priority actions.

## Safe UX fixes status

No additional runtime copy/display fixes were needed in this audit. The current UI already avoids the prior automatic-rematch implication by using:

- A **New Game** primary CTA.
- Game-over helper copy that says automatic rematch is not available yet.

This PR therefore remains documentation-only.

## Future true-rematch lifecycle design

### Product decisions

- **Should rematch require both human players to opt in?** Yes. H2H rematch must require both players to opt in after the game ends. A single player's request should only show “waiting for opponent.”
- **Should colors be preserved, swapped, or re-randomized?** Recommended default: swap colors for H2H fairness. If future settings allow alternatives, they should be explicit room-level choices shown before both players accept.
- **Should the same mutator settings be reused?** Yes for static settings only: reuse `disabledMutators` and `manualCoinFlip`. Do not reuse active rules, pending choices, traps, spawned pieces, move count, coin-flip state, RPS state, or completed mutator history.
- **Should private/public room status be preserved?** Yes as static room intent. A rematch between the same two players should not reappear as a public waiting room; if a fresh room is created internally, preserve privacy and do not expose it for public join.
- **Should rematch be available for bot games?** No for true rematch. Bot games should use **New Game** or a future **Play Bot Again** shortcut that creates a clean private bot room with selected/reused settings.
- **How should refresh/reconnect work while rematch is pending?** Recommended: rematch pending is server-authoritative and resumable for a short window using the player's existing post-game/rematch token. A reconnect should restore the game-over modal and current rematch-request state until cleanup/cancel/expiry.
- **What happens if one player quits while the other requested rematch?** The quitter cancels their request and leaves. The remaining player receives a rematch-canceled/declined state and can return to lobby or start a new room. If the quitting socket disconnects without explicit quit, keep pending only for the defined reconnect grace period, then cancel.

### Recommended server state

Add explicit server-side state instead of relying on client-only buttons:

- `room.rematch = null | { requestedBy: Set<'w'|'b'>, createdAt, expiresAt, colorPolicy, settingsSnapshot }`
- A room status/substatus that distinguishes ended display from rematch pending, without making the room joinable.
- A static settings snapshot containing:
  - `disabledMutators`
  - `manualCoinFlip`
  - original `isPrivate`
  - agreed color policy
- A cleanup policy that prevents scheduled room deletion from deleting an active rematch-pending session before its rematch expiry.

Prefer a fresh game instance for the actual rematch start. If the same room code is kept, still reset through a single server-authoritative lifecycle function that recreates chess state and mutator state from scratch.

### Recommended Socket.IO additions

Do not rename or reshape existing events. Add new explicit events later, for example:

- Client -> server: `requestRematch`
- Client -> server: `cancelRematch`
- Server -> clients: `rematchState`
- Server -> clients: `rematchStarted`
- Server -> clients: `rematchUnavailable`

The exact payloads should be documented in `docs/SOCKET_EVENTS.md` before implementation.

### Recommended client UI

- H2H game-over modal:
  - Primary: **Request Rematch** when eligible.
  - Secondary: **New Game**.
  - Tertiary/secondary: **Quit**.
  - State text after request: “Rematch requested. Waiting for opponent…”
  - State text after opponent request: “Opponent wants a rematch.”
- Bot game-over modal:
  - Primary: **New Game** or future **Play Bot Again**.
  - No “Request Rematch” copy.
- Spectators:
  - No rematch controls.
  - Optional “Game ended” and “Return to lobby/watch another game.”
- Mobile:
  - Keep one primary full-width CTA.
  - Avoid modal overflow; use concise status text.

### Cleanup and timer safety rules

Before starting a rematch:

1. Clear turn clock and quiet-resign state.
2. Clear disconnect timers and define fresh reconnect grace windows.
3. Cancel or fence ended-room cleanup timers.
4. Fence delayed bot/mutator callbacks by room instance or game generation.
5. Create a fresh `Chess` position.
6. Create a fresh `mutatorState`.
7. Clear move history and captured pieces.
8. Clear all pending mutator structures:
   - `pendingChoice`
   - `pendingAction`
   - `pendingSecondAction`
   - `pendingRPS`
   - `pendingCoinFlip`
   - Risk It Rook pending coin flip state
   - active rules
   - locked squares
   - trap/terrain metadata
   - piece metadata such as Living Bomb and Mitosis state
9. Reset frontend local state:
   - selected square
   - legal moves
   - pending promotion
   - target-selection callback
   - choice cards
   - RPS/coin prompts
   - overlays and persistent cards
   - turn indicator and captured pieces
10. Start the turn clock exactly once when the new H2H game becomes active. Do not run a clock while rematch is merely pending.

## Required implementation tests before true rematch

### Server/unit tests

- One H2H player requests rematch; room remains ended/rematch-pending and no game starts.
- Both H2H players request rematch; a fresh game starts exactly once.
- Duplicate rematch requests are idempotent.
- Rematch is unavailable for bot games.
- Spectators cannot request rematch.
- Quit/cancel by one player clears their request and notifies the opponent.
- Disconnect during rematch pending preserves request only through the reconnect grace period.
- Reconnect during rematch pending restores rematch state.
- Refresh after game end without rematch request does not resume active gameplay.
- Stale room code after cleanup cannot be joined/resumed.
- Existing ended-room cleanup does not delete a room that has legitimately transitioned into an active rematch.
- Old cleanup timers cannot delete a new room/game instance with the same code.
- Turn clock is stopped during ended/rematch-pending state.
- Turn clock starts once after rematch begins.
- Timeout/quiet-resign state is reset before rematch begins.
- Pending mutator state is absent at rematch start.
- Active mutator state, trap metadata, piece metadata, locked squares, RPS, and coin-flip pending state do not carry over.
- Static settings (`disabledMutators`, `manualCoinFlip`, private status) are reused according to the selected policy.
- Color policy is applied deterministically and tested for swap/preserve/random if multiple policies are supported.
- Bot scheduled moves do not fire into an ended or rematch-pending room.
- Socket event names and existing payload shapes remain backward-compatible.

### Frontend tests

- Game-over modal shows eligible H2H rematch controls only for human players.
- Bot game-over modal does not show H2H rematch controls.
- Clicking Request Rematch emits only the new rematch request event.
- Local request state displays “waiting for opponent.”
- Opponent request state displays a clear accept/request prompt.
- Cancel/Quit clears local pending UI.
- New Game still returns to lobby and clears session expectations.
- Reconnect/resume during rematch pending restores modal state.
- `rematchStarted` resets board, captured pieces, mutator panels, overlays, pending prompts, timer display, and turn indicator.
- Mobile/narrow modal layout remains usable with the additional rematch states.

## Manual QA checklist

Manual browser validation should cover:

- [ ] Human-vs-human game ends by king destruction/checkmate/resignation/timeout where practical.
- [ ] Game-over modal result and helper copy are visible.
- [ ] **New Game** returns to the lobby and does not imply automatic rematch.
- [ ] **Quit** returns to the lobby, clears the saved name, and clears expected session state.
- [ ] Refresh after game end lands in lobby or recovery state, not an active game.
- [ ] Reconnect attempt after game end is rejected or recovered cleanly.
- [ ] Stale room code after game end cannot be joined as a player.
- [ ] Stale room code after cleanup returns a clear not-found/not-joinable state.
- [ ] Human-vs-bot game end shows new-game/lobby behavior, not H2H rematch behavior.
- [ ] Mobile portrait game-over modal stacks buttons cleanly and helper copy remains readable.
- [ ] No visible UI text implies automatic rematch unless true rematch has been implemented.
- [ ] No gameplay behavior changes occur while playing a new game after a completed game.

## Contract-safety confirmation

This audit PR is documentation-only. It does not rename Socket.IO events, does not change existing Socket.IO payload shapes, does not change gameplay rules, does not change mutator behavior, does not change move legality, does not change room lifecycle internals, does not change turn-clock lifecycle, does not change bot behavior, and does not change balance.
