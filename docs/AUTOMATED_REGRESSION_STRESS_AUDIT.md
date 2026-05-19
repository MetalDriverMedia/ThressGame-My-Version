# Thress Phase H3 Automated Regression / Stress Audit

## Scope and intent

This Phase H3 document audits the **current automated suite** and defines a safe, deterministic follow-up path for alpha blocking regression/stress confidence.

Guardrails for this PR:
- Documentation-first; no gameplay/runtime contract changes.
- No dependency/version churn.
- No broad randomized fuzzing or long-running soak tests in normal PR gates.

## Validation gate context

Phase H1 alpha-blocking automated gate:
- `npm ci`
- `npm run check`
- `node --test`
- `npm test`
- `npm run lint`
- `git diff --check`

Current `package.json` scripts map:
- `npm test` -> `node --test`
- `npm run lint` -> `npm run check`

## Existing automated test inventory

### Current test files (top-level)

- `test/startup.smoke.test.js`: server boot smoke/import safety.
- `test/apiRoutes.health.test.js`: health/readiness API contract checks.
- `test/gameLifecycle.room.test.js`: room lifecycle, create/join/bot/join handlers, disconnect/resume helpers.
- `test/gameLifecycle.endgame.test.js`: endgame reason routing, deadlock checks, gameEnded emission behavior.
- `test/gameLifecycle.turnClock.test.js`: turn clock lifecycle and timeout callback handling.
- `test/moveHandler.basic.test.js`, `test/moveHandler.rejections.test.js`, `test/moveHandler.mutators.test.js`, `test/moveHandler.parryRps.test.js`: move legality/apply/reject and mutator/pending integrations.
- `test/mutatorHandler.selectMutator.test.js`, `test/mutatorHandler.actionResponse.test.js`, `test/mutatorHandler.specialFlows.test.js`: mutator selection and action/pending response handling.
- `test/coinFlip.pending.test.js`, `test/coinFlip.riskItRook.test.js`: coin flip pending and Risk It Rook interaction coverage.
- `test/rps.test.js`, `test/botManager.parryRps.test.js`: RPS/parry branch behavior.
- `test/botManager.test.js`, `test/botManager.execution.test.js`: bot scheduling and execution behavior.
- `test/scoreboard.admin.test.js`: scoreboard persistence/admin-safe export/reset handling.
- `test/playerIdentity.test.js`: identity hash determinism/PII-safety behavior.
- `test/socketValidation.test.js`, `test/validation.test.js`, `test/roomIntegrity.test.js`, `test/roomCodes.test.js`, `test/debugLogger.test.js`: utility validation/guardrail tests.
- `test/legalMoveEngine.test.js`, `test/checkDetector.test.js`, `test/boardUtils.test.js`, `test/mutatorEngine.test.js`, `test/mutatorMitosis.expiry.test.js`: rules/mutator engine unit coverage.
- `test/mutatorCombinations.*.test.js` (18 files): targeted deterministic high-risk mutator interaction regression cases.

### Categorized inventory table

| Test group | Example files | Type | Runtime area | Alpha-blocking risk it protects |
|---|---|---|---|---|
| Startup smoke/import safety | `startup.smoke.test.js` | Smoke | `server.js` boot path | startup crash/regression |
| API health/readiness | `apiRoutes.health.test.js` | Integration-lite | `routes/apiRoutes` + persistence readiness check | deployment/health gate break |
| Room/join/lifecycle | `gameLifecycle.room.test.js` | Integration | `gameManager`, `handlers/joinHandler`, disconnect/resume helpers | create/join/rejoin/lifecycle corruption |
| Move handling & rejections | `moveHandler.*.test.js`, `legalMoveEngine.test.js` | Integration + unit | `handlers/moveHandler`, legal move engine | illegal move acceptance / legal move rejection |
| Mutator & pending flows | `mutatorHandler.*`, `mutatorEngine.test.js`, `mutatorCombinations.*` | Integration + unit | `handlers/mutatorHandler`, `mutators/*` | stuck pending prompts / misapplied mutators |
| RPS/parry | `rps.test.js`, `moveHandler.parryRps.test.js`, `botManager.parryRps.test.js` | Integration + unit | RPS/parry resolution path + bot interactions | unresolved/stale RPS, bad turn progression |
| Coin flip / All On Red / Risk It Rook | `coinFlip.pending.test.js`, `coinFlip.riskItRook.test.js`, relevant mutator combination tests | Integration | coin flip pending + mutator interplay | skipped/duplicated coin flip or bad pending-state ordering |
| Turn clock/timeouts | `gameLifecycle.turnClock.test.js` | Unit + integration-lite | `utils/turnClock`, timeout resign handler hooks | frozen turn clock / stale timeout callbacks |
| Bot lifecycle | `botManager.test.js`, `botManager.execution.test.js` | Unit + integration-lite | `botManager.js` and turn execution constraints | bot stall / out-of-turn action |
| Endgame and dedupe safety | `gameLifecycle.endgame.test.js` | Integration | `utils/gameLifecycle`, `handleMove` terminal branches | incorrect end reason, post-end mutation risk |
| Scoreboard and identity | `scoreboard.admin.test.js`, `playerIdentity.test.js` | Unit | `utils/scoreboard`, `utils/playerIdentity` | persistence/eligibility-adjacent integrity + hash safety |
| Utilities and guardrails | `socketValidation.test.js`, `roomIntegrity.test.js`, etc. | Unit | `utils/*` | malformed payload/room state handling regressions |

