# Mutator Lifecycle

## Start of game

- New rooms start with `mutatorState = createMutatorState()`.
- Move count starts at `0`.

## Choice trigger cadence

- Rule choice appears every 3rd move opportunity.
- Trigger condition: `(moveCount + 1) % 3 === 0`.

## Selection

1. Engine generates up to 3 eligible weighted options.
2. Current chooser emits `selectMutator`.
3. If the rule needs target input, server emits `mutatorAction`.
4. Optional second-player target is collected when required.

## Activation

- `activateRule(...)` stores active rule with:
  - `activatedAtMove`
  - `expiresAtMove` for duration rules
  - `choiceData` / `secondChoiceData`
- Instant-only rules are recorded in history without persisting in `activeRules`, except persistent-instant exceptions.

## During moves

- Active rule hooks and legal-move modifiers are applied in move processing.
- RPS and coin-flip pending states can block normal move submission.

## Expiration

- After move progression, expired rules are removed and emitted.
- Expired/instant events are copied into `completedMutators` for replay/resume.

## Resume

- `serializeMutatorState(...)` is sent on `resumeSuccess` and spectator join for full client rehydration.
