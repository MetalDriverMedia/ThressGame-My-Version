# Deployment Readiness Audit (Phase G1)

## Scope and intent

## Phase G3 follow-up

Phase G3 finalizes operator-facing startup/deployment documentation in:
- `docs/DEPLOYMENT_RUNBOOK_ALPHA.md`

This preserves the Phase G1/G2 alpha deployment contract while consolidating day-2 run procedures and troubleshooting into a single runbook.

This Phase G1 audit is **documentation-first** and **safety-first**. It defines the current deployment contract for alpha without broad infrastructure changes.

This document does **not** introduce Docker, hosted database setup, CI/CD, reverse proxy config lock-in, gameplay changes, mutator changes, move legality changes, room lifecycle contract changes, turn-clock changes, bot behavior changes, or Socket.IO contract changes.

## Files inspected

- `docs/GAME_COMPLETION_ROADMAP.md`
- `docs/SCOREBOARD_PERSISTENCE_AUDIT.md`
- `docs/PLAYER_IDENTITY_AUDIT.md`
- `README.md`
- `package.json`
- `package-lock.json`
- `server.js`
- `routes/apiRoutes.js`
- `gameManager.js`
- `utils/scoreboard.js`
- `utils/motd.js`
- `utils/debugLogger.js`
- `utils/gameLifecycle.js`
- `utils/config.js`
- `public/index.html`
- `public/js/main.js`
- `public/js/state.js`
- `public/js/socketHandlers.js`
- `public/js/events.js`
- `public/styles.css`
- `scripts/scoreboard-admin.js`
- `test/` suite (startup/behavior confidence coverage and operational tests)

## Deployment surface inventory

