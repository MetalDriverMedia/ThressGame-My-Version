# Thress Game Completion Roadmap

## 1. Purpose of This Roadmap
This document is the master planning guide for completing Thress from the current backend/mutator stabilization checkpoint through a finished, playable, and deployable release.

It is intentionally forward-looking and separated into execution phases so each area can be converted into focused implementation PRs.

This roadmap distinguishes between:
- **Already-completed backend/mutator hardening** (checkpoint baseline).
- **Remaining backend cleanup** (contract and lifecycle correctness).
- **Frontend/user experience work** (clarity, prompts, readability).
- **Balance/design decisions** (rules and presets).
- **Deployment readiness** (ops and production confidence).
- **QA/playtesting** (automated and manual confidence gates).
- **Release-candidate criteria** (explicit go/no-go definition).

## 2. Current Project Checkpoint
The project has completed a major backend/mutator hardening pass and now has a stronger baseline for final completion work.

### Completed checkpoint (high-level)
- [x] Legal move engine extraction and move validation stabilization.
- [x] MoveHandler characterization and regression testing.
- [x] Bot move pool alignment with legalMoveEngine.
- [x] Room lifecycle and timer test coverage already added.
- [x] Coin flip / Risk It Rook / All On Red coverage.
- [x] Parry / RPS coverage.
- [x] High-risk mutator pair coverage.
- [x] Mutator combination coverage index.
- [x] lockedSquares cleanup.
- [x] Minefield activeRule lifecycle cleanup.
- [x] Living Bomb metadata tracking.
- [x] Mitosis metadata tracking.
- [x] Drafted trap resolution.
- [x] Pending-state ordering helper and coin-flip suppression while pending interactions exist.

This checkpoint is the baseline for the remaining roadmap phases and should be treated as complete unless regressions are discovered.

## 3. Remaining Phase A: Final Backend Contract Cleanup
Goal: finalize backend behavior contracts and async outcome clarity before broader stability/UX passes.

### A1. handleMove Return Contract / Async Clarity
`handleMove` currently communicates outcomes primarily through socket emissions. That works in production but makes it harder for tests and helpers to reason about exact outcomes and completion boundaries.

Why this matters:
- Tests and future helpers need a predictable way to determine whether a move was applied, rejected, deferred, converted into RPS, ended the game, or produced a skipped turn.
- Async branches should be explicit so callers can await meaningful completion.

Checklist:
- [ ] Audit all `handleMove` return paths.
- [ ] Decide whether socket emissions remain the only public contract or whether `handleMove` should return a narrow internal result object.
- [ ] If a result object is added, keep it small and backwards-compatible.
- [ ] Ensure rejected moves do not mutate state.
- [ ] Ensure game-ended branches are explicit.
- [ ] Ensure RPS-deferred moves are explicit.
- [ ] Ensure bot/test helpers can await meaningful completion.
- [ ] Add tests for representative return outcomes.

### A2. RPS / Parry Async Hardening
Checklist:
- [ ] `pendingRPS` creation.
- [ ] `rpsChoice` resolution.
- [ ] Double-submit protection.
- [ ] Stale `pendingRPS` cleanup.
- [ ] Attacker-win path.
- [ ] Defender-win path.
- [ ] Turn handling after RPS.
- [ ] Game-ended during `pendingRPS`.
- [ ] Bot interaction.
- [ ] No duplicate RPS result events.
- [ ] No move leakage while RPS is unresolved.

### A3. Coin Flip / All On Red Final Lifecycle Hardening
Checklist:
- [ ] `pendingCoinFlip`.
- [ ] `coinFlipResult`.
- [ ] `moveCount` guard.
- [ ] Same-move double-trigger prevention.
- [ ] Manual vs automatic coin flip.
- [ ] Bot coin flip behavior.
- [ ] Skipped-turn behavior.
- [ ] Interaction with Risk It Rook.
- [ ] Interaction with `pendingAction` / `pendingSecondAction` / `pendingRPS`.
- [ ] No stale `pendingCoinFlip` after game end.

