# Spectator Mode Audit (Phase E)

## Scope and conclusion

This audit treats Spectator Mode as a **future / post-alpha feature**, not an alpha blocker. The current implementation is useful as an internal preview for public human-vs-human matches, but it is not complete enough to promise as an alpha feature because spectator resume is session-only, bot/private games are intentionally not spectatable, and prompt/feed visibility is partial.

**Alpha recommendation:** explicitly defer Spectator Mode from alpha scope. Keep the existing public human-vs-human Watch flow available as best-effort if it remains stable, but do not market it as an alpha requirement. Alpha should focus on player room creation, join, human-vs-human, human-vs-bot, rematch/new-game recovery, mobile playability, board markers, active mutator readability, event-feed readability for players, rule semantics, and balance.

This PR intentionally preserves gameplay rules, mutator semantics, move legality, room lifecycle internals, turn-clock lifecycle, bot behavior, Socket.IO event names and payload shapes, and balance.

## Files inspected

- `docs/GAME_COMPLETION_ROADMAP.md`
- `docs/REMATCH_FLOW_AUDIT.md`
- `docs/HUMAN_VS_HUMAN_FLOW_AUDIT.md`
- `docs/HUMAN_VS_BOT_FLOW_AUDIT.md`
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
- `handlers/spectatorHandler.js`
- `handlers/joinHandler.js`
- `handlers/playerHandlers.js`
- `handlers/moveHandler.js`
- `handlers/mutatorHandler.js`
- `gameManager.js`
- `server.js` (socket wiring only)

## Files changed

- `docs/SPECTATOR_MODE_AUDIT.md`
- `public/index.html`
- `public/js/ui.js`
- `public/js/mutatorUI.js`
- `public/styles.css`

## Current implementation summary

Spectating is implemented as a Socket.IO room membership layer for public active human-vs-human rooms:

- The lobby receives `roomsList` with `waiting` rooms and `active` spectatable rooms.
- Clicking Watch emits `spectateRoom` with `{ roomCode }`.
- `handleSpectateRoom` validates the room, joins the socket to the game room channel, adds the socket id to `room.spectators`, emits `spectateSuccess`, and broadcasts `spectatorCount`.
- Spectators receive broad game-room events because they are joined to the same Socket.IO room as the players.
- Spectator board clicks are guarded client-side by `state.isSpectator` and server-side move/mutator handlers only trust player sockets mapped by `gameManager.getRoomForSocket` / `room.getPlayerBySocket`.
- `handleSpectatorDisconnect` removes disconnected spectator sockets from each room's `spectators` set and broadcasts a new count.

## Spectator surface inventory