| Surface | Current code path | Current behavior | Alpha risk | Recommended treatment | Timing |
| --- | --- | --- | --- | --- | --- |
| Install command | `README.md`, `package.json` | Works with `npm install`; lockfile exists and is compatible with `npm ci` for reproducible install. | Non-reproducible installs if operators default to `npm install`. | Prefer `npm ci` in deployment contract. | Now (document) |
| Start command | `package.json` (`npm start`) | `npm start` runs `node server.js`. | Low. | Keep as contract default. | Not needed |
| Test/check commands | `package.json` scripts | `npm run check`, `node --test`/`npm test`, `npm run lint` (`lint` aliases `check`). | Low; redundant names can confuse operators. | Document exact sequence for pre-deploy checks. | Now |
| Node version | `README.md` | States Node.js 18+. | Low. | Keep; require Node 18+ in alpha contract. | Now |
| Runtime env vars | `server.js`, `utils/config.js`, `utils/scoreboard.js`, `utils/debugLogger.js` | Supports `PORT`, `BASE_PATH`, `SCOREBOARD_PATH`, `DEBUG_LOG`, `DEBUG_LOG_VERBOSE`, `DEBUG_LOG_FILE`. | Incomplete public documentation can cause misconfig. | Document all supported env vars and defaults. | Now |
| PORT behavior | `server.js` | Binds to `process.env.PORT || 3000`. | Low. | Keep and document. | Now |
| Base path behavior | `utils/config.js`, `server.js`, `public/js/state.js` | BASE_PATH normalized; cPanel/subfolder rewrite strips prefix; `/config.js` injects client base/socket paths. | Misconfigured proxy/path rewrites can break asset/API/socket URLs. | Document required reverse proxy forwarding behavior. | Now |
| Socket.IO path behavior | `utils/config.js`, `server.js`, `public/js/main.js`, `public/js/state.js` | Socket path derived from `BASE_PATH` (`<base>/socket.io`) and injected to client. | Breakage behind hosted proxies if websocket/polling path not forwarded. | Document websocket + long-polling forwarding requirement. | Now |
| Static asset serving | `server.js`, `public/` | Express static serves `public/`; index served by custom handler. | Low. | Keep. | Not needed |
| Cache/version stamping | `server.js`, `public/index.html`, `package.json` | Server stamps `main.js` + `styles.css` query version from `package.json` and sets `Cache-Control: no-store` on index. | If process not restarted after deploy, old server process keeps old version. | Document restart requirement after deploy/update. | Now |
| Scoreboard persistence location | `utils/scoreboard.js` | Persists to `data/scoreboard.json` by default, overridable by `SCOREBOARD_PATH`. | Data loss in ephemeral filesystems. | Document durable volume expectation and fallback risk. | Now |
| Scoreboard backup/export/reset ops | `scripts/scoreboard-admin.js`, `utils/scoreboard.js` | CLI supports `export` and `reset` with default backup in `data/backups/`. | Operator misuse if run while process active without understanding effects. | Add runbook notes and recommend stopping app before reset. | Now |
| MOTD persistence | `utils/motd.js` | Reads `data/motd.txt` if present; missing file returns empty string safely. | None critical. | Keep; document optional file behavior. | Now |
| Debug/log behavior | `utils/debugLogger.js`, `server.js` | Default: minimal logs to stdout. Optional debug structured logs; optional debug log file append. | Disk growth risk if debug file enabled without rotation. | Document debug-only usage and log rotation ownership. | Now |
| Graceful shutdown | `server.js`, `utils/scoreboard.js` | Flushes pending scoreboard saves on `beforeExit`, `SIGINT`, `SIGTERM`. | Abrupt kill/crash still risks small write loss window. | Keep; document residual risk and safe restart sequence. | Now |
| Health check | `routes/apiRoutes.js` | `GET /api/health` returns `{ status: 'ok' }`. | Minimal health semantics only (no dependency checks). | Accept for alpha; expand later if needed. | Later |
| Local development startup | `package.json` (`npm run dev`) | `node --watch server.js` autoreload loop. | Low. | Keep and document. | Now |
| Production startup expectations | `package.json`, `server.js` | Single Node process, local FS persistence expectations, no clustering/state sharing. | Multi-instance scale-out will break in-memory room consistency. | Document **single-instance alpha** contract. | Now |
| Reverse proxy/hosted env | `BASE_PATH` + socket path design | App can run at root or subpath; requires websocket/polling pass-through. | Proxy misconfig commonly breaks socket upgrades or pathing. | Document proxy checklist (headers, websocket, sticky single instance preferred). | Now |
| Restart behavior + room loss | `gameManager.js` (in-memory rooms) | Rooms/tokens/spectators live in memory only. Restart clears all active/waiting rooms. | High UX risk if not communicated. | Explicitly document as expected alpha behavior. | Now |
| Browser refresh/resume after restart | `public/js/main.js`, resume flow handlers | Resume token supports reconnect only while server process still holds token map. | Resume fails after restart; users must create/join again. | Document limitation in operator/player expectations. | Now |
| Security for public deploy | `server.js`, handlers, auth model | No auth/accounts/admin auth. CORS origin true. Public socket events are rate-limited but open. | Exposed public deployment has abuse/spam/operational risks. | Document guardrails and defer hardening to dedicated security PRs. | Now + later |
| npm audit warnings | lockfile/dependency set | Known dependency risk may exist; this phase does not auto-mutate deps. | Unreviewed mass upgrades can break runtime. | Track warnings; defer remediations to dedicated dependency/security PR. | Now |
| Deployment docs gaps | README + audits | Prior docs lacked a single alpha deployment contract page. | Operator ambiguity. | This audit defines contract and checklist. | Done |

## Alpha deployment contract (Phase G1)

### 1) Install

- Clean clone.
- Use **`npm ci`** for reproducible installs.
- Node.js **18+** required.

### 2) Run locally

- `npm run dev` for watch mode.
- `npm start` for production-like local process.
- Default URL: `http://localhost:3000/` when `PORT` unset.

### 3) Run production-like

- Use `npm ci` then `npm start`.
- Set environment variables as needed (`PORT`, `BASE_PATH`, persistence/log options).
- Run as a **single server instance** for alpha.

### 4) Supported environment variables

