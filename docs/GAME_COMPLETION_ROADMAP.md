# Thress Game Completion Roadmap (Reconciled through Phase H3E / PR #119)

## 1) Purpose
This roadmap is now a **reconciliation document** rather than a purely forward-looking backlog. It aligns original Phases A–H planning with completed implementation/audit work and isolates what still blocks alpha/RC.

Primary reconciliation references:
- `docs/AUTOMATED_REGRESSION_STRESS_AUDIT.md`
- `docs/QA_PLAYTESTING_MASTER_CHECKLIST.md`
- `docs/QA_PLAYTEST_EXECUTION_LOG_TEMPLATE.md`
- `docs/DEPLOYMENT_RUNBOOK_ALPHA.md`
- `docs/DEPLOYMENT_READINESS_AUDIT.md`
- `docs/SCOREBOARD_PERSISTENCE_AUDIT.md`

---

## 2) Reconciled Status Summary by Phase

## Completed

### Phase A/B backend contract + lifecycle hardening (reconciled as completed)
Completed through merged backend hardening + follow-up deterministic regression arc (H3A–H3E), including move legality stability, pending-flow ordering, room/timer/bot lifecycle protections, game-end idempotency assertions, reconnect ownership coverage, and bounded seeded stress replay.

### Phase F persistence/stats alpha-minimum (completed)
Completed for alpha-minimum scope:
- Scoreboard persistence contract documented.
- Safe reset/export operational tooling documented.
- Identity/hash behavior audited and documented.

### Phase G deployment readiness docs (completed)
Completed for alpha-minimum operator scope:
- Deployment runbook established.
- Deployment readiness audit documented.
- Base path/socket path/health/readiness/deploy guardrails documented.

### Phase H planning artifacts (completed)
Completed planning/docs artifacts:
- H1 master QA checklist.
- H2 session execution log template.
- H3 automated regression/stress audit and H3A–H3E completion notes.

---

## Partially completed / needs live QA evidence

### Phase D frontend/UX completion
Status: substantial implementation exists, but final completion requires **executed manual QA evidence** across prompt visibility, responsive behavior, and flow readability.

### Phase E player flow and mode verification
Status: core flows exist and are covered by automated tests in critical areas, but final confidence for alpha/RC requires full manual scenario execution (PvP, PvB, reconnect, rematch, mode buckets).

### Phase H manual validation execution
Status: planning + templates are complete, but **execution pass logs** are still required for alpha/RC declaration.

---

## Still alpha-blocking
The following remain alpha-blocking until executed and recorded:
- Deployment smoke checks for `npm start`, `/api/health`, `/api/readiness`, and static/base-path behavior in a real startup session.
- Full clean automated validation gate run on current head (`npm run check`, `node --test`, `npm test`, `npm run lint`, `git diff --check`).
- Manual QA execution session using `docs/QA_PLAYTEST_EXECUTION_LOG_TEMPLATE.md` covering required H1 scenarios.
- Manual full-game passes for PvP and human-vs-bot.
- Manual mode-bucket passes: classic/no-mutator, light chaos, standard, full chaos.
- Manual disconnect/reconnect verification.
- Manual rematch verification.
- Mobile portrait/landscape prompt visibility verification.
- Manual scoreboard persistence/eligibility verification in real play session.

---

## RC-blocking (after alpha-blocking items clear)
- Release notes drafted for candidate build.
- Known-issues list curated with explicit deferred/non-blocking items.
- Version tag / RC declaration created after all alpha-blocking checks are green.

---

## Optional / post-alpha deferred
- Spectator hardening (unless promoted to committed alpha surface).
- Stream Mode expansion/hardening.
- Advanced profile/stats UX and broader persistence evolution.
- Long-run/unbounded fuzz/soak testing outside bounded deterministic policy.

---

## Total 1.0 polish
- Landing page/content polish.
- Mutator glossary/how-to-play editorial pass.
- Visual polish/animation/sound refinement.
- Optional streamer-centric overlays and advanced presentation features.

---


## Live QA blocker note (2026-05-19)
- **Alpha-blocking incident found during live QA:** reconnect/main-screen kick race and a freeze risk during partial `moving_up_the_corporate_ladder` target selection restore.
- **Status:** fixed in emergency runtime/test PR with timer-identity safety hardening for disconnect callbacks plus pending-action partial-data resume restoration for multi-step mutator UI reconstruction.
- **Impact on H4A:** keep H4A validation-evidence sequencing paused until this fix PR is merged and validated in live QA replay.

---
## 3) Current Remaining Alpha/RC Gap Matrix

