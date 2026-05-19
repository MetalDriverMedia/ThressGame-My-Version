# Thress Phase H1 QA / Playtesting Master Checklist

## Scope and Intent

This checklist is the **master alpha/RC validation guide** for Phase H1. It consolidates automated gates, deployment smoke checks, manual playtesting, and release pass/fail criteria.

This document is **documentation-first** and does **not** change gameplay, mutator behavior, move legality, scoring eligibility, room lifecycle internals, turn clocks, bot behavior, or Socket.IO event contracts.

Use alongside:
- `docs/DEPLOYMENT_RUNBOOK_ALPHA.md`
- `docs/DEPLOYMENT_READINESS_AUDIT.md`
- `docs/SCOREBOARD_PERSISTENCE_AUDIT.md`
- Flow audits in `docs/*_AUDIT.md`

---

## 1) Alpha Blocking vs Non-Blocking

### Alpha Blocking (must pass before alpha/RC sign-off)
- Server fails automated validation gate (`npm run check`, `node --test`, `npm test`, `npm run lint`, `git diff --check`).
- `npm start` smoke startup fails or app crashes during launch.
- `/api/health` or `/api/readiness` unavailable or malformed.
- Core game loop regression in PvP/PvB (cannot create/join/start/play/finish reliably).
- Endgame outcome wrong for any core outcome: checkmate, resignation, timeout, king destruction.
- Pending-flow deadlock (cannot resolve mutator choice/action/RPS/coin flip/promotion/skip-turn).
- Frozen turns, repeated `gameEnded`, or room lifecycle corruption causing active game loss.
- Scoreboard eligibility regression (bot/custom/manual-coin games incorrectly counted, or ranked-default games not counted).
- Mobile layout blocks required prompts/actions for active player in supported mobile viewport checks.

### Non-Blocking (can ship alpha with tracked follow-up)
- Cosmetic UI copy issues with no gameplay-impact.
- Optional/deferred systems still limited by known scope (Spectator hardening, Stream Mode expansion, advanced profile/stats UX).
- Minor readability issues in event feed/marker styling that do not hide required decisions.

---

## 2) Automated Validation Gate (Required)

Run from repo root on clean branch:

```bash
npm ci
npm run check
node --test
npm test
npm run lint
git diff --check
```

Pass criteria:
- All commands exit 0.
- No syntax/test regressions.
- No whitespace/conflict-marker diff issues.

---

## 3) Deployment Smoke Gate (Required)

## 3.1 Startup smoke

```bash
npm start
```

Verify:
- Server boots without crash.
- Logs show bound port and readiness to accept requests.

## 3.2 Health/readiness contract smoke

With server running:

```bash
curl -sS http://localhost:3000/api/health
curl -sS http://localhost:3000/api/readiness
```

Pass criteria:
- Both endpoints return valid JSON.
- Health status indicates service alive.
- Readiness indicates service can accept gameplay traffic.

---

## 4) Manual QA Matrix Template (Required)

Use this table for every scenario block below.

| Scenario ID | Browser/Profile Setup | Player Count | Mode/Settings | Steps | Expected Result | Blocking Severity if Failed | Notes / Evidence |
|---|---|---:|---|---|---|---|---|
| Example-H1-001 | Chrome normal + Firefox private | 2 human | Standard defaults | Create room → join → play 5 moves | Turn swaps, prompts render, no desync | Blocker | Video + console logs |

Severity guidance:
- **Blocker**: alpha sign-off blocked.
- **Major**: can continue test session, but release decision likely blocked pending triage.
- **Minor**: non-blocking polish issue.

---

## 5) Manual Playtesting Scenario Coverage

## 5.1 Room/Create/Join Baseline
- Create room and join with valid code.
- Invalid code handling.
- Full-room handling.
- Refresh/reopen join flow recovery.

## 5.2 Human vs Human Scenarios
- Full game from room create to completion.
- Midgame reconnect for each side.
- Move legality rejects invalid moves, accepts legal moves.
- Timer transitions after each legal turn.

## 5.3 Human vs Bot Scenarios
- Create bot game and complete match.
- Verify bot acts only on bot turns.
- Verify no bot movement during pending prompts (mutator/RPS/coinflip/etc.).

## 5.4 Rule/Preset Coverage Buckets
Run matrix for each bucket:
- **No-Mutator / Classic-like** (mutators effectively disabled).
- **Light-Chaos / Beginner-like** (low complexity posture).
- **Standard**.
- **Full-Chaos**.

For each bucket verify:
- Room start, first mutator choice cadence, pending resolution, game completion.
- Scoreboard eligibility behavior matches current contract.

## 5.5 Disconnect / Reconnect / Refresh
- Player refresh while active in-room.
- Temporary network disconnect and reconnect.
- Opponent disconnect handling.
- Reconnect token staleness behavior.
- Restart-time resume limitations (expected after process restart).

