# Scoreboard Persistence Audit (Phase F)

## Purpose and scope

This Phase F audit documents the current scoreboard and persistence behavior, identifies risks, and defines an **alpha-minimum persistence contract**.

This PR is documentation-first and safety-first. It does **not** change gameplay rules, mutator semantics, move legality, room lifecycle internals, turn-clock lifecycle, bot behavior, Socket.IO event names, payload shapes, or balance.

## Files inspected

### Prior planning / flow audits
- `docs/GAME_COMPLETION_ROADMAP.md`
- `docs/STREAM_MODE_AUDIT.md`
- `docs/SPECTATOR_MODE_AUDIT.md`
- `docs/REMATCH_FLOW_AUDIT.md`
- `docs/HUMAN_VS_HUMAN_FLOW_AUDIT.md`
- `docs/HUMAN_VS_BOT_FLOW_AUDIT.md`
- `docs/ROOM_CREATION_AUDIT.md`
- `docs/JOIN_FLOW_AUDIT.md`
- `docs/BALANCE_TUNING_AUDIT.md`

### Frontend scoreboard/storage surfaces
- `public/index.html`
- `public/styles.css`
- `public/js/main.js`
- `public/js/events.js`
- `public/js/socketHandlers.js`
- `public/js/state.js`
- `public/js/storage.js`
- `public/js/ui.js`

### Backend scoreboard/persistence/identity/validation surfaces
- `server.js`
- `gameManager.js`
- `handlers/playerHandlers.js`
- `handlers/joinHandler.js`
- `handlers/moveHandler.js`
- `routes/apiRoutes.js`
- `utils/scoreboard.js`
- `utils/playerIdentity.js`
- `utils/validation.js`
- `utils/gameLifecycle.js`
- `utils/motd.js` (data persistence pattern comparison)

## Files changed

- `docs/SCOREBOARD_PERSISTENCE_AUDIT.md`
  - Added this focused inventory, risk analysis, alpha contract, QA checklist, and future implementation plan.
- `utils/scoreboard.js`
  - Added defensive normalization for malformed persisted scoreboard data at load-time and entry-level sanitization when reading top players.

## Scoreboard/persistence inventory

| Surface | Current code path | Current behavior | Risk | Recommended treatment | Timing |
| --- | --- | --- | --- | --- | --- |
| Scoreboard data file location | `utils/scoreboard.js` (`data/scoreboard.json`) | Local JSON file in repo-adjacent `data/` directory; loaded at startup. | Ephemeral/containerized deployments may lose local disk data. | Keep for alpha/local; document as non-durable in some hosting modes. Plan external durable store later. | Later (deployment readiness) |
| In-memory source of truth | `utils/scoreboard.js` (`scores` object) | Runtime updates go to memory first, then debounced disk write. | Crash between update and flush can lose recent writes. | Keep debounce; ensure flush on shutdown (already present). Consider periodic forced flush later if needed. | Later |
| Write/update path | `utils/gameLifecycle.js` -> `recordWin/recordLoss/recordDraw` | Updates only on game end; excludes quiet resign, bot games, and custom settings. | Eligibility logic can drift if not explicitly documented. | Lock this alpha contract in docs and QA matrix. | Now (documented) |
| Read/API path | `routes/apiRoutes.js` `/api/scoreboard` -> `getTop(25)` | Frontend fetches leaderboard via REST and receives realtime `scoreboardUpdate` events. | None critical; straightforward and stable. | Keep as-is. | Not needed |
| Display path | `public/js/ui.js` `_diffScoreboard` + `public/index.html` panel | Renders rank, name, W/L/D, score; empty-state fallback shown if no rows. | Name collisions are not disambiguated (by design for alpha). | Accept for alpha; defer profile/identity UI. | Later |
| Eligibility: custom settings | `utils/gameLifecycle.js` (`disabledMutators`, `manualCoinFlip`) + copy in `public/js/events.js`, `public/js/ui.js` | Any disabled mutators or manual coin flip excludes leaderboard updates. | If copy drifts from backend logic, user trust risk. | Keep backend authority; keep copy aligned in audits/checklists. | Ongoing |
| Eligibility: bot games | `utils/gameLifecycle.js` | Bot games excluded (`isBot` checks). | Low; behavior explicit in code. | Keep for alpha contract. | Now |
| Eligibility: private/public rooms | `utils/gameLifecycle.js` | No direct private/public exclusion; default full-rule human games can count regardless of room privacy. | Product expectation ambiguity if private games are assumed non-ranked. | Explicitly define that privacy alone does not exclude ranking in alpha. | Now (documented) |
| Result mapping/end reasons | `utils/gameLifecycle.js` | Winner => +1/-1, draw => +1/+1, floor score at 0; timeout treated as normal resign outcome. | Score incentives may be debated but are existing rule. | Keep unchanged; defer scoring design debates outside persistence audit. | Not now |
| Player identity hash | `utils/playerIdentity.js`, client `browserId` in `public/js/state.js` and emit paths | Hash prefers client browserId (stable per localStorage), fallback to hashed IP; scoreboard keyed by hash, stores latest display name. | Shared browsers share identity; IP fallback can merge users behind NAT/VPN. | Accept alpha simplicity; document limitations; plan stronger account identity later. | Later |
| Name validation/display | `handlers/joinHandler.js`, `utils/validation.js`, `public/js/ui.js` | Server validates non-empty/length/chars/profanity; scoreboard stores and displays validated name; latest name overwrites entry name. | Name change history not retained; impersonation optics possible with same visible name. | Keep server validation authority; defer richer identity/profile features. | Later |
| Reset/admin tooling | No dedicated admin route/tool found | No explicit runtime admin reset endpoint in inspected code. | Manual file edits/deletes required for reset; operational foot-gun risk. | For alpha, document manual reset procedure and backups; later add authenticated admin tooling. | Later |
| Startup/restart behavior | `utils/scoreboard.js` load/flush + `server.js` flush hooks | Loads once at startup; debounced writes flushed on shutdown signals. | Abrupt kill can lose recent debounced writes. | Keep alpha behavior; mention caveat in deployment readiness. | Later |
| Malformed/missing data behavior | `utils/scoreboard.js` load + this PR sanitization | Missing file => empty scoreboard. Parse failure => empty scoreboard. Malformed entries now skipped/sanitized instead of leaking bad values into API. | Previously malformed but parseable data could display invalid fields. | Keep new defensive sanitization for resilience. | Done now |
| Optional/future stats systems | No profile/season/replay subsystems in inspected paths | Current model is lightweight aggregate scoreboard only. | Scope creep risk if expanded prematurely. | Defer broad profile/stats systems to dedicated PRs. | Later |

