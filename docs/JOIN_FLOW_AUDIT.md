# Join Flow Audit (Phase E)

## Scope

This audit is intentionally narrow and player-flow/frontend-first.

- Focus: joining by room code, open-room discovery, join confirmation, join error clarity, spectate fallback visibility, and deterministic reconnect/rejoin expectations.
- Non-goals: gameplay rules, mutator semantics, move legality, room lifecycle internals, turn-clock lifecycle, bot behavior, balance tuning, Socket.IO event names, or existing Socket.IO payload shapes.

## Files inspected

- `docs/GAME_COMPLETION_ROADMAP.md`
- `docs/ROOM_CREATION_AUDIT.md`
- `docs/MOBILE_RESPONSIVE_UX_AUDIT.md`
- `docs/PLAYER_PROMPTS_AUDIT.md`
- `docs/PRESET_RULE_MODES.md`
- `docs/BALANCE_TUNING_AUDIT.md`
- `docs/RULE_SEMANTICS_AUDIT.md`
- `public/js/main.js`
- `public/js/events.js`
- `public/js/socketHandlers.js`
- `public/js/state.js`
- `public/js/storage.js`
- `public/js/ui.js`
- `public/index.html`
- `public/styles.css`
- `handlers/joinHandler.js`
- `handlers/spectatorHandler.js`
- `gameManager.js`
- `server.js` (Socket.IO room wiring only)

## Current join flow map

| Surface | Current source/code path | Current frontend behavior | Usability/reliability risk | Recommended UX treatment | Timing |
|---|---|---|---|---|---|
| Join by room code | `events.js` emits `joinRoom`; `joinHandler.js` looks up `gameManager.getRoom(roomCode)` | Player opens inline code field, enters a code, and submits directly. | Medium: generated room codes are uppercase, but pasted/lowercase codes previously reached the server unchanged and could fail lookup. No rule metadata is shown before direct private-code joins. | Normalize room codes before emitting and at backend lookup; keep direct private-code join fast. Add future metadata preview endpoint only if backend contract is intentionally extended. | **Now for normalization; later for private-code metadata preview** |
| Open/public room list | `gameManager.getPublicWaitingRooms()` → `roomsList` → `renderRoomsList()` | Public waiting rooms show room code, host, open color, and Join button. | Medium-low: rule settings were available in row data but not visible until modal; players could not scan room customness before clicking. | Add compact settings column showing rule-pool count and automatic/manual coin flip mode. | **Now** |
| Join confirmation modal | `_bindJoinBtn()` → `showJoinConfirm()` → emits `joinRoom` on confirm | Public list joins show enabled mutators, custom-leaderboard notice, and Join/Cancel. | Low-medium: modal title was generic and did not repeat the target room code; missing name clicked from a room row silently did nothing. | Include room code in the modal title and show a visible name-required error before opening it. | **Now** |
| Player name validation during join | `getPlayerName()` in `events.js`; `validateName()` in `joinHandler.js` | Empty names blocked client-side for direct joins; backend validates empty/long/invalid/profane names for all join paths. | Low-medium: open-list Join with no name had no feedback; backend error copy is safe but generic. | Surface missing-name feedback for open-list joins and focus the name field on join errors. Keep backend validation contract unchanged. | **Now** |
| Invalid room code errors | `joinHandler.js` emits `Invalid room code.` or `Room not found.`; `socketHandlers.js` displays `joinError` | Direct-code join errors render in the landing feedback area. | Medium: user cannot distinguish malformed vs expired/canceled/private typo beyond current strings; backend emits strings only. | Keep existing strings for contract safety. Later: safely standardize typed error codes/messages if payload expansion is approved. | Later |
| Full room behavior | `room.isJoinable()` and `getOpenColor()` in `joinHandler.js` | Waiting full rooms are not public-listed; direct code to an active full room auto-spectates if spectatable, otherwise shows `Room is not joinable.` | Medium: direct join to a just-filled room may look like a failure or unexpectedly switch to spectating if active/spectatable. | Frontend should treat `spectateSuccess` as a successful fallback and show spectator banner. Later: add copy that says “Game already started; watching instead” if backend sends a safe reason. | Later |
| Active room spectate fallback | `joinHandler.js` calls `handleSpectateRoom()` for non-joinable spectatable active rooms; active list uses `spectateRoom` | Public active games show a Watch button. Direct join to active spectatable room becomes spectate. | Low-medium: fallback is useful but invisible before direct-code submit; private active games are not discoverable and may be spectatable only by code. | Document behavior; later add explicit “Watch active game?” confirmation if backend exposes safe status metadata. | Later |
| Private room join by code | Private rooms are excluded from `getPublicWaitingRooms()`; `joinRoom` accepts exact code | Guest can join by code without room-list discovery. | Medium: no prejoin metadata or confirmation is available for private-code joins because the client has no metadata fetch path. | Keep current contract. Later add a backward-compatible room preview request/event or HTTP endpoint with public-safe metadata only. | Later |
| Joining your own room / duplicate identity | `generatePlayerHash()` + duplicate hash check in `joinHandler.js`; resume uses saved token | Same browser identity trying to join its own waiting room receives `You can't join your own room.`; same socket already mapped receives `You are already in a room.` | Medium: correct prevention exists, but users may be better served by resume/reveal-room guidance. | Keep behavior. Later improve copy or offer “Return to your waiting room” when token mapping is valid. | Later |
| Already-in-room behavior | `gameManager.getRoomForSocket()` checks create/join/bot paths | Same socket attempting another create/join gets `You are already in a room.` unless ended room mapping is cleared. | Low-medium: protects state, but landing actions can still be visible after odd reconnect states. | Keep. Resume recovery controls already exist; later add room-specific return action if server exposes safe context. | Later |
| Reconnect/resume after refresh | `main.js` stores token/name; `onConnect()` emits `resumeSession`; `onResumeSuccess()` restores waiting/active UI; guard offers retry/clear | Refresh before or during game should restore waiting/game; failure offers recovery. | Medium: deterministic flow exists, but manual QA is still required for before-start, active-game, and invalidated-session cases. | Keep current resume guard; validate manually. Future: add focused browser/e2e coverage. | Later |
| Join flow after canceled waiting room | Waiting-room Cancel disconnects/reconnects socket, clears session, and returns landing; stale join code returns `Room not found.` | Host cancellation removes local session; guests with old code see not found. | Medium: guest copy does not explicitly say host canceled/expired. | Avoid backend change now. Later add safe deletion reason only if room lifecycle exposes it without changing internals. | Later |
| Mobile/narrow join flow | Landing and join-code CSS; rooms table in `styles.css` | Join-code row stacks on narrow screens; room table remains compact. | Medium-low: adding metadata column can crowd mobile. | Keep controls stacked and reduce room-table cell padding/font sizes on narrow screens. | **Now** |
| Guest-visible metadata before joining | Public waiting-room summary contains disabled mutators/manual coin flip; confirmation modal renders enabled rules | Public list guests see rule pool after clicking Join; private-code guests do not. | Medium: public list metadata was underused; private-code preview unavailable. | Show compact public list settings now; document future private-code metadata preview. | **Now for public list; later for private-code preview** |