| Gap / task | Status | Blocking level | Evidence / doc reference | Suggested next PR |
|---|---|---|---|---|
| Static asset + `BASE_PATH` deployment smoke checks (root + subpath sanity) | Not yet logged as executed | Alpha-blocking | `docs/DEPLOYMENT_RUNBOOK_ALPHA.md`, `docs/DEPLOYMENT_READINESS_AUDIT.md` | H4B deployment smoke evidence pass |
| Full clean automated validation gate (`npm run check`, `node --test`, `npm test`, `npm run lint`, `git diff --check`) | Planned, not yet captured as reconciliation evidence | Alpha-blocking | `docs/QA_PLAYTESTING_MASTER_CHECKLIST.md` §2 | H4A validation-evidence capture |
| `npm start` smoke | Planned, not yet captured as reconciliation evidence | Alpha-blocking | `docs/QA_PLAYTESTING_MASTER_CHECKLIST.md` §3.1, `docs/DEPLOYMENT_RUNBOOK_ALPHA.md` | H4B deployment smoke evidence pass |
| `/api/health` and `/api/readiness` smoke | Planned, not yet captured as reconciliation evidence | Alpha-blocking | `docs/QA_PLAYTESTING_MASTER_CHECKLIST.md` §3.2, `docs/DEPLOYMENT_RUNBOOK_ALPHA.md` | H4B deployment smoke evidence pass |
| Manual QA execution session using execution-log template | Template exists; execution evidence pending | Alpha-blocking | `docs/QA_PLAYTEST_EXECUTION_LOG_TEMPLATE.md`, `docs/QA_PLAYTESTING_MASTER_CHECKLIST.md` | H4C first full manual QA session log |
| Full PvP playtest | Pending evidence | Alpha-blocking | `docs/QA_PLAYTESTING_MASTER_CHECKLIST.md` §5.2 | H4C manual QA session |
| Full human-vs-bot playtest | Pending evidence | Alpha-blocking | `docs/QA_PLAYTESTING_MASTER_CHECKLIST.md` §5.3 | H4C manual QA session |
| Classic / no-mutator playtest | Pending evidence | Alpha-blocking | `docs/QA_PLAYTESTING_MASTER_CHECKLIST.md` §5.4 | H4C manual QA session |
| Light Chaos playtest | Pending evidence | Alpha-blocking | `docs/QA_PLAYTESTING_MASTER_CHECKLIST.md` §5.4 | H4C manual QA session |
| Standard playtest | Pending evidence | Alpha-blocking | `docs/QA_PLAYTESTING_MASTER_CHECKLIST.md` §5.4 | H4C manual QA session |
| Full Chaos playtest | Pending evidence | Alpha-blocking | `docs/QA_PLAYTESTING_MASTER_CHECKLIST.md` §5.4 | H4C manual QA session |
| Disconnect/reconnect manual verification | Automated basis exists; manual evidence pending | Alpha-blocking | `docs/AUTOMATED_REGRESSION_STRESS_AUDIT.md` (H3A/H3D notes), `docs/QA_PLAYTESTING_MASTER_CHECKLIST.md` §5.5 | H4C manual QA session |
| Rematch manual verification | Pending evidence | Alpha-blocking | `docs/QA_PLAYTESTING_MASTER_CHECKLIST.md` §5.2/§5.5 and rematch flow expectations | H4C manual QA session |
| Mobile portrait/landscape prompt visibility | Pending evidence | Alpha-blocking | `docs/QA_PLAYTESTING_MASTER_CHECKLIST.md` §5.8 | H4C manual QA session |
| Scoreboard persistence manual verification | Automated + audit baseline exists; manual pass pending | Alpha-blocking | `docs/SCOREBOARD_PERSISTENCE_AUDIT.md`, `docs/QA_PLAYTESTING_MASTER_CHECKLIST.md` §5.11 | H4C manual QA session |
| Release notes + known issues list | Not yet drafted for candidate | RC-blocking | `docs/QA_PLAYTESTING_MASTER_CHECKLIST.md` pass/fail framing | H4D RC notes/known-issues PR |
| Version tag / release candidate declaration | Not yet declared | RC-blocking | RC criteria in `docs/QA_PLAYTESTING_MASTER_CHECKLIST.md` | H4E RC declaration PR |

---

## 4) Reconciled Completion Notes (A–H snapshot)

- Original Phase A/B backend contract risks are now substantially addressed by merged correctness work and reinforced by deterministic H3A–H3E regression/stress coverage.
- Phase F/G audit/runbook deliverables are complete at alpha-minimum documentation/operational level.
- Phase H planning docs are complete; remaining H work is execution evidence, not planning structure.
- Primary unresolved work is now concentrated in live QA + deploy smoke evidence + RC packaging artifacts.

---

## 5) Recommended Next PR Sequence After This Reconciliation

1. **H4A – Validation Evidence PR (docs-only):** capture fresh outputs for required automated gate commands.
2. **H4B – Deployment Smoke Evidence PR (docs-only):** capture `npm start`, health/readiness, and base-path/static smoke outcomes.
3. **H4C – Manual QA Session #1 PR (docs-only):** fill execution log template with full PvP/PvB/mode/reconnect/rematch/mobile/scoreboard coverage.
4. **H4D – RC Notes PR (docs-only):** release notes + known issues/deferred list.
5. **H4E – RC Declaration PR (docs-only/release metadata):** version tag + explicit RC pass/fail declaration.