### A4. Game-Ended State Protection
Checklist:
- [ ] `handleMove` rejects after game end.
- [ ] `mutatorActionResponse` rejects after game end.
- [ ] `rpsChoice` rejects after game end.
- [ ] `coinFlipChoice` rejects after game end.
- [ ] Bot scheduled moves do not fire after game end.
- [ ] Turn clock stops after game end.
- [ ] No room mutation after end except cleanup/rematch/lobby flow.
- [ ] `gameEnded` emits exactly once.

## 4. Remaining Phase B: Backend Stability Pass
Goal: lock runtime safety around room lifecycle, timers, bot behavior, and deadlock handling once contracts are explicit.

### B1. Room Lifecycle Audit
Checklist:
- [ ] Active rooms cannot be deleted by stale cleanup timers.
- [ ] Ended room cleanup deletes only the intended room instance.
- [ ] New room/rematch does not inherit old cleanup timer.
- [ ] Reconnect/resume behavior is deterministic.
- [ ] Abandoned room cleanup is deterministic.
- [ ] Room status transitions are valid.

### B2. Turn Clock Lifecycle Audit
Checklist:
- [ ] Clock starts after game begins.
- [ ] Clock stops after game ends.
- [ ] Clock resets after legal moves.
- [ ] Clock behavior during `pendingChoice` / `pendingAction` / `pendingSecondAction` / `pendingRPS` / `pendingCoinFlip` is intentional.
- [ ] Bot turns do not leave timers dangling.
- [ ] Test helpers clean up timers.

### B3. Bot Behavior Audit
Checklist:
- [ ] Bot does not move during `pendingChoice`.
- [ ] Bot does not move during `pendingAction`.
- [ ] Bot does not move during `pendingSecondAction`.
- [ ] Bot does not move during `pendingRPS`.
- [ ] Bot handles `pendingCoinFlip`.
- [ ] Bot move pool matches effective legal move engine.
- [ ] Bot avoids Mitosis-blocked pieces, `lockedSquares`, hard-blocked squares, and invalid trap states.
- [ ] Bot does not move after game end.

### B4. Deadlock / No-Legal-Move Audit
Checklist:
- [ ] Normal no-legal-move condition.
- [ ] Mutator restriction deadlock.
- [ ] Parry deadlock.
- [ ] All On Red skipped turns.
- [ ] Mitosis-blocked pieces.
- [ ] Short Stop / No Cowards / Ice Age restrictions.
- [ ] Bot deadlock.
- [ ] `gameEnded` emitted exactly once.

## 5. Remaining Phase C: Rule and Balance Finalization
Goal: separate correctness bugs from intentional game-design decisions and lock final semantics for release.

### C1. Final Rule Semantics to Lock
To verify (design decisions):
- [ ] Should Bottomless Pit always destroy kings?
- [ ] Should Minefield always spare kings while consuming mines?
- [ ] Should Drafted for Battle remain highly chaotic or be made safer?
- [ ] Should Living Bomb explosions affect kings?
- [ ] Should Mitosis duplicate only non-king pieces?
- [ ] Should Mitosis duplicate friendly and enemy pieces equally?
- [ ] Should Parry apply to mutator destruction, normal captures, or both?
- [ ] Should Risk It Rook be allowed during all pending states?
- [ ] Should All On Red be default, optional, or chaos-only?
- [ ] Should any mutators be excluded from beginner mode?

### C2. Preset Rule Modes
Recommended presets (to implement and document):

- **Classic (No Mutators)**
  - Purpose: baseline chess-like experience and onboarding fallback.
  - Rough behavior: no chaos systems; clean move validation only.

- **Light Chaos**
  - Purpose: approachable mutator introduction with lower cognitive load.
  - Rough behavior: smaller safer mutator pool, reduced destructive overlap.

- **Standard Thress**
  - Purpose: intended default player experience.
  - Rough behavior: curated mutator pool balancing chaos and fairness.

- **Full Chaos**
  - Purpose: maximal unpredictability.
  - Rough behavior: all mutators available with few restrictions.

- **Stream Mode**
  - Purpose: spectator readability and entertainment.
  - Rough behavior: high-visibility effects, clearer event feed, spectacle-first pacing.

