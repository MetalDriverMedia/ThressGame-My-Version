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