| Surface | Current source / code path | Current behavior | Usability / reliability risk | Recommended treatment | Implementation timing |
| --- | --- | --- | --- | --- | --- |
| Public active game listing | `server.js` `broadcastRoomUpdate`; `gameManager.getSpectatableRooms`; `public/js/ui.js` `renderRoomsList` / `_diffActiveRows` | Lobby shows a Live Games table for public active rooms returned by `getSpectatableRooms`. Private rooms and bot games are excluded. | Copy does not explain that bot/private games are intentionally absent. Active rows expose only names and viewer count, not current turn or mutator context. | Keep as best-effort preview. Add richer metadata only in a future Stream Mode if needed. | Later; no alpha requirement. |
| Watch button behavior | `public/js/ui.js` `_bindWatchBtn`; `handlers/spectatorHandler.js` `handleSpectateRoom` | Watch emits `spectateRoom` with room code. Server emits `spectateSuccess` or `spectateError`. | Button has no loading state, no retry affordance, and no preflight indication when a room disappears between poll and click. Existing error path is acceptable for optional feature. | Keep. Optional future polish: loading state and stale-row removal on `spectateError`. | Later. |
| Direct room-code spectate fallback | `handlers/joinHandler.js` `handleJoinRoom`; `public/js/main.js` `?watch=` handler | If a user submits Join Room for a non-joinable active spectatable room, the server auto-converts to spectate. `?watch=ROOM` also emits `spectateRoom` after connect. | Join-code fallback requires a name because the join form validates name before emitting `joinRoom`. `?watch=` has no visible dedicated copy if spectate fails. | Document as supported but rough. A dedicated “Watch by code” UI should be future work if spectator mode ships. | Later. |
| Spectator join/resume behavior | `handlers/spectatorHandler.js`; `public/js/socketHandlers.js` `onSpectateSuccess`; `public/js/main.js` `?watch=` | Spectator state is not tokenized. Refresh from a Watch-click page returns to landing unless the URL includes `?watch=ROOM`. Socket.IO reconnect can keep client state if the socket reconnects without a full page reload. | No durable spectator resume token; page refresh loses watch state unless direct watch URL is used. | Defer. Add durable spectator URL/session only for Stream Mode or spectator polish. | Later. |
| Read-only board interaction | `public/js/board.js` `handleSquareClick`; server move/mutator handlers | Board clicks return early for `state.isSpectator`. Server gameplay handlers require a mapped player socket. | Previously, spectator squares still used a pointer cursor, which visually implied interactivity. | Safe frontend fix: add spectator-mode class and default cursor on board squares / choice cards. | Done now. |
| Spectator turn indicator | `public/index.html` title card; `public/js/ui.js` `updateTurnIndicator`; `public/js/socketHandlers.js` move/update handlers | Spectators see the same White Turn / Black Turn flip card, and the clock if `turnStartTime` is present. Bot games do not spectate. | Indicator is legible but not customized for spectators. Game-ended path stops active state, so the title card remains whatever last side was shown behind the modal. | Keep. Future: “White to move / Black to move” with player names and ended-state text. | Later. |
| Spectator player names/colors | `public/js/ui.js` `updatePlayerBars`; `gameController.getPublicPlayer` | Spectator view pins Black in the top bar and White in the bottom bar, with color labels. | This is readable, but the top/bottom layout differs from a player's self/opponent framing and should be verified on mobile. | Keep and manually QA. | No implementation needed now. |
| Spectator active mutator display | `handlers/spectatorHandler.js` includes serialized `mutatorState`; `public/js/socketHandlers.js` restores persistent cards; `public/js/mutatorUI.js` renders active row | Persistent / active mutators and board overlays render from `mutatorState`. Future room events also update the same UI. | Pending prompt context is partial. Spectators may see selected cards and active cards, but player-only target prompts/RPS/manual flip prompts are not a complete stream narrative. | Keep current active display. Treat true prompt/event narration as future Stream Mode work. | Later. |
| Spectator board marker readability | `public/js/mutatorUI.js` board overlay renderer; `public/styles.css` overlay styles | Spectators see the same board markers as players when `mutatorState` is present and subsequent board updates arrive. | No spectator-specific legend or event explanation; markers can be hard to interpret without feed narration. | Use existing board marker audit as player-alpha scope; spectator-specific legend is future polish. | Later. |
| Spectator event/feed readability | Existing `flashStatus`, mutator cards/history, animations; no dedicated event feed surface | Spectators receive many room-wide events but there is no durable spectator feed or stream timeline. | High readability risk for complex mutators, pending choices, RPS, coin flips, and rapid board changes. | Defer true spectator feed to later Stream Mode / spectator polish. | Later. |
| Spectator prompt visibility without controls | `public/js/socketHandlers.js` `onMutatorChoice`; `public/js/mutatorUI.js` `showChoiceCards`; targeted player-only prompt events | Choice cards render non-clickable for spectators because `payload.chooser === state.myColor` is false. Target/RPS/manual prompts are mostly player-socket-specific or control-oriented. | Non-chooser copy said “Waiting for opponent,” which was player-framed for spectators. Larger issue remains that many prompts are invisible or control-oriented, not narration-oriented. | Safe frontend fix: spectator choice copy now says it is watching the chooser pick. Broader prompt narration is future Stream Mode. | Small fix done now; larger work later. |
| Spectator game-ended behavior | `public/js/socketHandlers.js` `onGameEnded`; server lifecycle emits room-wide `gameEnded` | Spectators in the room receive `gameEnded`, board is rendered, turn clock stops, game-over modal appears. | `onGameEnded` clears `state.isSpectator`, so after the modal the page is effectively leaving spectator mode. This is acceptable for optional mode but not a polished watch experience. | Keep for alpha deferment. Future: spectator-specific ended copy and “Back to lobby” CTA. | Later. |
| Spectator disconnect/cleanup behavior | `handlers/spectatorHandler.js` `handleSpectatorDisconnect`; `server.js` disconnect wiring | Disconnect removes socket id from `room.spectators` and broadcasts `spectatorCount`. | Full page refresh creates a new socket; if the old disconnect is delayed briefly, count may transiently double until disconnect cleanup runs. No persistent spectator resume. | Keep. Manual QA counts on disconnect/refresh. | No implementation needed now. |
| Mobile spectator view | `public/index.html` existing game layout; `public/styles.css` responsive game/board/sidebar styles | Spectator uses the same responsive game layout as players, with banner and hidden resign controls. | Spectator-specific readability is not fully validated. Active mutator row and choice panel can become dense on portrait mobile. | Defer feature commitment; include manual mobile portrait QA. | Later. |

