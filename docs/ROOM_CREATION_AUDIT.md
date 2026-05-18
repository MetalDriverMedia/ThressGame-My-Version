# Room Creation Audit (Phase E)

## Scope

This is a narrow, frontend-first audit of the Thress room creation flow.

Goals:
- Make it clear how to create a room and which settings will be used.
- Make player name, human/bot setup, mutator settings, manual coin flip, room code sharing, and pre-start metadata understandable.
- Improve only safe copy/display/layout issues.

Non-goals:
- No gameplay rule changes.
- No mutator semantic changes.
- No move-legality changes.
- No room lifecycle internal changes.
- No turn-clock lifecycle changes.
- No bot-behavior changes.
- No Socket.IO event name changes.
- No Socket.IO payload shape changes.

## Files inspected

- `docs/GAME_COMPLETION_ROADMAP.md`
- `docs/MOBILE_RESPONSIVE_UX_AUDIT.md`
- `docs/PLAYER_PROMPTS_AUDIT.md`
- `docs/PRESET_RULE_MODES.md`
- `docs/BALANCE_TUNING_AUDIT.md`
- `docs/RULE_SEMANTICS_AUDIT.md`
- `public/js/main.js`
- `public/js/socketHandlers.js`
- `public/js/state.js`
- `public/js/ui.js`
- `public/js/mutatorUI.js`
- `public/js/events.js`
- `public/index.html`
- `public/styles.css`
- `handlers/joinHandler.js`
- `gameManager.js`
- `server.js`

## Current room creation flow summary

1. The landing panel asks for a player name and offers `Create Room`, `Join Room`, and `Play vs Bot` actions.
2. `Create Room` expands inline options for preferred color, private room, mutator settings, and manual coin flip.
3. Submitting emits the existing `createRoom` event with the existing fields: `name`, `browserId`, `preferredColor`, `isPrivate`, `disabledMutators`, and `manualCoinFlip`.
4. The backend creates a waiting room, stores mutator settings on the room, assigns the requested/random color, and emits `joinSuccess`.
5. The frontend stores the token/name, switches to the waiting panel, hides the room code by default, and lets the host reveal/copy the code.
6. When another human joins, `joinRoom` emits `joinSuccess` to the guest, `startGame` emits `gameStarted`, and both clients move into the game panel. Bot games use `joinBot` and start immediately.

## Room creation surface inventory

