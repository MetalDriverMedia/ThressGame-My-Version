# Thress Alpha Deployment Runbook (Phase G3)

## Scope

This runbook finalizes alpha startup/deployment operator guidance after Phase G1 and G2.

Out of scope for this document and phase:
- Docker / Kubernetes / CI/CD pipelines
- Database hosting migrations
- Auth/accounts/admin control planes
- Gameplay, mutator, room lifecycle, turn-clock, or socket contract changes

## 1) Clean clone and install

```bash
git clone https://github.com/MetalDriverMedia/ThressGame-My-Version.git
cd ThressGame-My-Version
npm ci
```

Node requirement:
- Node.js 18+

Why `npm ci`:
- Uses lockfile for reproducible dependency install
- Preferred for alpha deploy validation and rollout reproducibility

## 2) Validation commands (pre-deploy)

Run these from repo root:

```bash
npm run check
node --test
npm test
npm run lint
```

Notes:
- `npm run lint` currently maps to the same quality gate script as `npm run check`.
- Keep this sequence in deployment logs/change tickets so operators can prove preflight status.

## 3) Startup modes

### Local startup

```bash
npm start
```

Default URL when `PORT` is unset:
- `http://localhost:3000/`

### Production-like startup

Use the same process command with explicit environment variables when needed:

```bash
PORT=3000 BASE_PATH=/ npm start
```

Recommended process-manager strategy for alpha:
- Single instance Node process (PM2/systemd/host process manager is fine)
- Restart policy enabled for crash recovery
- Explicit maintenance messaging before manual restarts (see restart behavior below)

## 4) Supported environment variables

- `PORT` (default: `3000`)
- `BASE_PATH` (default: `/`)
- `SCOREBOARD_PATH` (optional scoreboard JSON location override)
- `DEBUG_LOG` (`true` or `1` to enable structured debug logs)
- `DEBUG_LOG_VERBOSE` (`true` or `1` for fuller debug payloads)
- `DEBUG_LOG_FILE` (optional append-only debug log file target)

### `PORT` behavior (including `PORT=0`)

- `PORT` is parsed as a positive integer when valid.
- Invalid/non-positive values are normalized to `3000`.
- `PORT=0` is intentionally supported for smoke tests and ephemeral binding.
  - Node binds an available open port.
  - Startup logs print the *actual bound port* for operator verification.

## 5) BASE_PATH behavior

- `BASE_PATH=/` means root deployment.
- Non-root values are normalized (leading slash enforced, duplicate slashes collapsed, trailing slash removed except for root).
- Server exposes `config.js` at either `/config.js` (root) or `<BASE_PATH>/config.js` (subpath) and injects:
  - `window.CHESS_BASE_PATH`
  - `window.CHESS_SOCKET_PATH`

Operator requirement:
- Your reverse proxy/router must preserve the configured base path for static assets, API routes, and Socket.IO.

## 6) Socket.IO production path/proxy requirements

Socket.IO path is derived from base path:
- Root deploy: `/socket.io`
- Subpath deploy: `<BASE_PATH>/socket.io`

Proxy requirements:
- Forward websocket upgrades
- Forward long-polling requests
- Forward both API and socket traffic under the same base path contract
- Avoid multi-instance fan-out for alpha (single instance required for in-memory rooms)

## 7) Static assets and cache-busting behavior

- Static files are served from `public/`.
- `index.html` receives version query params for `main.js` and `styles.css` based on `package.json` version.
- Index responses are `Cache-Control: no-store` to reduce stale shell issues.

Deployment implication:
- Restart after deploy/update so the running process emits fresh asset version stamps.

## 8) Health and readiness contracts

### `GET /api/health`

Returns deployment-safe metadata:
- `status` (`ok`)
- `version`
- `uptimeSeconds`
- `startupTime`
- `timestamp`
- `basePath`
- `socketPath`

### `GET /api/readiness`

Returns scoreboard persistence readiness:
- `200` + `status: ready` when scoreboard directory is writable
- `503` + `status: not_ready` when scoreboard directory is not writable
- Includes `checks.scoreboardPersistence` status object

## 9) Scoreboard persistence location and operations

Default persistence:
- `data/scoreboard.json`

Override:
- `SCOREBOARD_PATH=/path/to/scoreboard.json`

Backup directory (default layout):
- `data/backups/`

### Export command

```bash
node scripts/scoreboard-admin.js export
```

Optional file target:

```bash
node scripts/scoreboard-admin.js export --out ./tmp/scoreboard-export.json
```

### Reset command (with backup by default)