## Usability and reliability risks found

1. **Feature-scope risk:** Spectator Mode is present enough to discover but not complete enough to promise for alpha.
2. **Bot/private expectation risk:** `isSpectatable()` excludes bot games and disabled/private spectating; the UI does not explain this absence.
3. **Resume risk:** spectators have no durable token/session flow. Only normal socket reconnect and `?watch=` help.
4. **Prompt narration risk:** player-targeted prompts are not a spectator narrative. This is the largest readability gap.
5. **Event/feed risk:** there is no dedicated durable feed for spectators; flashes and animations are ephemeral.
6. **Cursor affordance risk:** read-only squares/cards previously still looked clickable. This PR fixes that with CSS only.
7. **Ended-state polish risk:** spectators see the generic game-over modal and lose spectator flag state.
8. **Mobile density risk:** same responsive layout is used, but spectator-specific portrait readability still needs manual validation.

## Safe UX fixes added

- Spectator banner copy now says **“Spectating — read-only view”** so watchers know they cannot act.
- Game panel now receives a `spectator-mode` class when rendered for spectators.
- Spectator board squares and spectator choice cards use a default cursor instead of pointer.
- Mutator choice waiting copy now says **“Watching [player] choose a mutator...”** for spectators instead of player-framed “Waiting for opponent to choose...”.

These are frontend display/copy/layout-only changes. They do not alter event names, payload shapes, backend room state, move validation, mutator resolution, clocks, bots, or balance.

## Future implementation plan

If Spectator Mode becomes a shipping feature after alpha, implement it as a narrow Stream Mode / spectator polish track:

1. Decide whether bot games and private-room watch links should be supported, and document the rule clearly.
2. Add a first-class Watch by Code flow that does not require entering a player name.
3. Add durable spectator resume via `?watch=` links or a spectator-specific local state that does not use player tokens.
4. Add spectator-specific game-ended UI: final result, winner, reason, and Back to Lobby CTA.
5. Add a spectator event stream that narrates:
   - moves,
   - captures,
   - checks,
   - mutator options offered,
   - chooser selected mutator,
   - target prompts without controls,
   - RPS start/result,
   - coin flip start/result,
   - skipped turns,
   - game end.
6. Add optional active room metadata: current turn, move count, active mutator count, and elapsed game time.
7. Add mobile-specific spectator layout QA and spacing refinements.
8. Add automated characterization tests for spectator authorization and cleanup if the backend contract is expanded.

## Manual QA checklist

Manual browser validation was not run in this non-interactive environment. Required QA before enabling Spectator Mode as a supported feature:

- [ ] Create an active human-vs-human public game and watch from a third browser/session.
- [ ] Create an active bot game and confirm it is not listed/watchable unless the product decision changes.
- [ ] Click Watch from the public active game list.
- [ ] Attempt direct active room-code spectate through Join Room and through `?watch=ROOM`.
- [ ] Confirm spectator cannot move pieces.
- [ ] Confirm spectator cannot select mutators or respond to prompts.
- [ ] Confirm spectator sees player names/colors correctly.
- [ ] Confirm spectator sees turn indicator correctly.
- [ ] Confirm spectator sees active mutators and board markers.
- [ ] Confirm spectator sees game end state and can return to the lobby.
- [ ] Confirm spectator refresh/resume behavior for both Watch-click and `?watch=ROOM` entry.
- [ ] Confirm spectator disconnect decrements viewer count for players and other spectators.
- [ ] Confirm mobile portrait spectator view is readable, including board, player bars, active mutators, choice cards, and timer.

## Contract preservation confirmation

- No Socket.IO events were renamed.
- No Socket.IO payload shapes were changed.
- No backend spectator room lifecycle behavior was changed.
- No gameplay rule, mutator semantic, move legality, turn-clock, bot, room lifecycle, or balance behavior was changed.
- All runtime changes are frontend-only readability/affordance updates.
