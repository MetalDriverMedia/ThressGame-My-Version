const test = require('node:test');
const assert = require('node:assert/strict');

const { GameRoom } = require('../gameManager');
const { createMutatorState } = require('../mutators/mutatorEngine');
const { getEffectiveLegalMoves } = require('../mutators/legalMoveEngine');
const { checkMutatorDeadlock } = require('../utils/gameLifecycle');

test('getEffectiveLegalMoves matches chess.js legal moves in a basic position', () => {
  const room = new GameRoom('TST01');
  room.chess.move('e4');
  room.chess.move('e5');
  room.mutatorState = createMutatorState();

  const expected = room.chess.moves({ verbose: true });
  const actual = getEffectiveLegalMoves(room, room.chess.turn());

  const expectedPairs = new Set(expected.map(m => `${m.from}-${m.to}`));
  const actualPairs = new Set(actual.map(m => `${m.from}-${m.to}`));
  assert.deepEqual(actualPairs, expectedPairs);
});

test('getEffectiveLegalMoves does not return duplicate normal moves', () => {
  const room = new GameRoom('TST02');
  room.mutatorState = createMutatorState();

  const moves = getEffectiveLegalMoves(room, room.chess.turn());
  const pairs = moves.map(m => `${m.from}-${m.to}`);
  assert.equal(new Set(pairs).size, pairs.length);
});

test('restriction filtering still applies via legalMoveEngine (hobbit_battle)', () => {
  const room = new GameRoom('TST03');
  room.chess.load('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  room.mutatorState = createMutatorState();
  room.mutatorState.activeRules.push({ rule: { id: 'hobbit_battle' } });

  const moves = getEffectiveLegalMoves(room, 'w');
  assert.equal(moves.length, 0);
});

test('checkMutatorDeadlock still works through delegated legal move engine path', () => {
  const room = new GameRoom('TST04');
  room.status = 'active';
  room.chess.load('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  room.mutatorState = createMutatorState();
  room.mutatorState.activeRules.push({ rule: { id: 'hobbit_battle' } });

  const events = [];
  const io = {
    to() {
      return { emit: (name) => events.push(name) };
    },
  };
  const gameManager = { deleteRoom() {} };

  const ended = checkMutatorDeadlock(room, io, gameManager);
  assert.equal(ended, true);
  assert.equal(room.endReason, 'stalemate');
  assert.ok(events.includes('gameEnded'));
});

test('syntheticMovesBeforeRestrictions option applies restrictions to synthetic moves', () => {
  const room = new GameRoom('TST05');
  room.chess.load('4k3/8/8/8/8/8/8/1N2K3 w - - 0 1');
  room.mutatorState = createMutatorState();
  room.mutatorState.activeRules.push({ rule: { id: 'short_stop' } });
  room.mutatorState.activeRules.push({ rule: { id: 'hobbit_battle' } });

  const defaultMoves = getEffectiveLegalMoves(room, 'w');
  const preRestrictionMoves = getEffectiveLegalMoves(room, 'w', { syntheticMovesBeforeRestrictions: true });

  assert.ok(defaultMoves.some(m => m.from === 'b1' && m.to === 'b2'));
  assert.equal(preRestrictionMoves.length, 0);
});