## Coverage map against H1 alpha-blocking risks

| H1 risk category | Current status | Notes |
|---|---|---|
| startup/import safety | **Covered** | startup smoke test exists. |
| health/readiness | **Covered** | endpoint contract test exists. |
| room creation/join | **Partially covered** | join/create flows covered; high-churn reconnect matrix still limited. |
| move handling | **Covered** | basic/rejection/mutator move-handler tests are present. |
| mutator/pending flows | **Partially covered** | many deterministic combos covered; watchdog/deadlock churn scenarios are still thin. |
| RPS/Parry | **Covered** | direct and bot interaction coverage exists. |
| coin flip/All On Red | **Partially covered** | deterministic interaction tests exist; repeated-cycle/idempotency coverage is limited. |
| turn clock/timeouts | **Partially covered** | lifecycle covered; disconnect + timeout race matrix still limited. |
| bot lifecycle | **Partially covered** | execution branches covered; long repeated-play anti-stall loops absent. |
| disconnect/reconnect/resume | **Gap (high)** | baseline helper coverage only; no dedicated deterministic churn suite. |
| game end/deduplication | **Partially covered** | terminal reasons covered; explicit duplicate `gameEnded` idempotency suite needed. |
| scoreboard eligibility/persistence | **Gap (high)** | admin/persistence safety tested; eligibility-contract matrix under endgame paths missing. |
| player identity/hash behavior | **Covered** | deterministic hash/fallback tests present. |
| static asset/config/base path behavior | **Partially covered** | health payload basePath/socketPath checks present; static asset/base-path serving matrix not directly tested. |

## High-risk gaps

### Blocker-risk gaps (prioritize first)
1. Deterministic disconnect/reconnect/resume churn coverage for active games (including pending states and turn transitions).
2. Explicit game-end idempotency checks ensuring `gameEnded` emits once across competing terminal paths.
3. Scoreboard eligibility matrix tests (counted vs non-counted outcomes for bot/custom/manual coin flip) tied to endgame events.

### Major-risk gaps
1. Pending-flow watchdog tests for stuck/unowned prompt resolution (choice/action/second-action/RPS/coin flip).
2. Bot repeated-turn lifecycle tests across many deterministic games to catch stalls or stale timers.
3. Static asset/base-path deployment smoke checks (minimal bounded contract-level assertions).

### Nice-to-have gaps
1. Expanded rule preset regression snapshots (non-flaky deterministic fixtures).
2. Additional utility hardening for malformed spectator/stream-mode payloads where alpha scope includes those surfaces.

## Stress-test risk model (safe for alpha)

Use bounded, deterministic simulations only:
- Deterministic simulated-room loops with fixed scripted move/pending sequences.
- Fixed-iteration reconnect churn loops (small N in PR gate; larger optional local/nightly run).
- Bot-turn repeated-play loops with strict upper bounds and explicit timeout assertions.
- Pending-flow watchdog assertions with forced stale-state fixtures.
- Endgame idempotency loops validating one terminal emission per game.
- Scoreboard write/read loops on temp files with deterministic expected totals.

Randomized testing policy:
- No unbounded fuzzing in normal PR gate.
- Seeded pseudo-random scenarios only after seed capture/replay harness is implemented.

## Safe future test strategy

1. Start with tiny deterministic handler/unit tests.
2. Prefer isolated handler/runtime module coverage over flaky browser E2E.
3. Add bounded smoke integration tests only where event ordering is stable.
4. Keep all stress loops short in required CI, with optional extended local/nightly mode.
5. Add invariants first (single terminal emit, no post-end mutation, pending-owner enforcement), then broader sequence tests.

## Suggested follow-up PR sequence

- **H3A**: deterministic regression gap fills (disconnect/resume ownership + scoreboard eligibility matrix basics).
- **H3B**: pending-flow watchdog tests (stuck prompt prevention + unauthorized actor rejection).
- **H3C**: game-end/idempotency tests (single `gameEnded`, no post-end writes/moves).
- **H3D**: bot/reconnect loop tests (bounded repeated games + reconnect churn).
- **H3E**: optional bounded seeded stress harness (seed capture/replay + fixed iteration limits).

## Do-not-add-yet guardrails

- Unbounded random fuzzing.
- Flaky real-browser E2E without stabilization.
- Long-running soak tests in normal PR gate.
- Dependency churn for testing-only experimentation.
- Broad test harness rewrites before deterministic invariants are locked.

## Validation performed

- `npm run check`
- `node --test`
- `npm test`
- `npm run lint`
- `git diff --check`

## Contract-safety confirmation

This Phase H3 PR is audit/documentation-focused and does **not** change:
- gameplay,
- mutator behavior,
- move legality,
- scoring or scoreboard eligibility logic,
- room lifecycle internals,
- turn-clock behavior,
- bot behavior,
- Socket.IO event names/payload contracts,
- balance.