## Alpha-minimum persistence contract

For alpha, the persistence contract is:

1. **What counts toward scoreboard**
   - Completed human-vs-human games with default/full ruleset settings.
   - Winner/loser mapping applies for decisive results.
   - Draw mapping applies for draw outcomes.

2. **What does not count**
   - Bot games.
   - Quiet resign outcomes.
   - Custom-settings games (any disabled mutator and/or manual coin flip enabled).

3. **Identity used**
   - Primary: hash of client `browserId` token.
   - Fallback: hash of client IP-derived value.
   - Leaderboard stores only hashed identifier key and latest validated display name.

4. **Data that must persist across restart**
   - Scoreboard aggregate entry fields per player hash: `name`, `score`, `wins`, `losses`, `draws`, `lastPlayed`.
   - Top leaderboard API must be reconstructable from persisted file after restart.

5. **Reset/admin behavior required for alpha**
   - Manual operational reset is acceptable: stop server, back up `data/scoreboard.json`, then remove/replace file.
   - No unauthenticated in-app reset endpoint should be added in this phase.

6. **Malformed/missing persistence behavior**
   - Missing file: initialize empty scoreboard without crashing.
   - Invalid JSON parse: log warning and initialize empty scoreboard.
   - Parseable but malformed structure/entries: ignore invalid records and serve only sane, numeric/non-negative entries.

## Reliability / security / product risks found

1. **Durability risk in ephemeral environments**
   - JSON file persistence depends on writable durable disk.
   - Container/redeploy strategies may wipe local state.

2. **Identity-collision and portability limitations**
   - Browser-local identity can merge users on shared devices.
   - IP fallback can merge users behind shared NAT or rotate unexpectedly.

3. **Operational reset ergonomics**
   - No admin reset endpoint/tooling in repo; manual file operations required.

4. **Crash-window write loss**
   - Debounced writes can lose a short tail of updates on abrupt process termination.

5. **Name overwrite semantics**
   - Score entry name always updates to latest validated name for that identity hash.
   - Good for current display freshness, but no historical name trace.

## Safe fixes added in this PR

### Defensive malformed-data sanitization (`utils/scoreboard.js`)

- Added load-time structure normalization:
  - Non-object top-level JSON now safely falls back to empty map.
- Added entry-level normalization:
  - Invalid/missing names and non-finite numeric stats are sanitized.
  - Negative numeric values are clamped to zero.
  - Invalid entries are dropped from `getTop` response.

This is a narrow reliability fix only; it does not alter scoring rules, eligibility rules, or socket/API contracts.

## Future implementation plan (deployment-readiness follow-up PR)

1. **Durable persistence backend**
   - Move scoreboard storage from local JSON file to durable datastore (e.g., managed DB or durable volume abstraction).

2. **Operational tooling**
   - Add authenticated admin-only reset/export/import tools and explicit backup/restore runbook.

3. **Data integrity hardening**
   - Add optional checksum/versioning/migration for persisted scoreboard schema.

4. **Identity evolution**
   - Consider account-backed identity or signed opaque identity tokens to reduce collisions/impersonation optics.

5. **Observability**
   - Add metrics/log counters for load failures, sanitize drops, save failures, and flush timing.

## Manual QA checklist (Phase F)

- [ ] Complete a **default human-vs-human** game and verify leaderboard updates.
- [ ] Complete a **custom-settings** game and verify leaderboard exclusion.
- [ ] Complete a **human-vs-bot** game and verify leaderboard exclusion.
- [ ] Refresh landing page and verify scoreboard reloads from `/api/scoreboard`.
- [ ] Restart server and verify scoreboard persistence behavior (if storage volume persists).
- [ ] Corrupt `data/scoreboard.json` with invalid JSON and verify safe empty fallback.
- [ ] Use malformed but parseable JSON entries and verify invalid records are ignored/sanitized.
- [ ] Create duplicate/same-name players and verify list behavior remains stable.
- [ ] Try invalid/profane names and verify server rejects joins.
- [ ] Validate admin/reset behavior expectations (manual file reset only, unless new tooling later).
- [ ] Check scoreboard panel on mobile/narrow viewport.

## Contract safety confirmation

This Phase F audit PR does not intentionally change:

- Gameplay rules
- Mutator behavior/semantics
- Move legality
- Room lifecycle internals
- Turn-clock lifecycle
- Bot behavior
- Socket.IO event names
- Socket.IO payload shapes
- Balance/scoring formulas

Only documentation plus narrow scoreboard persistence hardening for malformed persisted data were added.