- `PORT` (default `3000`)
- `BASE_PATH` (default `/`)
- `SCOREBOARD_PATH` (optional absolute/relative path override for scoreboard JSON)
- `DEBUG_LOG` (`true`/`1` enables structured debug log events)
- `DEBUG_LOG_VERBOSE` (`true`/`1` includes fuller payloads)
- `DEBUG_LOG_FILE` (optional file path for debug log append output)

### 5) Persistence contract

Persists across restart (if underlying storage survives):
- Scoreboard aggregate data file (`data/scoreboard.json` by default or `SCOREBOARD_PATH` override).
- Scoreboard backups from admin reset (`data/backups/`).
- Optional MOTD text file (`data/motd.txt`) if operator manages it.

Does **not** persist across server restart:
- Active/waiting room state.
- Live socket connections.
- Reconnect tokens for in-progress sessions.
- In-memory turn timers / pending mutator interaction state.

### 6) Operator expectations before deploying

- Restarting process during active games will terminate in-progress sessions.
- Browser resume will fail after restart by design (users must rejoin/start new room).
- Scoreboard durability depends on filesystem durability; ephemeral platforms may wipe data.
- No accounts/auth/admin panel exists; deployment is community/public-game style, not trusted-admin multi-tenant secure product.
- Keep debug file logging disabled by default unless managed with rotation.

## Reverse proxy / hosted environment considerations (alpha)

If hosting behind a reverse proxy/platform router:

1. Forward both HTTP and websocket traffic.
2. Preserve `BASE_PATH`-compatible routing (e.g., app under `/` or configured subpath).
3. Forward Socket.IO path `<BASE_PATH>/socket.io` for both websocket and polling transports.
4. Prefer single-instance deployment for alpha because room lifecycle is process-memory based.
5. If using rolling restarts, communicate active-game interruption risk.

## npm audit warning policy for this phase

- `npm audit` results (if any) are tracked as **known dependency risk** only.
- This Phase G1 scope explicitly avoids `npm audit fix` and `npm audit fix --force`.
- Dependency upgrades/remediation should be handled in a separate dedicated dependency/security PR with targeted verification.

## Manual QA checklist (deployment-focused)

- [ ] Clean clone
- [ ] `npm ci`
- [ ] `npm run check`
- [ ] `node --test`
- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npm start`
- [ ] Open `http://localhost:3000/`
- [ ] Verify static assets load
- [ ] Verify Socket.IO connects
- [ ] Create room
- [ ] Play vs bot
- [ ] Refresh during active game
- [ ] Restart server and verify/document expected room/session loss
- [ ] Verify scoreboard API works
- [ ] Verify scoreboard export/reset CLI works
- [ ] Verify missing scoreboard file behavior
- [ ] Verify health endpoint (`/api/health`)
- [ ] Verify mobile/narrow viewport still loads

## Risks and blockers found

1. **Single-process volatile room state**: restart causes loss of active sessions and resume context.
2. **Persistence durability risk**: scoreboard durability depends on persistent local disk/volume.
3. **Public deployment security posture is minimal**: no auth/admin boundary; rate limiting is present but basic.
4. **Proxy misconfiguration risk**: BASE_PATH and socket forwarding must be correct in hosted environments.

No blocker was found that requires broad infrastructure changes in this PR.

## Safe fixes in this PR

- Added deployment-readiness audit and alpha contract documentation.
- Added README deployment section clarifying reproducible install, validation commands, env vars, and operational constraints.

No gameplay, mutator, scoring, room lifecycle internals, turn clock, bot logic, or Socket.IO payload/event contract changes were made.

## Future deployment-readiness plan (post-G1)

1. Dedicated dependency/security PR for audit warning triage and targeted upgrades.
2. Optional health endpoint expansion (`readiness`/`liveness` split, dependency checks).
3. Durable persistence strategy for scoreboard and optional session metadata.
4. Controlled restart/maintenance messaging strategy for active players.
5. Optional structured production logging/metrics rollout with rotation/retention policy.