### C3. Balance Tuning
Checklist:
- [ ] Mutator frequency.
- [ ] Mutator duration.
- [ ] Trap count.
- [ ] Spawn count.
- [ ] RPS frequency.
- [ ] Coin flip frequency.
- [ ] Bot difficulty.
- [ ] Beginner readability.
- [ ] Spectacle vs fairness.
- [ ] Stream pacing.

## 6. Remaining Phase D: Frontend / UX Completion
Goal: make chaotic gameplay understandable, controllable, and visually legible for players.

### D1. Required Player Prompts
Checklist:
- [ ] Pending mutator choice prompt.
- [ ] Pending action target prompt.
- [ ] Pending second-player action prompt.
- [ ] RPS prompt.
- [ ] RPS result display.
- [ ] Coin flip prompt.
- [ ] Coin flip result display.
- [ ] Move rejection messages.
- [ ] Skipped turn message.
- [ ] Game-ended reason.
- [ ] Rematch / return to lobby.

### D2. Board Marker Visuals
Checklist:
- [ ] Minefield squares.
- [ ] Bottomless Pit squares.
- [ ] Living Bomb markers.
- [ ] Mitosis target.
- [ ] `lockedSquares`.
- [ ] Hard-blocked squares.
- [ ] Frozen columns.
- [ ] Invulnerable pieces.
- [ ] Active global effects.
- [ ] Current selected action target.

### D3. Active Mutator Display
Checklist:
- [ ] Active rule list.
- [ ] Turns remaining.
- [ ] Rule owner/chooser.
- [ ] Rule target, where appropriate.
- [ ] Persistent terrain/effect summary.
- [ ] Tooltip/glossary text.

### D4. Event Feed / Game Log
A readable event feed is essential because chaotic games require clear cause-and-effect for both active players and spectators.

Checklist:
- [ ] Mutator activated.
- [ ] Piece transformed.
- [ ] Trap triggered.
- [ ] Mine consumed.
- [ ] Pit triggered.
- [ ] Living Bomb moved/exploded.
- [ ] Mitosis target moved/expired/duplicated.
- [ ] RPS started/resolved.
- [ ] Coin flip prompted/resolved.
- [ ] Turn skipped.
- [ ] Game ended.

### D5. Mobile / Responsive UX
Checklist:
- [ ] Board scales.
- [ ] Prompts remain visible.
- [ ] Touch target selection works.
- [ ] Room code sharing works.
- [ ] Action modals do not hide board.
- [ ] Spectator/mobile view is readable.

## 7. Remaining Phase E: Player Flow and Game Modes
Goal: complete and polish the end-to-end player loop.

Minimum finished game flow:
1. Home.
2. Create Room / Join Room.
3. Enter player name.
4. Choose game mode / preset.
5. Invite opponent or add bot.
6. Ready/start.
7. Play game.
8. Game ends.
9. Rematch / new room / leave.

### E1. Room Creation
- [ ] Room creation UX finalized.
- [ ] Mode/preset selection integrated at creation time.
- [ ] Room metadata shown clearly before start.

### E2. Join Flow
- [ ] Join by room code works reliably.
- [ ] Join errors are user-readable.
- [ ] Rejoin flow after disconnect is deterministic.

### E3. Human vs Human
- [ ] Full flow stable from room start to rematch/exit.
- [ ] All prompts and pending states understandable to both players.

### E4. Human vs Bot
- [ ] Bot add/remove/start flow is consistent.
- [ ] Bot behavior remains valid across mutators and pending states.

### E5. Rematch Flow
- [ ] Rematch request/accept/reset lifecycle is deterministic.
- [ ] No stale room state carries into rematch.

### E6. Spectator Mode (Optional/Future)
- [ ] To verify if included in alpha scope.
- [ ] Read-only view correctness.
- [ ] Spectator event readability.

### E7. Stream Mode (Optional but Valuable)
- [ ] Larger event feed.
- [ ] Readable board markers.
- [ ] Spectator-safe prompts.
- [ ] Possible overlay support.
- [ ] High-chaos preset.

