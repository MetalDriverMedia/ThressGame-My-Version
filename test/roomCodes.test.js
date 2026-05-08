const test = require('node:test');
const assert = require('node:assert/strict');

const { generateRoomCode, isValidRoomCode } = require('../utils/roomCodes');

test('generateRoomCode returns valid format', () => {
  const code = generateRoomCode();
  assert.match(code, /^[A-Z]+-[A-Z]+-[0-9][A-Z]$/);
});

test('isValidRoomCode accepts a generated room code', () => {
  const code = generateRoomCode();
  assert.equal(isValidRoomCode(code), true);
});

test('isValidRoomCode rejects malformed codes', () => {
  assert.equal(isValidRoomCode('bad-code'), false);
  assert.equal(isValidRoomCode('BOLD-KNIGHT-77'), false);
  assert.equal(isValidRoomCode('BOLDKNIGHT7X'), false);
});
