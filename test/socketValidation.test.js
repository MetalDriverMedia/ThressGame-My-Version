const test = require('node:test');
const assert = require('node:assert/strict');

const { validateMovePayload, validateResumePayload } = require('../utils/socketValidation');

test('validateMovePayload accepts minimal valid move', () => {
  const res = validateMovePayload({ from: 'e2', to: 'e4' });
  assert.equal(res.ok, true);
});

test('validateMovePayload rejects invalid shape', () => {
  const res = validateMovePayload({ from: 1, to: 'e4' });
  assert.equal(res.ok, false);
});

test('validateResumePayload accepts token string', () => {
  const res = validateResumePayload({ token: 'abc123' });
  assert.equal(res.ok, true);
});

test('validateResumePayload rejects missing token', () => {
  const res = validateResumePayload({});
  assert.equal(res.ok, false);
});
