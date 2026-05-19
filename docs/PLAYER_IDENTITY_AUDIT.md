# Player Identity / Hash Audit (Phase F3)

## Scope

This Phase F3 audit documents the current alpha identity behavior used by scoreboard persistence. It is documentation-first and safety-first.

This phase does **not** add accounts/profiles/login/auth, and does **not** change gameplay, mutator behavior, move legality, room lifecycle internals, bot behavior, or Socket.IO contracts.

## Files inspected

- `docs/GAME_COMPLETION_ROADMAP.md`
- `docs/SCOREBOARD_PERSISTENCE_AUDIT.md`
- `utils/playerIdentity.js`
- `utils/scoreboard.js`
- `utils/validation.js`
- `utils/gameLifecycle.js`
- `handlers/joinHandler.js`
- `handlers/playerHandlers.js`
- `handlers/spectatorHandler.js`
- `public/js/state.js`
- `public/js/storage.js`
- `public/js/events.js`
- `public/js/socketHandlers.js`
- `public/js/ui.js`
- `routes/apiRoutes.js`
- `server.js`
- `scripts/scoreboard-admin.js`
- `test/scoreboard.admin.test.js`
- `test/gameLifecycle.room.test.js`

## Identity surface inventory

### 1) browserId creation and storage

- Client creates/stores a stable browser-local identifier using `localStorage` key `chess.browserId` in `getOrCreateBrowserId()`.
- Preferred generation path is `crypto.randomUUID()`, with local fallback random string if unavailable.
- If storage is unavailable, client falls back to a non-persistent session id.

### 2) browserId transmission paths

Client includes `browserId` in all player-join/start flows:

- `createRoom` emit includes `browserId`.
- `joinRoom` emit includes `browserId`.
- `joinBot` emit includes `browserId`.
- resume flow uses `token` only and does not use `browserId` (by design).

### 3) fallback identity when browserId is absent/invalid

Server hash generation (`generatePlayerHash`) behavior:

- If `browserId` is a string with length `>= 8`, hash that value.
- Otherwise fallback to normalized client network identity:
  - `x-forwarded-for` first IP if present, else `socket.handshake.address`, else `'unknown'`.
  - lowercased, trimmed, and IPv4-mapped IPv6 prefix removed (`::ffff:`).
  - hash normalized value.

### 4) playerHash generation and storage model

- Hash function: SHA-256, truncated to first 16 hex chars.
- Raw `browserId` and raw IP are not stored in scoreboard state.
- Scoreboard map keys are opaque hash ids.
- `getTop()` API strips hash entirely and exposes only display stats.
- CLI export includes hash, name, and stats (still opaque hash; no raw identity values).

### 5) name validation and overwrite behavior

- Server-side name validation is authoritative (`joinHandler.validateName` + `utils/validation.js`):
  - non-empty, max 20 chars, alphanumeric + space only, profanity-filtered.
- Scoreboard entry name is overwritten with latest validated name for the same identity hash.

### 6) identity behavior matrix

- Same browserId + same/different names => same scoreboard identity hash, latest validated name displayed.
- Different browserIds + same name => separate scoreboard identities (name collision possible in UI).
- Different name + same browserId => same identity, name updates on next scored game event.
- Same browser trying to join both seats in one room is blocked by same-hash self-join check.

### 7) private/public room implications

- Room privacy does not itself affect identity hashing.
- Private rooms can still count toward scoreboard if they are human-vs-human and default ruleset eligibility conditions are met.

### 8) bot-game implications

- Bot games still create a player hash for the human participant.
- Scoreboard updates are skipped for bot games (`emitGameEnded` guard), so bot matches do not affect persisted stats.

### 9) spectator implications

- Spectators do not create player entries and do not participate in scoreboard identity.
- Spectate flows are roomCode-based and independent of identity hash.

### 10) resume token vs scoreboard identity

- Resume uses per-player room token mapping for reconnect/session continuity.
- Scoreboard identity uses `playerHash` derived from browserId/IP input.
- Token and playerHash are separate concepts and must not be conflated.

### 11) export/reset tooling exposure

- `scoreboard-admin export` exposes only stored hashed key + stats (no raw browserId/IP).
- `scoreboard-admin reset` clears scoreboard data (optionally backing up current hashed stats payload).

## Alpha identity contract (locked for Phase F)

1. **Preferred stable identity input** is client `browserId`.
2. **Raw browserId must not be stored server-side in scoreboard data**.
3. **IP-derived identity is fallback-only** when browserId is absent/invalid.
4. **Scoreboard persistence stores opaque hash keys + latest validated display name + aggregate stats**.
5. **Resume token is not scoreboard identity**; it is only for reconnecting a live room session.
6. **No account/profile/login/auth system exists in alpha**.

## Known alpha limitations

- Shared device/browser profile shares identity.
- IP fallback can merge users behind NAT/proxies or split users when IP changes.
- Display-name collisions are possible because names are not unique account identifiers.
- No historical name log per identity (latest validated name wins).

## Manual QA checklist (documented)

- [ ] Start a default game from one browser; confirm scoreboard identity behavior matches hash-based aggregation.
- [ ] Use same browser with a different display name; confirm latest-name overwrite behavior.
- [ ] Use different browser/profile with same display name; confirm separate identity behavior.
- [ ] Start Play vs Bot; confirm scoreboard exclusion.
- [ ] Export scoreboard; confirm no raw browserId/IP is present.
- [ ] Reset scoreboard; confirm behavior remains consistent with this contract.
- [ ] Refresh/resume active game; confirm resume token behavior remains separate from scoreboard identity.

## Safe cleanup in this phase

- Added focused unit tests for `generatePlayerHash` covering browserId preference, stability, fallback behavior, and non-exposure characteristics.
- No hash algorithm change.
- No scoreboard schema/migration change.
- No gameplay/socket contract change.
