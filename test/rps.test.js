const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveRPS } = require('../utils/rps');

test('rock beats scissors', () => {
  assert.equal(resolveRPS('rock', 'scissors'), 'attacker');
});

test('scissors beats paper', () => {
  assert.equal(resolveRPS('scissors', 'paper'), 'attacker');
});

test('paper beats rock', () => {
  assert.equal(resolveRPS('paper', 'rock'), 'attacker');
});

test('same choices tie', () => {
  assert.equal(resolveRPS('rock', 'rock'), 'tie');
});

test('invalid or unexpected input follows current implementation', () => {
  assert.equal(resolveRPS('lizard', 'spock'), 'defender');
  assert.equal(resolveRPS(undefined, 'rock'), 'defender');
});