```bash
node scripts/scoreboard-admin.js reset
```

No-backup variant (use cautiously):

```bash
node scripts/scoreboard-admin.js reset --no-backup
```

Operator caution:
- Prefer running reset during maintenance window.
- If practical, stop process before reset to avoid operational confusion during live traffic.

### Missing scoreboard file behavior

- Missing scoreboard file is tolerated.
- Scoreboard initializes in memory and persists on write/save cycle.

## 10) MOTD file behavior

- MOTD source: `data/motd.txt`
- Missing file safely returns empty string from `/api/motd`
- Read failures are logged with warning and treated as empty MOTD

## 11) Debug logging flags

Debug logging is off by default.

Enable structured debug logs:

```bash
DEBUG_LOG=1 npm start
```

Optional verbose payload logging:

```bash
DEBUG_LOG=1 DEBUG_LOG_VERBOSE=1 npm start
```

Optional file append output:

```bash
DEBUG_LOG=1 DEBUG_LOG_FILE=./logs/debug.log npm start
```

Operational caution:
- Configure log rotation/retention if file logging is enabled.
- Do not treat debug logs as long-term observability storage in alpha.

## 12) Graceful shutdown expectations

On `SIGINT`, `SIGTERM`, and `beforeExit`, server attempts to flush pending scoreboard saves.

Expected outcome:
- Most normal stops flush pending scoreboard writes.

Residual risk:
- Abrupt termination or host crash can still lose very recent unsaved updates.

## 13) Restart behavior and session/room continuity

Current alpha contract:
- Active and waiting rooms are in-memory and are lost on process restart.
- Socket connections disconnect and must reconnect.
- Resume tokens/session continuity only work while original process memory still exists.

User-visible limitation:
- Browser refresh/reconnect after *server restart* cannot recover prior active game.
- Players must create or join a new room.

## 14) Single-instance alpha expectation

Deploy as one app instance for alpha.

Reason:
- Room/session lifecycle is process-memory based.
- Multi-instance deployment without shared state breaks deterministic room routing/continuity.

## 15) Rollback procedure (alpha-safe)

1. Announce maintenance/restart to operators/players.
2. Capture scoreboard export:
   ```bash
   node scripts/scoreboard-admin.js export --out ./tmp/pre-rollback-scoreboard.json
   ```
3. Stop current process.
4. Check out previous known-good commit/release tag.
5. Run `npm ci`.
6. Start app with prior env config.
7. Verify:
   - `/api/health`
   - `/api/readiness`
   - home page and socket connect
8. If scoreboard path changed between releases, restore/point to intended scoreboard file before reopening traffic.

## 16) Troubleshooting checklist

- App does not start:
  - Verify Node 18+
  - Re-run `npm ci`
  - Check startup logs for normalized `PORT` and base path values
- Site loads but sockets fail:
  - Validate proxy websocket upgrade forwarding
  - Validate socket path matches `<BASE_PATH>/socket.io`
- `/api/readiness` returns `503`:
  - Ensure scoreboard directory exists/is writable by process user
  - Confirm `SCOREBOARD_PATH` points to writable location
- Scoreboard appears reset/missing after restart:
  - Confirm persistent storage (non-ephemeral volume)
  - Confirm path alignment with `SCOREBOARD_PATH`
- Stale client behavior after deploy:
  - Ensure process restart completed
  - Hard refresh client
- Unexpected loss of active games:
  - Confirm whether process restarted/crashed (expected loss in alpha)

## 17) Known alpha deployment limitations

- No persistent in-memory game room continuity across restarts
- No account/authenticated admin plane
- Single-instance deployment expectation
- Scoreboard durability tied to filesystem durability
- Readiness scope limited to scoreboard persistence writability

## 18) Manual QA checklist for operators

- [ ] clean clone
- [ ] `npm ci`
- [ ] `npm run check`
- [ ] `node --test`
- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npm start`
- [ ] open `http://localhost:3000/`
- [ ] verify static assets load
- [ ] verify `/api/health`
- [ ] verify `/api/readiness`
- [ ] verify Socket.IO connects
- [ ] create room
- [ ] play vs bot
- [ ] refresh during active game
- [ ] restart server and confirm/document expected room/session loss
- [ ] verify scoreboard API
- [ ] verify scoreboard export command
- [ ] verify scoreboard reset command with backup
- [ ] verify missing scoreboard file behavior
- [ ] verify DEBUG_LOG startup note if enabled
- [ ] verify BASE_PATH configuration if practical
- [ ] verify mobile/narrow viewport loads
