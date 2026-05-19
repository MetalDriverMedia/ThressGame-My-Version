# Thress Phase H2 Manual QA Execution Log / Playtest Results Template

## Purpose

Use this fillable template to record real execution outcomes while running the Phase H1 master checklist.

- Primary reference checklist: `docs/QA_PLAYTESTING_MASTER_CHECKLIST.md`
- Deployment/operator reference: `docs/DEPLOYMENT_RUNBOOK_ALPHA.md`

This template is intended to make test sessions repeatable and easier to compare, triage, and sign off for alpha/RC readiness.

## How to Use This Template

1. Copy this file per session (example: `docs/logs/QA_SESSION_2026-05-19_A.md`).
2. Fill session metadata before testing starts.
3. Execute automated and smoke gates; log exact commands and outcomes.
4. Execute manual scenarios; record pass/fail/blocked with evidence.
5. Log every issue in **Bug Triage Log** and track retests.
6. Complete **Release Sign-Off Snapshot** at session end.

---

## Session Metadata

- Session ID:
- Test Plan/Run Type: (Alpha Dry Run / RC Candidate / Regression / Focused Retest)
- Date (UTC):
- Start Time (UTC):
- End Time (UTC):
- Duration:
- Test Lead:
- Testers + Roles:
- Observer(s):
- Branch:
- Tag/Release Candidate Label:
- Commit SHA:
- Build Version (`package.json`):
- Scope Notes:
- Out-of-Scope Notes:

## Environment Matrix

| Env ID | Runtime/Host | Browser + Version | Device | Viewport | Network Condition | Notes |
|---|---|---|---|---|---|---|
| ENV-1 |  |  |  |  |  |  |
| ENV-2 |  |  |  |  |  |  |

### Startup / Config Snapshot

- Server startup command:
- Startup env vars used (`PORT`, `BASE_PATH`, `SCOREBOARD_PATH`, debug flags):
- Scoreboard path + persistence setup:
- Seed/fixture/prep steps:

## Automated Validation Gate Results

| Command | Expected | Actual Result | Pass/Fail | Evidence |
|---|---|---|---|---|
| `npm run check` | Exit 0 |  |  |  |
| `node --test` | Exit 0 |  |  |  |
| `npm test` | Exit 0 |  |  |  |
| `npm run lint` | Exit 0 |  |  |  |
| `git diff --check` | Clean output |  |  |  |

Gate verdict: **PASS / FAIL**

## Deployment Smoke Gate Results

### Startup Smoke

| Check | Expected | Actual Result | Pass/Fail | Evidence |
|---|---|---|---|---|
| `npm start` server boot | Starts without crash; port logged |  |  |  |

### Health/Readiness Smoke

| Command | Expected | Actual Result | Pass/Fail | Evidence |
|---|---|---|---|---|
| `curl -sS http://localhost:3000/api/health` | Valid JSON + healthy status |  |  |  |
| `curl -sS http://localhost:3000/api/readiness` | Valid JSON + ready status |  |  |  |

Smoke verdict: **PASS / FAIL**

---

## Manual Scenario Execution Log

### Scenario Matrix (General)

| Scenario ID | Category | Mode Bucket | PvP/PvB | Environment ID | Steps Summary | Expected Result | Actual Result | Severity if Failed | Alpha-Blocking? | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |  |  |  |

### PvP Test Results

| Scenario ID | Focus Area | Result (Pass/Fail/Blocked) | Notes | Evidence |
|---|---|---|---|---|
|  |  |  |  |  |

### PvB Test Results

| Scenario ID | Focus Area | Result (Pass/Fail/Blocked) | Notes | Evidence |
|---|---|---|---|---|
|  |  |  |  |  |

### Mode Bucket Coverage

| Mode Bucket | Scenario IDs Covered | Result | Notes |
|---|---|---|---|
| No-mutator / classic-like |  |  |  |
| Light chaos |  |  |  |
| Standard |  |  |  |
| Full chaos |  |  |  |

### Pending-Flow Results

| Flow Type | Scenario ID(s) | Result | Notes / Evidence |
|---|---|---|---|
| Mutator choice/action flows |  |  |  |
| RPS / Parry resolution |  |  |  |
| Coin flip / All On Red |  |  |  |
| Promotion / second-action / skip-turn |  |  |  |

### Endgame-Path Results

| Endgame Path | Scenario ID(s) | Result | Notes / Evidence |
|---|---|---|---|
| Checkmate |  |  |  |
| Resignation |  |  |  |
| Timeout |  |  |  |
| King destruction |  |  |  |
| Draw/stalemate path (if exercised) |  |  |  |

### Disconnect / Reconnect / Refresh Results

| Scenario ID | Condition | Result | Notes / Evidence |
|---|---|---|---|
|  | Mid-turn refresh |  |  |
|  | Reconnect after drop |  |  |
|  | Room rejoin behavior |  |  |

### Mobile / Narrow Viewport Results

| Scenario ID | Device/Viewport | Result | Notes / Evidence |
|---|---|---|---|
|  |  |  |  |

### Scoreboard / Persistence Results

| Scenario ID | Setup | Result | Notes / Evidence |
|---|---|---|---|
|  | Ranked-default eligibility |  |  |
|  | Bot/custom/manual-coin exclusion |  |  |
|  | Persistence after restart/read |  |  |

### Health / Readiness Results

| Scenario ID | Check | Result | Notes / Evidence |
|---|---|---|---|
|  | `/api/health` during session |  |  |
|  | `/api/readiness` during session |  |  |

### Optional / Future Spectator Checks

| Scenario ID | Check | Result | Notes |
|---|---|---|---|
|  |  |  |  |

### Optional / Future Stream-Mode Checks

| Scenario ID | Check | Result | Notes |
|---|---|---|---|
|  |  |  |  |

---

## Bug Triage Log

| Bug ID | Title | Scenario ID | Severity | Alpha-blocking? | Reproducible? | Owner | Status | Evidence | Retest result |
|---|---|---|---|---|---|---|---|---|---|
|  |  |  | Blocker/Major/Minor | Yes/No | Yes/No/Intermittent |  | New/Triaged/In Progress/Fixed/Deferred |  |  |

## Retest Log

| Retest ID | Bug ID(s) | Build/Commit Retested | Result | Tester | Date/Time (UTC) | Evidence |
|---|---|---|---|---|---|---|
|  |  |  | Pass/Fail/Partial |  |  |  |

## Known Deferred / Accepted Non-Blocking Items

| Item ID | Description | Reason Deferred | Risk | Target Follow-up | Owner |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

## Release Sign-Off Snapshot

- Automated gate pass/fail:
- Smoke gate pass/fail:
- Manual blocker count:
- Major count:
- Minor count:
- Deferred count:
- RC-ready? (Yes/No):
- Sign-off notes:
- Approved by:
- Approval timestamp (UTC):

## Attachments / Evidence Index

| Evidence ID | Type (Screenshot/Video/Log) | Linked Scenario/Bug | Location/URL | Notes |
|---|---|---|---|---|
|  |  |  |  |  |