| Surface | Current source/code path | Current frontend behavior | Current usability risk | Recommended UX treatment | Timing |
|---|---|---|---|---|---|
| Player name entry | `public/index.html` `#name-input`; `public/js/events.js` `getPlayerName`; `handlers/joinHandler.js` `validateName` | Name is required client-side by action handler and validated server-side for length, characters, and profanity. | Low: errors display in shared join/create feedback area, but action context is not distinguished. | Keep shared validation, but clear errors on new attempts in a future polish pass if repeated attempts feel stale. | Later |
| Create room entry point | `#create-room-btn`; `bindLandingEvents`; `createRoom` wiring in `server.js` | Button toggles inline setup options. | Medium: before this audit, options appeared without a short explanation of what they control. | Add a compact “Room setup” intro that says these are pre-game room options. | **Now** |
| Preferred color | `#color-select`; `assignColor` in `gameController.js`; `handleCreateRoom` | Host chooses Random/White/Black; backend assigns if available. | Low: clear enough, but no waiting-room reminder of assigned color. | Show “You are White/Black” in waiting-room metadata. | **Now** |
| Private room | `#private-check`; `handleCreateRoom`; `GameRoom.isPrivate`; `getPublicWaitingRooms` | Private room is omitted from public open-room list. | Medium: “Private Room” does not explain that the room code still works for invited players. | Future copy: add a one-line helper under the checkbox. No backend change needed. | Later |
| Human setup / open room | `handleCreateRoom`; `getPublicWaitingRooms`; `renderRoomsList` | Public waiting rooms show room, host, open color, and join button. | Low-medium: open rooms include settings in join confirmation, but the host waiting room previously lacked settings summary. | Show waiting-room metadata to the host before start. | **Now** |
| Bot setup option | `#play-bot-btn`; `joinBot`; `handleJoinBot` | Bot game starts immediately using current `disabledMutators` and `manualCoinFlip` client state. | Medium: the bot button is separate from create options, while those hidden options can still affect bot games if changed. | Added helper copy in mutator settings noting settings apply to created rooms and Play vs Bot. A future pass could expose an explicit bot setup drawer. | **Now / Later** |
| Mutator settings panel | `#mutator-settings-toggle`; `initMutatorSettings`; `/api/rules`; `disabledMutators` in room | Collapsible list of categories/rules with Enable All and per-rule toggles. Summary shows all enabled or enabled count. | Medium: powerful but dense, especially on narrow screens. | Keep current controls; add helper copy and waiting-room settings summary. Future preset modes should reduce complexity. | **Now / Later** |
| Manual coin flip | `#manual-coin-flip`; `manualCoinFlip` room field; coin-flip handlers | Optional honor-system manual choice sent in existing room creation payload. | Medium-low: label says honor system, but waiting room did not restate whether it is on/off. | Include coin-flip mode in waiting-room metadata. | **Now** |
| Room code display | Waiting panel `#room-code-text`, `#room-code-toggle`, `#room-code-copy`; `showWaiting`; `bindWaitingEvents` | Code is masked by default, can be shown/hidden, and clicking the code button copies it. | Medium: users may not know settings are locked in; copy fallback did not always show feedback. | Preserve masked code; add metadata before start; improve copy fallback feedback. | **Now** |
| Copy/share controls | `copyToClipboard` in `public/js/events.js` | Uses `navigator.clipboard`, then hidden textarea fallback. | Medium on older/insecure browser contexts because fallback could succeed without visible feedback. | Show success feedback for fallback copy and a short instruction if copy cannot be confirmed. | **Now** |
| Start/ready flow visibility | `handleJoinRoom`; `startGame`; `showWaiting` | There is no ready button; game starts automatically once a second player joins. | Medium: waiting text previously said only to share code, not that start is automatic. | Update waiting copy to say game starts automatically when another player joins. | **Now** |
| Failed room creation | `joinError`; `onJoinError`; `showJoinError`; `setButtonsLoading(false)` | Backend errors re-enable buttons and render in the shared feedback line. | Low-medium: functional, but not create-specific. | Keep for now to avoid contract changes. Future copy could prefix context such as “Could not create room.” | Later |
| Open room metadata for guests | `getPublicWaitingRooms`; `renderRoomsList`; `showJoinConfirm` | Guests see a join confirmation modal with enabled rules and manual coin flip flags. | Low: this is one of the strongest existing room-metadata surfaces. | Keep as-is. Consider adding preset labels later. | Not now |
| Mobile/narrow create flow | `public/styles.css` responsive rules | Create controls stack on small screens; mutator panel scrolls. | Medium: waiting metadata and room code need to remain readable on portrait widths. | Add responsive stacking for waiting metadata and preserve full-width create submit behavior. | **Now** |
| Refresh/reconnect before start | `resumeSession`; `handleResume`; `onResumeSuccess`; `showWaiting` | Host can resume a waiting room and return to waiting panel. Existing resume payload does not include disabled mutator count/manual coin flip. | Medium: room code recovers, but full pre-start settings summary may be incomplete after a hard refresh. | Document as future backend-safe metadata exposure candidate. Do not change payload shape in this PR. | Later |

## Safe frontend changes included

1. Added a compact “Room setup” explanation above the create-room controls.
2. Added mutator-settings helper copy clarifying that the selected rule settings apply to created rooms and Play vs Bot, and that guests see the rule pool before joining.
3. Added waiting-room metadata cards showing:
   - assigned player color,
   - which color the host is waiting for,
   - current rule-pool summary,
   - automatic/manual coin-flip mode when available from the existing `joinSuccess` payload.
