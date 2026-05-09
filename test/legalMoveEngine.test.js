const test = require('node:test');
const assert = require('node:assert/strict');

const { GameRoom } = require('../gameManager');
const { createMutatorState } = require('../mutators/mutatorEngine');
const { getEffectiveLegalMoves, isMoveAllowed } = require('../mutators/legalMoveEngine');
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


test('isMoveAllowed returns allowed true for a normal legal move', () => {
  const room = new GameRoom('TST06');
  room.mutatorState = createMutatorState();

  const result = isMoveAllowed(room, 'w', 'e2', 'e4');
  assert.equal(result.allowed, true);
  assert.equal(result.matchedMove.from, 'e2');
  assert.equal(result.matchedMove.to, 'e4');
});

test('isMoveAllowed returns allowed false for an illegal move', () => {
  const room = new GameRoom('TST07');
  room.mutatorState = createMutatorState();

  const result = isMoveAllowed(room, 'w', 'e2', 'e5');
  assert.deepEqual(result, {
    allowed: false,
    reason: 'not_in_effective_legal_moves',
  });
});

test('isMoveAllowed matchedMove agrees with getEffectiveLegalMoves', () => {
  const room = new GameRoom('TST08');
  room.chess.move('e4');
  room.mutatorState = createMutatorState();

  const moves = getEffectiveLegalMoves(room, 'b');
  const target = moves.find(m => m.from === 'e7' && m.to === 'e5');
  assert.ok(target);

  const result = isMoveAllowed(room, 'b', 'e7', 'e5');
  assert.equal(result.allowed, true);
  assert.deepEqual(result.matchedMove, target);
});

test('isMoveAllowed handles promotion matching', () => {
  const room = new GameRoom('TST09');
  room.chess.load('4k3/6P1/8/8/8/8/8/4K3 w - - 0 1');
  room.mutatorState = createMutatorState();

  const queenPromotion = isMoveAllowed(room, 'w', 'g7', 'g8', 'q');
  const rookPromotion = isMoveAllowed(room, 'w', 'g7', 'g8', 'r');
  const missingPromotion = isMoveAllowed(room, 'w', 'g7', 'g8');

  assert.equal(queenPromotion.allowed, true);
  assert.equal(queenPromotion.matchedMove.promotion, 'q');
  assert.equal(rookPromotion.allowed, true);
  assert.equal(rookPromotion.matchedMove.promotion, 'r');
  assert.equal(missingPromotion.allowed, false);
});

test('isMoveAllowed respects hobbit_battle restriction', () => {
  const room = new GameRoom('TST10');
  room.chess.load('4k3/8/8/8/8/8/8/1N2K3 w - - 0 1');
  room.mutatorState = createMutatorState();
  room.mutatorState.activeRules.push({ rule: { id: 'hobbit_battle' } });

  const result = isMoveAllowed(room, 'w', 'b1', 'c3');
  assert.deepEqual(result, {
    allowed: false,
    reason: 'not_in_effective_legal_moves',
  });
});

test('isMoveAllowed supports syntheticMovesBeforeRestrictions option', () => {
  const room = new GameRoom('TST11');
  room.chess.load('4k3/8/8/8/8/8/8/1N2K3 w - - 0 1');
  room.mutatorState = createMutatorState();
  room.mutatorState.activeRules.push({ rule: { id: 'short_stop' } });
  room.mutatorState.activeRules.push({ rule: { id: 'hobbit_battle' } });

  const defaultResult = isMoveAllowed(room, 'w', 'b1', 'b2');
  const preRestrictionResult = isMoveAllowed(room, 'w', 'b1', 'b2', undefined, {
    syntheticMovesBeforeRestrictions: true,
  });

  assert.equal(defaultResult.allowed, true);
  assert.equal(preRestrictionResult.allowed, false);
});
