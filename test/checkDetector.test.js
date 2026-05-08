const test = require('node:test');
const assert = require('node:assert/strict');

const { fenToBoard } = require('../mutators/boardUtils');
const {
  getStandardAttackSquares,
  isKingInCheck,
  wouldLeaveKingInCheck,
  getAttackSquares,
} = require('../mutators/checkDetector');

const noRules = { activeRules: [], boardModifiers: {}, moveCount: 0 };

test('standard rook attacks', () => {
  const board = fenToBoard('8/8/8/3r4/8/8/8/8 w - - 0 1');
  const attacks = getStandardAttackSquares('d5', { type: 'r', color: 'b' }, board);
  assert.ok(attacks.includes('d1'));
  assert.ok(attacks.includes('a5'));
  assert.ok(attacks.includes('h5'));
});

test('standard bishop attacks', () => {
  const board = fenToBoard('8/8/8/3b4/8/8/8/8 w - - 0 1');
  const attacks = getStandardAttackSquares('d5', { type: 'b', color: 'b' }, board);
  assert.ok(attacks.includes('a2'));
  assert.ok(attacks.includes('h1'));
  assert.ok(attacks.includes('g8'));
});

test('standard queen attacks', () => {
  const board = fenToBoard('8/8/8/3q4/8/8/8/8 w - - 0 1');
  const attacks = getStandardAttackSquares('d5', { type: 'q', color: 'b' }, board);
  assert.ok(attacks.includes('d1'));
  assert.ok(attacks.includes('a5'));
  assert.ok(attacks.includes('a2'));
});

test('standard knight attacks', () => {
  const board = fenToBoard('8/8/8/3n4/8/8/8/8 w - - 0 1');
  const attacks = getStandardAttackSquares('d5', { type: 'n', color: 'b' }, board);
  assert.deepEqual(new Set(attacks), new Set(['b4', 'b6', 'c3', 'c7', 'e3', 'e7', 'f4', 'f6']));
});

test('standard pawn attacks', () => {
  const board = new Map();
  assert.deepEqual(getStandardAttackSquares('d4', { type: 'p', color: 'w' }, board), ['c5', 'e5']);
  assert.deepEqual(getStandardAttackSquares('d4', { type: 'p', color: 'b' }, board), ['c3', 'e3']);
});

test('standard king attacks', () => {
  const board = new Map();
  const attacks = getStandardAttackSquares('d4', { type: 'k', color: 'w' }, board);
  assert.equal(attacks.length, 8);
  assert.ok(attacks.includes('e5'));
  assert.ok(attacks.includes('c3'));
});

test('isKingInCheck with normal positions', () => {
  const inCheck = fenToBoard('4k3/8/8/8/4r3/8/8/4K3 w - - 0 1');
  const safe = fenToBoard('4k3/8/8/8/8/8/3r4/4K3 w - - 0 1');
  assert.equal(isKingInCheck(inCheck, 'w', noRules), true);
  assert.equal(isKingInCheck(safe, 'w', noRules), false);
});

test('wouldLeaveKingInCheck catches simple pinned-piece scenario', () => {
  const board = fenToBoard('4r1k1/8/8/8/8/8/4B3/4K3 w - - 0 1');
  assert.equal(wouldLeaveKingInCheck(board, 'e2', 'f3', 'w', noRules), true);
});

test('mutator-aware case: short_stop limits rook check distance', () => {
  const board = fenToBoard('4k3/8/8/8/4r3/8/8/4K3 w - - 0 1');
  const mutatorState = {
    activeRules: [{ rule: { id: 'short_stop' } }],
    boardModifiers: {},
    moveCount: 0,
  };

  assert.equal(isKingInCheck(board, 'w', mutatorState), false);
  const attacks = getAttackSquares('e4', { type: 'r', color: 'b' }, board, mutatorState);
  assert.deepEqual(new Set(attacks), new Set(['d4', 'f4', 'e3', 'e5']));
});
