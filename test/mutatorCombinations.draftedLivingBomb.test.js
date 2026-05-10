const test = require('node:test');
const assert = require('node:assert/strict');

const { Chess } = require('chess.js');
const { GameManager, GameRoom } = require('../gameManager');
const { createMutatorHandlers } = require('../handlers/mutatorHandler');
const { handleMove } = require('../handlers/moveHandler');
const { RULES } = require('../mutators/mutatorDefs');
const { getEffectiveLegalMoves } = require('../mutators/legalMoveEngine');
const { validateRoomIntegrity } = require('../utils/roomIntegrity');
const turnClock = require('../utils/turnClock');
const { createIoRecorder, createRegisteredSocket } = require('./helpers/moveHandlerTestHelpers');

const roomsToCleanup = new Set();

function getRule(id) {
  const rule = RULES.find((r) => r.id === id);
  assert.ok(rule, `expected rule ${id} to exist`);
  return rule;
}

function createRoom({ roomCode, fen }) {
  const gameManager = new GameManager();
  const room = new GameRoom(roomCode);
  room.addPlayer({ name: 'White', color: 'w', socketId: 'sock-w', isBot: false });
  room.addPlayer({ name: 'Black', color: 'b', socketId: 'sock-b', isBot: false });
  room.startGame();
  room.chess.load(fen);
  roomsToCleanup.add(room);

  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);
  gameManager.setSocketRoom('sock-b', room.roomCode);

  const whiteSocket = createRegisteredSocket('sock-w');
  const blackSocket = createRegisteredSocket('sock-b');
  const { io, roomEvents } = createIoRecorder();
  io.sockets.sockets.set('sock-w', whiteSocket);
  io.sockets.sockets.set('sock-b', blackSocket);

  const handlers = createMutatorHandlers({ handleMove, scheduleBotMove: () => {}, generateBotTarget: () => null });
  handlers.registerSocketHandlers(whiteSocket, io, gameManager);
  handlers.registerSocketHandlers(blackSocket, io, gameManager);

  return { room, gameManager, io, roomEvents, whiteSocket, blackSocket };
}

function setPending(room, ruleId, forPlayer = 'w') {
  const rule = getRule(ruleId);
  room.mutatorState.pendingAction = { ruleId, actionType: rule.choiceType, forPlayer, rule };
}

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});

test('baseline living bomb activation records marker, active rule, and valid board state', () => {
  const { room, whiteSocket } = createRoom({ roomCode: 'DLB-1', fen: '4k3/8/8/8/8/8/3P4/4K3 w - - 0 1' });
  setPending(room, 'living_bomb');

  whiteSocket.trigger('mutatorActionResponse', { targets: 'd2' });

  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.ok(room.mutatorState.activeRules.some((ar) => ar.rule.id === 'living_bomb'));
  assert.deepEqual(room.mutatorState.boardModifiers.livingBombs, [{ square: 'd2', piece: 'p', expiresAtMove: room.mutatorState.activeRules.find((ar) => ar.rule.id === 'living_bomb').expiresAtMove }]);
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
  assert.deepEqual(room.chess.get('e1'), { type: 'k', color: 'w' });
  assert.deepEqual(room.chess.get('e8'), { type: 'k', color: 'b' });
  assert.equal(validateRoomIntegrity(room, 'test:dlb-baseline'), true);
});

test('living bomb ignores off-board target, accepts empty square as null marker, and blocks king target', () => {
  const { room, whiteSocket } = createRoom({ roomCode: 'DLB-2', fen: '4k3/8/8/8/8/8/3P4/4K3 w - - 0 1' });
  setPending(room, 'living_bomb');

  whiteSocket.trigger('mutatorActionResponse', { targets: 'z9' });
  assert.equal(room.mutatorState.pendingAction.ruleId, 'living_bomb');
  assert.equal(room.mutatorState.boardModifiers.livingBombs.length, 0);

  whiteSocket.trigger('mutatorActionResponse', { targets: 'd4' });
  assert.equal(room.mutatorState.pendingAction, null);
  assert.deepEqual(room.mutatorState.boardModifiers.livingBombs[0], { square: 'd4', piece: null, expiresAtMove: room.mutatorState.activeRules.find((ar) => ar.rule.id === 'living_bomb').expiresAtMove });

  setPending(room, 'living_bomb');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'e1' });
  assert.equal(room.mutatorState.pendingAction.ruleId, 'living_bomb');
  assert.equal(room.mutatorState.boardModifiers.livingBombs.length, 1);
});