## Safe frontend/backend-compatible fixes included

1. Room code normalization:
   - Direct-code joins normalize the typed code to uppercase before emitting `joinRoom`.
   - Public-list joins and active-game watch actions normalize the row code before emitting.
   - `joinRoom` and `spectateRoom` handlers also trim/uppercase string codes before lookup as a tiny backward-compatible safety net.
2. Public room metadata visibility:
   - Open rooms now show a compact `Settings` column with enabled rule count and automatic/manual coin flip mode.
3. Join confirmation clarity:
   - Public-list join confirmation title now includes the target room code.
4. Name-required feedback:
   - Clicking a public room Join button without a name now displays an inline error instead of doing nothing.
5. Mobile/narrow layout polish:
   - Room table text/padding is tightened on narrow screens so the new settings metadata remains usable.

## Usability/reliability risks found

- Lowercase/mixed-case room codes could fail before normalization reached the server lookup path.
- Public room settings were available in payloads but not scan-visible in the open-room list.
- Public-list Join with no name silently no-oped.
- Direct private-code joins still cannot preview room metadata without a new safe metadata surface.
- Join errors are string-only and cannot currently distinguish typo, canceled, expired, full, active-but-not-spectatable, or backend validation categories in a structured frontend way.
- Full/active room fallback to spectating is useful but not explicitly explained before direct-code join.
- “Host canceled waiting room” and “room expired/not found” collapse into the same `Room not found.` copy.

## Manual QA checklist

Manual browser validation should cover these scenarios before release:

- [ ] Join a public waiting room from the open-room list.
- [ ] Join a private waiting room by code.
- [ ] Join with lowercase and mixed-case room codes; verify the typed code normalizes and succeeds.
- [ ] Join with an invalid room code; verify inline error copy and enabled controls.
- [ ] Attempt to join a full room; verify either clear rejection or supported spectate fallback.
- [ ] Try joining your own waiting room from the same browser identity; verify clear rejection.
- [ ] Try joining while already in a room; verify clear rejection and no state corruption.
- [ ] Join after the host cancels/leaves the waiting room; verify recovery to landing and `Room not found.` behavior for stale codes.
- [ ] Refresh/reconnect before game start; verify waiting room resumes deterministically.
- [ ] Refresh/reconnect during an active game; verify board, turn, prompts, and clock resume.
- [ ] Spectate an active public room via Watch and, if supported by code, direct active-room code fallback.
- [ ] Use mobile portrait width for direct-code join, open-room list join, join confirmation modal, and error recovery.

## Future implementation plan

1. Add a safe room-preview surface for private-code joins, returning only guest-visible metadata already used publicly: room existence/joinability, creator display name, open color, disabled mutator IDs/count, manual coin flip mode, and whether active spectate is supported.
2. Standardize join/spectate error objects in a backward-compatible way, preserving current string support while allowing typed client copy such as `not_found`, `full`, `already_in_room`, `own_room`, and `active_spectate_available`.
3. Add explicit copy for join-to-active spectate fallback: “That game has already started, so you are watching instead.”
4. Add recovery affordance for valid saved sessions: “Return to your room” instead of asking the user to join their own room again.
5. Add focused browser/e2e tests or static UI checks for direct-code normalization, missing-name errors, modal metadata, and resume recovery.

## Contract confirmation

Confirmed for this PR:

- No gameplay rule changes.
- No mutator behavior changes.
- No move legality changes.
- No room lifecycle internal changes.
- No turn-clock lifecycle changes.
- No bot behavior changes.
- No balance changes.
- No Socket.IO event name changes.
- No existing Socket.IO payload shape changes.
