const test = require('node:test');
const assert = require('node:assert/strict');

const { validateSquare, validatePromotion, hasInvalidCharacters } = require('../utils/validation');

test('validateSquare accepts a1 and h8', () => {
  assert.equal(validateSquare('a1'), true);
  assert.equal(validateSquare('h8'), true);
});

test('validateSquare rejects invalid input', () => {
  assert.equal(validateSquare('i1'), false);
  assert.equal(validateSquare('a9'), false);
  assert.equal(validateSquare('A1'), false);
  assert.equal(validateSquare(17), false);
});

test('validatePromotion returns q by default for missing promotion', () => {
  assert.equal(validatePromotion({ type: 'p', color: 'w' }, 'a8'), 'q');
});

test('validatePromotion accepts q, r, b, n', () => {
  const pawn = { type: 'p', color: 'w' };
  assert.equal(validatePromotion(pawn, 'a8', 'q'), 'q');
  assert.equal(validatePromotion(pawn, 'a8', 'r'), 'r');
  assert.equal(validatePromotion(pawn, 'a8', 'b'), 'b');
  assert.equal(validatePromotion(pawn, 'a8', 'n'), 'n');
});

test('validatePromotion rejects invalid promotion pieces', () => {
  assert.equal(validatePromotion({ type: 'p', color: 'w' }, 'a8', 'k'), 'q');
});

test('hasInvalidCharacters accepts letters, numbers, and spaces', () => {
  assert.equal(hasInvalidCharacters('Player 123'), false);
});

test('hasInvalidCharacters rejects punctuation or symbols', () => {
  assert.equal(hasInvalidCharacters('Player!'), true);
  assert.equal(hasInvalidCharacters('Player_One'), true);
});
