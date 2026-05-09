const test = require('node:test');
const assert = require('node:assert/strict');

const { GameRoom } = require('../gameManager');
const { createMutatorState } = require('../mutators/mutatorEngine');
const { getEffectiveLegalMoves } = require('../mutators/legalMoveEngine');
const { getBotMovePool } = require('../botManager');

test('bot move pool matches legalMoveEngine output in a normal position', () => {
  const room = new GameRoom('BOT01');
  room.chess.move('e4');
  room.chess.move('e5');
  room.mutatorState = createMutatorState();

  const expected = getEffectiveLegalMoves(room, room.chess.turn(), { syntheticMovesBeforeRestrictions: true });
  const actual = getBotMovePool(room, room.chess.turn());

  const expectedPairs = new Set(expected.map(m => `${m.from}-${m.to}`));
  const actualPairs = new Set(actual.map(m => `${m.from}-${m.to}`));
  assert.deepEqual(actualPairs, expectedPairs);
});

test('bot move pool does not contain duplicate from-to entries', () => {
  const room = new GameRoom('BOT02');
  room.mutatorState = createMutatorState();

  const moves = getBotMovePool(room, room.chess.turn());
  const pairs = moves.map(m => `${m.from}-${m.to}`);
  assert.equal(new Set(pairs).size, pairs.length);
});

test('bot move pool respects hobbit_battle restriction via legalMoveEngine', () => {
  const room = new GameRoom('BOT03');
  room.chess.load('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  room.mutatorState = createMutatorState();
  room.mutatorState.activeRules.push({ rule: { id: 'hobbit_battle' } });

  const moves = getBotMovePool(room, 'w');
  assert.equal(moves.length, 0);
});

test('bot move pool uses synthetic-before-restrictions behavior', () => {
  const room = new GameRoom('BOT04');
  room.chess.load('4k3/8/8/8/8/8/8/1N2K3 w - - 0 1');
  room.mutatorState = createMutatorState();
  room.mutatorState.activeRules.push({ rule: { id: 'short_stop' } });
  room.mutatorState.activeRules.push({ rule: { id: 'hobbit_battle' } });

  const defaultMoves = getEffectiveLegalMoves(room, 'w');
  const botMoves = getBotMovePool(room, 'w');

  assert.ok(defaultMoves.some(m => m.from === 'b1' && m.to === 'b2'));
  assert.equal(botMoves.length, 0);
});

test('bot move pool includes Pacman wrap moves for pacman_style', () => {
  const room = new GameRoom('BOT05');
  room.chess.load('4k3/8/7n/P7/8/8/8/4K3 w - - 0 1');
  room.mutatorState = createMutatorState();
  room.mutatorState.activeRules.push({ rule: { id: 'pacman_style' } });

  const moves = getBotMovePool(room, 'w');
  const wrapMove = moves.find(m => m.from === 'a5' && m.to === 'h6');

  assert.ok(wrapMove);
  assert.equal(wrapMove.from, 'a5');
  assert.equal(wrapMove.to, 'h6');
});

test('bot move pool includes short_stop synthetic moves and remains deduped', () => {
  const room = new GameRoom('BOT06');
  room.chess.load('7k/8/8/8/8/8/8/1N2K3 w - - 0 1');
  room.mutatorState = createMutatorState();
  room.mutatorState.activeRules.push({ rule: { id: 'short_stop' } });

  const moves = getBotMovePool(room, 'w');
  const syntheticMove = moves.find(m => m.from === 'b1' && m.to === 'b2');
  const pairs = moves.map(m => `${m.from}->${m.to}`);

  assert.ok(syntheticMove);
  assert.equal(syntheticMove.from, 'b1');
  assert.equal(syntheticMove.to, 'b2');
  assert.equal(new Set(pairs).size, pairs.length);
});

test('bot move pool characterization: locked source squares are not filtered at move-pool level', () => {
  const room = new GameRoom('BOT07');
  room.chess.load('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
  room.mutatorState = createMutatorState();
  room.mutatorState.boardModifiers.lockedSquares.push({ square: 'e2' });

  const moves = getBotMovePool(room, 'w');

  assert.ok(moves.some(m => m.from === 'e2'));
});

test('bot move pool characterization: mutator-aware self-check filtering is not enforced at move-pool level', () => {
  const room = new GameRoom('BOT08');
  room.chess.load('7k/8/8/8/8/8/4n3/R3K3 w - - 0 1');
  room.mutatorState = createMutatorState();
  room.mutatorState.activeRules.push({ rule: { id: 'short_stop' } });

  const moves = getBotMovePool(room, 'w');

  assert.equal(moves.some(m => m.from === 'a1' && m.to === 'a2'), true);
});

test('bot move pool includes pseudo-legal board move when chess.js inCheck is faked but mutator-aware check is clear', () => {
  const room = new GameRoom('BOT09');
  room.chess.load('7k/8/8/8/8/8/8/R3K3 w - - 0 1');
  room.mutatorState = createMutatorState();
  room.mutatorState.activeRules.push({ rule: { id: 'short_stop' } });
  const originalInCheck = room.chess.inCheck.bind(room.chess);
  room.chess.inCheck = () => true;

  try {
    const moves = getBotMovePool(room, 'w');
    assert.ok(moves.some(m => m.from === 'a1' && m.to === 'a2'));
  } finally {
    room.chess.inCheck = originalInCheck;
  }
});


test.skip('bot move pool dedupe when normal and synthetic moves overlap (deferred fixture)', () => {
  // Deferred: no stable, minimal fixture currently guarantees a deterministic
  // normal+synthetic exact from/to overlap without coupling to mutator internals.
  // Existing dedupe coverage remains in place for baseline and short_stop scenarios.
});