test('baseline drafted for battle swaps selected bishop/knight with each king', () => {
  const { room, whiteSocket, blackSocket } = createRoom({ roomCode: 'DLB-3', fen: '4k3/6n1/8/8/8/8/6B1/4K3 w - - 0 1' });
  setPending(room, 'drafted_for_battle');

  whiteSocket.trigger('mutatorActionResponse', { targets: 'g2' });
  blackSocket.trigger('mutatorActionResponse', { targets: 'g7' });

  assert.deepEqual(room.chess.get('g2'), { type: 'k', color: 'w' });
  assert.deepEqual(room.chess.get('e1'), { type: 'b', color: 'w' });
  assert.deepEqual(room.chess.get('g7'), { type: 'k', color: 'b' });
  assert.deepEqual(room.chess.get('e8'), { type: 'n', color: 'b' });
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
  assert.equal(validateRoomIntegrity(room, 'test:dlb-drafted-baseline'), true);
});

test('living bomb target then drafted keeps marker on original square with original piece metadata', () => {
  const { room, whiteSocket, blackSocket } = createRoom({ roomCode: 'DLB-4', fen: '4k3/6n1/8/8/8/8/6B1/4K3 w - - 0 1' });

  setPending(room, 'living_bomb');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'g2' });
  assert.equal(room.mutatorState.boardModifiers.livingBombs[0].square, 'g2');

  setPending(room, 'drafted_for_battle');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'g2' });
  blackSocket.trigger('mutatorActionResponse', { targets: 'g7' });

  assert.deepEqual(room.chess.get('g2'), { type: 'k', color: 'w' });
  assert.deepEqual(room.chess.get('e1'), { type: 'b', color: 'w' });

  assert.equal(room.mutatorState.boardModifiers.livingBombs[0].square, 'g2');
  assert.equal(room.mutatorState.boardModifiers.livingBombs[0].piece, 'b');
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.equal(validateRoomIntegrity(room, 'test:dlb-bomb-then-drafted'), true);
});

test('drafted first then living bomb targets relocated piece at final square', () => {
  const { room, whiteSocket, blackSocket } = createRoom({ roomCode: 'DLB-5', fen: '4k3/6n1/8/8/8/8/6B1/4K3 w - - 0 1' });

  setPending(room, 'drafted_for_battle');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'g2' });
  blackSocket.trigger('mutatorActionResponse', { targets: 'g7' });

  setPending(room, 'living_bomb');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'e1' });

  assert.deepEqual(room.chess.get('e1'), { type: 'b', color: 'w' });
  assert.deepEqual(room.mutatorState.boardModifiers.livingBombs[0], {
    square: 'e1',
    piece: 'b',
    expiresAtMove: room.mutatorState.activeRules.find((ar) => ar.rule.id === 'living_bomb').expiresAtMove,
  });
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.equal(room.mutatorState.pendingChoice, null);
  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
});

test('expiry path: living bomb on drafted king remains stable with no false explosion during normal moves', async () => {
  const { room, gameManager, io, whiteSocket, blackSocket, roomEvents } = createRoom({ roomCode: 'DLB-6', fen: '4k3/6n1/8/8/8/8/6B1/4K3 w - - 0 1' });

  setPending(room, 'living_bomb');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'g2' });
  setPending(room, 'drafted_for_battle');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'g2' });
  blackSocket.trigger('mutatorActionResponse', { targets: 'g7' });

  const before = structuredClone(room.mutatorState.boardModifiers.livingBombs[0]);

  await handleMove(io, whiteSocket, gameManager, { from: 'e1', to: 'f2' });

  assert.equal(room.mutatorState.boardModifiers.livingBombs.length, 1);
  assert.deepEqual(room.mutatorState.boardModifiers.livingBombs[0], before);
  assert.deepEqual(room.chess.get('g2'), { type: 'k', color: 'w' });
  assert.deepEqual(room.chess.get('e8'), { type: 'n', color: 'b' });
  assert.equal(roomEvents.filter((e) => e.name === 'gameEnded').length, 0);
  assert.equal(validateRoomIntegrity(room, 'test:dlb-expiry-king-safe'), true);
});

test('legal move and stale-square sanity after drafted + living bomb', async () => {
  const { room, gameManager, io, whiteSocket, blackSocket } = createRoom({ roomCode: 'DLB-7', fen: '4k3/6n1/8/8/8/8/6B1/4K3 w - - 0 1' });

  setPending(room, 'drafted_for_battle');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'g2' });
  blackSocket.trigger('mutatorActionResponse', { targets: 'g7' });
  setPending(room, 'living_bomb');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'e1' });

  const legal = getEffectiveLegalMoves(room, 'w');
  assert.equal(legal.some((m) => m.from === 'g2'), true);
  assert.equal(legal.some((m) => m.from === 'e1'), true);

  await handleMove(io, whiteSocket, gameManager, { from: 'g2', to: 'f2' });
  assert.equal(room.chess.get('g2'), undefined);
  assert.deepEqual(room.chess.get('f2'), { type: 'k', color: 'w' });

  await handleMove(io, blackSocket, gameManager, { from: 'g7', to: 'f5' });
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.equal(room.mutatorState.pendingChoice, null);
  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
});