## 5.6 Endgame Outcome Scenarios
Validate all termination paths:
- Checkmate.
- Resignation.
- Timeout.
- King destruction.

Checks per path:
- Single `gameEnded` semantics.
- No extra moves accepted post-end.
- Correct winner/result presentation.
- Scoreboard update eligibility only when contract allows.

## 5.7 Pending-Flow Scenarios
Validate completion/no-deadlock for:
- Mutator choice prompt.
- Mutator target/action prompt.
- Second-player response prompt.
- RPS prompt.
- Coin flip prompt.
- Promotion choice.
- Skipped turn path.

For each:
- Required actor can submit response.
- Non-actor cannot submit unauthorized response.
- Game returns to deterministic next state.

## 5.8 Mobile / Narrow Viewport Checks
At minimum test:
- ~390px portrait.
- ~812px landscape.

Validate:
- Board visibility and interaction remain usable.
- Prompt modals fully reachable.
- Action buttons/tap targets accessible.
- Layout does not hide required turn/prompt controls.

## 5.9 Spectator Checks (Optional/Future if deferred)
- Join as spectator during active game.
- Observe board/event updates and end-state transition.
- Mark failures as:
  - **Blocking** only if spectator is alpha-committed surface.
  - **Non-blocking / Deferred** if hardened spectator mode remains out of alpha scope.

## 5.10 Stream Mode Checks (Post-Alpha/Future if deferred)
- Validate only currently shipped stream-mode surface.
- Mark advanced/full stream-mode items as deferred post-alpha.

## 5.11 Scoreboard / Persistence Checks
- Human default-eligible game increments expected records.
- Bot game does not count.
- Custom/disabled-mutator/manual-coinflip games do not count.
- Leaderboard retrieval still works after game end.
- Restart behavior consistent with documented persistence contract.

## 5.12 Deployment / Restart Checks
- Controlled restart with no active games.
- Controlled restart during active games (expected in-memory room loss behavior communicated).
- Post-restart create/join/start recovery path.

## 5.13 Health / Readiness Checks
- `GET /api/health` stable across session.
- `GET /api/readiness` stable during normal play and after restart.

---

## 6) Bug Watchlist (High Priority)

Track and triage immediately if seen:
- Stuck pending prompts.
- Frozen turns.
- Duplicate `gameEnded`.
- Bot stops moving.
- Active room deletion.
- Player sees “not in room” while actively in game.
- Stale resume token behavior.
- Mutator overlay mismatch.
- Scoreboard incorrectly counting bot/custom/manual-coin games.
- Mobile layout blocking prompts.
- Socket.IO disconnect/reconnect failures.

Recommended evidence capture per issue:
- Room code.
- Timestamp + timezone.
- Player role (white/black/spectator/bot).
- Mutators active at time of issue.
- Console/network logs.
- Screenshot or short clip.

---

## 7) Release-Candidate Pass/Fail Criteria

## PASS (RC-ready)
- Automated gate fully green.
- Deployment smoke gate green.
- All alpha-blocking manual scenarios passed.
- No unresolved blocker defects in bug watchlist.
- Deferred items explicitly labeled and accepted as non-blocking.

## FAIL (RC not ready)
- Any blocking automated/deployment/manual gate failure.
- Any reproducible core-loop regression unresolved.
- Any scoreboard eligibility contract break unresolved.
- Any pending-flow deadlock unresolved.

---

## 8) Bug Report Template

```md
# Bug Report: <short title>

- Date/Time (UTC):
- Environment: (browser + OS + viewport)
- Build/Commit:
- Room Code:
- Mode/Settings:
- Players:
- Active Mutators:

## Repro Steps
1.
2.
3.

## Expected

## Actual

## Severity
- Blocker / Major / Minor

## Evidence
- Screenshot/video:
- Console logs:
- Network payloads/events:

## Notes
```

---

## 9) Recommended Playtest Session Format

Per session (60-90 minutes recommended):
1. **10 min**: environment setup + automated gate spot-check.
2. **15 min**: deployment smoke + health/readiness checks.
3. **25-40 min**: structured matrix execution (PvP, PvB, pending/endgame flows).
4. **10-20 min**: mobile/narrow viewport passes.
5. **5 min**: triage review + blocker call.

Team roles (minimum):
- Driver (plays + executes scripts).
- Observer (logs evidence + tracks matrix).
- Triage owner (severity assignment + follow-up tickets).

---

## 10) Known Deferred / Future (Non-Blocking Unless Scope Changes)

The following remain deferred unless explicitly promoted to alpha-blocking scope:
- True rematch flow hardening (if still partial/non-finalized).
- Full Stream Mode implementation/hardening.
- Hardened Spectator Mode beyond alpha minimum.
- Advanced player profiles/stats/account identity surfaces.
- CI/CD pipeline, Docker/containerization, hosted database migration, and broader infra hardening.

