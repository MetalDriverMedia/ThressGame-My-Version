const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fenToBoard,
  boardToFenPlacement,
  offsetSquare,
  getIntermediateSquares,
  isSquareHardBlocked,
  findNearestValidSquare,
} = require('../mutators/boardUtils');

test('fenToBoard parses starting position correctly', () => {
  const board = fenToBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  assert.equal(board.size, 32);
  assert.deepEqual(board.get('a1'), { type: 'r', color: 'w' });
  assert.deepEqual(board.get('e1'), { type: 'k', color: 'w' });
  assert.deepEqual(board.get('d8'), { type: 'q', color: 'b' });
  assert.equal(board.has('e4'), false);
});

test('boardToFenPlacement rebuilds expected placement', () => {
  const placement = 'r1bqkbnr/pppp1ppp/2n5/4p3/3P4/5N2/PPP1PPPP/RNBQKB1R';
  const board = fenToBoard(`${placement} w KQkq - 0 1`);
  assert.equal(boardToFenPlacement(board), placement);
});

test('offsetSquare handles valid and out-of-bounds offsets', () => {
  assert.equal(offsetSquare('d4', 1, 2), 'e6');
  assert.equal(offsetSquare('a1', -1, 0), null);
  assert.equal(offsetSquare('h8', 0, 1), null);
});

test('getIntermediateSquares covers rook/bishop/queen/knight/one-square patterns', () => {
  assert.deepEqual(getIntermediateSquares('a1', 'a8'), ['a2', 'a3', 'a4', 'a5', 'a6', 'a7']);
  assert.deepEqual(getIntermediateSquares('a1', 'h8'), ['b2', 'c3', 'd4', 'e5', 'f6', 'g7']);
  assert.deepEqual(getIntermediateSquares('d1', 'h5'), ['e2', 'f3', 'g4']);
  assert.deepEqual(getIntermediateSquares('b1', 'c3'), []);
  assert.deepEqual(getIntermediateSquares('e2', 'e3'), []);
});

test('isSquareHardBlocked respects blockedSquares and no_mans_land', () => {
  const room = {
    mutatorState: {
      boardModifiers: {
        blockedSquares: [{ square: 'd4' }],
      },
      activeRules: [
        { rule: { id: 'no_mans_land' }, choiceData: 4 }, // file e
      ],
    },
  };

  assert.equal(isSquareHardBlocked(room, 'd4'), true);
  assert.equal(isSquareHardBlocked(room, 'e2'), true);
  assert.equal(isSquareHardBlocked(room, 'f2'), false);
});

test('findNearestValidSquare returns a valid unblocked empty square', () => {
  const board = new Map([
    ['d4', { type: 'p', color: 'w' }],
    ['e4', { type: 'p', color: 'b' }],
  ]);
  const room = {
    mutatorState: {
      boardModifiers: {
        blockedSquares: [{ square: 'd5' }, { square: 'c4' }],
      },
      activeRules: [{ rule: { id: 'no_mans_land' }, choiceData: 'e' }],
    },
  };

  const sq = findNearestValidSquare(room, board, 'd4', 'a1');
  assert.ok(sq);
  assert.equal(board.has(sq), false);
  assert.equal(isSquareHardBlocked(room, sq), false);
});