## 8. Remaining Phase F: Persistence and Stats
Goal: define alpha-minimum persistence and clearly defer broader profile/stat systems.

### Alpha minimum
- [ ] Scoreboard persistence.
- [ ] Safe reset/admin tooling.
- [ ] Basic player identity/hash behavior documented.

### Optional/Future
- [ ] Player profiles.
- [ ] Win/loss record.
- [ ] Room history.
- [ ] Game replay/event log.
- [ ] Mutator statistics.
- [ ] Achievement-style stats.
- [ ] Seasonal leaderboard.

## 9. Remaining Phase G: Deployment Readiness
Goal: ensure reproducible local/prod startup, operability, and rollback/maintenance confidence.

Checklist:
- [ ] Clean `npm install`.
- [ ] `npm run check`.
- [ ] `npm test`.
- [ ] `npm start`.
- [ ] Production environment variables documented.
- [ ] Port configuration documented.
- [ ] Socket.IO production config reviewed.
- [ ] Static assets served correctly.
- [ ] Server restart behavior understood.
- [ ] Health check route.
- [ ] Error logging.
- [ ] Process manager or hosting strategy.
- [ ] README deployment instructions.
- [ ] Data backup/reset notes.

Suggested deployment documentation:
- [ ] Local dev setup.
- [ ] Production setup.
- [ ] Environment variables.
- [ ] Commands.
- [ ] Troubleshooting.
- [ ] Known limitations.

## 10. Remaining Phase H: QA and Playtesting
Goal: combine automated gates with repeatable manual scenarios that cover chaos-heavy edge cases.

### Automated QA gate
- [ ] `node --test` run multiple times.
- [ ] `npm test`.
- [ ] `npm run check`.
- [ ] Focused regression tests for high-risk systems.
- [ ] Long-session or randomized stress test if available.

### Manual QA scenarios
- [ ] Human vs human full game.
- [ ] Human vs bot full game.
- [ ] No-mutator game.
- [ ] Light chaos game.
- [ ] Standard game.
- [ ] Full chaos game.
- [ ] Long session.
- [ ] Disconnect/reconnect.
- [ ] Rematch.
- [ ] Mobile browser.
- [ ] Spectator mode (if implemented).
- [ ] Game-end through checkmate.
- [ ] Game-end through resignation.
- [ ] Game-end through timeout.
- [ ] Game-end through king destruction.
- [ ] All pending flows tested manually.

### Bug watchlist
- [ ] Stuck pending prompts.
- [ ] Frozen turns.
- [ ] Active room deletion.
- [ ] Bot stops moving.
- [ ] Duplicate `gameEnded`.
- [ ] Invalid FEN.
- [ ] Missing king.
- [ ] Wrong player turn.
- [ ] Stale trap/bomb/mitosis marker.
- [ ] Legal move rejected incorrectly.
- [ ] Illegal move accepted.
- [ ] Duplicate coin flip.
- [ ] Stale RPS.
- [ ] Unclear UI prompt.

## 11. Remaining Phase I: Final Polish and Release Candidate
Goal: finalize presentation, docs, and release mechanics once correctness/stability gates pass.

Checklist:
- [ ] Landing page.
- [ ] How-to-play page.
- [ ] Mutator glossary.
- [ ] Preset explanations.
- [ ] Cleaner board visuals.
- [ ] Animations.
- [ ] Optional sounds.
- [ ] Optional streamer display.
- [ ] README.
- [ ] Release notes.
- [ ] Known issues list.
- [ ] Version tag.

### Release candidate definition
The game is **release-candidate ready only when** all of the following are true:
- [ ] Major mutator interactions are covered.
- [ ] Backend contracts are clear.
- [ ] No known invalid-FEN bugs.
- [ ] No known stuck pending-state bugs.
- [ ] No known active-room deletion bugs.
- [ ] Full suite passes repeatedly.
- [ ] UI explains chaotic effects clearly.
- [ ] Deployment works from clean install.
- [ ] At least one complete manual playtest passes for each major mode.