4. Updated waiting-room text to clarify that the game starts automatically when another player joins.
5. Improved room-code copy fallback feedback for browsers where `navigator.clipboard` is unavailable or denied.
6. Added responsive CSS so waiting-room metadata stacks cleanly on mobile portrait widths.

## Usability risks found

- The create-room options were mechanically present but did not explain that they define the room before play starts.
- The host waiting room showed the room code but not enough metadata about color/rule settings before start.
- The start flow is automatic, but the waiting text did not explicitly say that another player joining starts the game.
- Bot setup shares mutator/manual-coin settings with room creation state, but the bot action is visually separate from the create-room drawer.
- Refresh/reconnect before start preserves the waiting room but does not currently restore all room-settings metadata because the existing resume payload does not expose it.
- Mutator-by-mutator setup remains dense for first-time players and would benefit from preset modes.

## Future preset-selection integration notes

`docs/PRESET_RULE_MODES.md` recommends future preset modes such as Classic / No Mutators, Beginner / Light Chaos, Standard Thress, Full Chaos, and Stream Mode. Preset selection should fit into room creation as a higher-level control above the existing detailed mutator list.

Recommended future flow:
1. Add a `mutatorPreset` selector in the create-room setup UI.
2. Let the selector update the existing detailed rule toggles as a preview/edit surface.
3. Preserve the current `disabledMutators` and `manualCoinFlip` fields while introducing `mutatorPreset` only as additive metadata once the backend resolver exists.
4. Show the preset label in open-room rows, join confirmation, waiting-room metadata, and reconnect state.
5. Do not make presets silently change rule semantics; they should resolve only to explicit mutator inclusion/exclusion and coin-flip defaults.

This PR does **not** implement preset resolution because no shipped preset contract exists yet and changing room creation payloads is out of scope.

## Manual QA checklist

Run these in a browser against a local or deployed server:

- [ ] Create room with default settings.
  - Expected: create drawer explains room setup; waiting room shows assigned color, open color, all mutators enabled, automatic coin flips, masked code, and automatic-start copy.
- [ ] Create room with manual coin flip off.
  - Expected: waiting metadata says coin flips are automatic.
- [ ] Create room with manual coin flip on.
  - Expected: leaderboard notice appears before create; waiting metadata says manual honor-system choice.
- [ ] Create room with mutators enabled.
  - Expected: summary says all mutators enabled when none are disabled.
- [ ] Create room with one or more mutators disabled.
  - Expected: create summary and waiting metadata show an enabled-count/custom rule pool.
- [ ] Play vs Bot after changing mutator/manual settings.
  - Expected: bot game starts immediately and helper copy accurately indicates those settings also apply to bot play.
- [ ] Copy/share room code.
  - Expected: clicking the code copies it and displays feedback; Show/Hide still toggles the visible code.
- [ ] Start game from waiting room.
  - Expected: second human joining starts the game automatically without any ready-button expectation.
- [ ] Room creation error path.
  - Expected: invalid names or already-in-room attempts re-enable buttons and show the existing error message.
- [ ] Mobile portrait room creation.
  - Expected: create options stack, mutator settings remain scrollable, room-code and metadata cards fit without horizontal scrolling.
- [ ] Refresh/reconnect after room creation before start.
  - Expected: host returns to waiting room with room code. Note: detailed rule/coin metadata may be limited until resume payload safely exposes those fields in a future PR.

## Validation plan

Automated checks to run:

- `npm run check`
- `node --test`
- `npm test`

Focused frontend/static check available in this repo:

- `npm run check` includes `node --check public/js/*.js`, so changed frontend modules are syntax-checked.

## Contract confirmation

Confirmed for this audit PR:

- No Socket.IO event names were renamed.
- No existing Socket.IO payload field names or payload shapes were changed.
- No backend gameplay code was changed.
- No mutator behavior or semantics were changed.
- No move-legality code was changed.
- No room lifecycle internals were changed.
- No turn-clock lifecycle code was changed.
- No bot behavior was changed.
