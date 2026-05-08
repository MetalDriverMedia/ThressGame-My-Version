const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMutatorState,
  shouldTriggerChoice,
  activateRule,
  checkExpiredRules,
  incrementMoveCount,
  serializeMutatorState,
} = require('../mutators/mutatorEngine');

test('choice trigger cadence is every 3 moves', () => {
  const ms = createMutatorState();
  assert.equal(shouldTriggerChoice(ms), false); // move 1
  incrementMoveCount(ms); // 1
  assert.equal(shouldTriggerChoice(ms), false); // move 2
  incrementMoveCount(ms); // 2
  assert.equal(shouldTriggerChoice(ms), true); // move 3
  incrementMoveCount(ms); // 3
  assert.equal(shouldTriggerChoice(ms), false); // move 4
});

test('activate + expire duration mutator', () => {
  const ms = createMutatorState();
  const active = activateRule(ms, 'mind_control', 'w', 'e4', 'e5', 1);
  assert.ok(active);
  assert.equal(ms.activeRules.length, 1);

  incrementMoveCount(ms);
  const expired = checkExpiredRules(ms);
  assert.equal(expired.length, 1);
  assert.equal(ms.activeRules.length, 0);
});

test('serialized mutator state includes expected keys', () => {
  const ms = createMutatorState();
  const payload = serializeMutatorState(ms);
  assert.ok(Object.prototype.hasOwnProperty.call(payload, 'moveCount'));
  assert.ok(Object.prototype.hasOwnProperty.call(payload, 'activeRules'));
  assert.ok(Object.prototype.hasOwnProperty.call(payload, 'boardModifiers'));
  assert.ok(Object.prototype.hasOwnProperty.call(payload, 'completedMutators'));
});