## 12. Suggested PR Sequence From Here
Recommended near-term sequence:
1. handleMove return contract / async clarity.
2. RPS / Parry async hardening.
3. Coin Flip / All On Red lifecycle hardening.
4. Game-ended state protection.
5. Room lifecycle pass.
6. Turn clock lifecycle pass.
7. Bot behavior pass.
8. Deadlock/no-legal-move pass.
9. Frontend prompt/UX pass.
10. Board marker/event feed pass.
11. Rule preset/balance pass.
12. Deployment docs/config pass.
13. QA/playtest pass.
14. Release candidate polish pass.

## 13. Definition of Done
Final master checklist:

### Backend correctness
- [ ] Move acceptance/rejection contract is explicit and testable.
- [ ] Pending-state transitions are deterministic.
- [ ] No post-game mutation paths except intended cleanup/rematch/lobby flows.
- [ ] Room/timer lifecycle behavior is deterministic under reconnect/rematch/abandon cases.

### Mutator correctness
- [ ] High-risk mutator interactions are covered and stable.
- [ ] RPS/Parry and Coin Flip/All On Red lifecycles are race-safe.
- [ ] Trap/bomb/mitosis metadata and cleanup are consistent.
- [ ] Deadlock/no-legal-move resolution is correct and emits terminal events once.

### UI/UX clarity
- [ ] All pending prompts are visible and actionable.
- [ ] Board markers communicate all active hazards/effects.
- [ ] Event feed clearly explains cause-and-effect.
- [ ] Mobile usability is acceptable for core play.

### Player flow
- [ ] Home → room create/join → play → end → rematch/exit loop is complete.
- [ ] Human vs human and human vs bot are both production-stable.
- [ ] Optional modes (spectator/stream) are either complete or explicitly deferred.

### Persistence/deployment
- [ ] Alpha-minimum persistence requirements are implemented.
- [ ] Deployment docs are sufficient for clean local and production startup.
- [ ] Runtime logging, health checks, and process strategy are documented.

### QA/release
- [ ] Automated gates pass repeatedly.
- [ ] Manual scenarios pass for each major mode.
- [ ] Known-issues list exists and release notes are prepared.
- [ ] RC criteria in Section 11 are all satisfied.


### Phase H1 completion note (QA/playtesting planning)
- [x] Added `docs/QA_PLAYTESTING_MASTER_CHECKLIST.md` as the master alpha/RC QA gate and playtesting matrix reference.
- [x] Defined alpha-blocking vs non-blocking criteria and deferred/future scope markers for rematch, spectator/stream hardening, profiles/stats, and infra.

### Phase H2 completion note (manual QA session execution logging)
- [x] Added `docs/QA_PLAYTEST_EXECUTION_LOG_TEMPLATE.md` as the fillable per-session manual QA execution log and playtest results template.
- [x] Linked Phase H1 master checklist to the Phase H2 execution log template for repeatable alpha/RC evidence capture.


### Phase H3 completion note (automated regression/stress audit planning)
- [x] Added `docs/AUTOMATED_REGRESSION_STRESS_AUDIT.md` with current automated test inventory, H1-risk coverage map, ranked high-risk gaps, and deterministic stress-test guardrails.
- [x] Defined a phased follow-up test PR plan (H3A-H3E) prioritizing deterministic regression safety before bounded seeded stress expansion.


## H3A completion note (2026-05-19)
- Deterministic regression gap fills added for reconnect/resume ownership basics and scoreboard eligibility matrix basics.
- Deferred by design: expanded terminal-path idempotency races (H3C) and larger churn/watchdog loop suites (H3B/H3D/H3E).


### H3E status update (2026-05-19)
- Added an optional, bounded, deterministic seeded harness (`test/seededStress.h3e.test.js`) with fixed default seeds and fixed step limits for replayable confidence checks.
- Added seed parsing/replay helpers (`test/helpers/seededStressTestHelpers.js`) with `THRESS_STRESS_SEEDS` and `THRESS_STRESS_EXTENDED` local override support.
- Kept default gate short and deterministic; no unbounded fuzz/soak behavior was added.
