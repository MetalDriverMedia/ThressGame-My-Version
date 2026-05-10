const test = require('node:test');
const assert = require('node:assert/strict');

const { Chess } = require('chess.js');
const { GameManager, GameRoom } = require('../gameManager');
const { RULES } = require('../mutators/mutatorDefs');
const { createMutatorHandlers } = require('../handlers/mutatorHandler');
const { handleMove } = require('../handlers/moveHandler');
const { validateRoomIntegrity } = require('../utils/roomIntegrity');
const turnClock = require('../utils/turnClock');
const { createIoRecorder, createRegisteredSocket, createSocket } = require('./helpers/moveHandlerTestHelpers');

const roomsToCleanup = new Set();

function getRule(id) {
  const rule = RULES.find((r) => r.id === id);
  assert.ok(rule, `expected rule ${id} to exist`);
  return rule;
}

function setupRoom({ roomCode, fen }) {
  const gameManager = new GameManager();
  const room = new GameRoom(roomCode);
  room.addPlayer({ name: 'White', color: 'w', socketId: 'sock-w', isBot: false });
  room.addPlayer({ name: 'Black', color: 'b', socketId: 'sock-b', isBot: false });
  room.startGame();
  room.chess.load(fen);

  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);
  gameManager.setSocketRoom('sock-b', room.roomCode);

  const whiteSocket = createRegisteredSocket('sock-w');
  const blackSocket = createRegisteredSocket('sock-b');
  const moveSocketWhite = createSocket('sock-w');
  const moveSocketBlack = createSocket('sock-b');
  const { io, roomEvents } = createIoRecorder();

  io.sockets.sockets.set('sock-w', whiteSocket);
  io.sockets.sockets.set('sock-b', blackSocket);

  const handlers = createMutatorHandlers({
    handleMove: async () => {},
    scheduleBotMove: () => {},
    generateBotTarget: () => null,
  });
  handlers.registerSocketHandlers(whiteSocket, io, gameManager);
  handlers.registerSocketHandlers(blackSocket, io, gameManager);

  roomsToCleanup.add(room);
  return { room, gameManager, io, roomEvents, whiteSocket, moveSocketWhite, moveSocketBlack };
}

function setPendingAction(room, ruleId, forPlayer = 'w') {
  const rule = getRule(ruleId);
  room.mutatorState.pendingAction = { ruleId, actionType: rule.choiceType, forPlayer, rule };
}

function assertKingCounts(room) {
  const flat = room.chess.board().flat().filter(Boolean);
  const whiteKings = flat.filter((p) => p.type === 'k' && p.color === 'w').length;
  const blackKings = flat.filter((p) => p.type === 'k' && p.color === 'b').length;
  assert.equal(whiteKings, 1);
  assert.equal(blackKings, 1);
}

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});

test('baseline: two kids places bishop, consumes pawns, records lock, and clears pending state', () => {
  const { room, whiteSocket } = setupRoom({
    roomCode: 'TKT-BASE-1',
    fen: '4k3/8/8/8/8/8/3P1P2/4K3 w - - 0 1',
  });

  setPendingAction(room, 'two_kids_in_a_trenchcoat', 'w');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'd2' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'f2' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'e3' });

  assert.equal(room.chess.get('d2'), undefined);
  assert.equal(room.chess.get('f2'), undefined);
  assert.deepEqual(room.chess.get('e3'), { type: 'b', color: 'w' });
  assert.deepEqual(room.mutatorState.boardModifiers.lockedSquares.map((ls) => ls.square), ['e3']);
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assertKingCounts(room);
  assert.doesNotThrow(() => validateRoomIntegrity(room, 'test:two-kids-baseline'));
});

test('baseline: bottomless pit destroys a non-king moving onto pit and pit persists', async () => {
  const { room, gameManager, io, moveSocketWhite, roomEvents } = setupRoom({
    roomCode: 'TKT-BASE-2',
    fen: '4k3/8/8/8/8/8/4p3/R3K3 w - - 0 1',
  });
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'a2' }];

  await handleMove(io, moveSocketWhite, gameManager, { from: 'a1', to: 'a2' });

  assert.equal(room.chess.get('a2'), undefined);
  assert.deepEqual(room.mutatorState.boardModifiers.bottomlessPits.map((p) => p.square), ['a2']);
  assert.equal(room.status, 'active');
  assert.equal(roomEvents.some((e) => e.name === 'gameEnded' && e.payload?.reason === 'king-destroyed'), false);
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
  assert.doesNotThrow(() => validateRoomIntegrity(room, 'test:bottomless-pit-baseline'));
});

test('baseline: minefield destroys a non-king moving onto mine and consumes mine', async () => {
  const { room, gameManager, io, moveSocketWhite, roomEvents } = setupRoom({
    roomCode: 'TKT-BASE-3',
    fen: '4k3/8/8/8/8/8/4p3/R3K3 w - - 0 1',
  });
  room.mutatorState.boardModifiers.mines = [{ square: 'a2' }];
  room.mutatorState.activeRules.push({ rule: getRule('minefield'), turnsLeft: -1, placedBy: 'w' });

  await handleMove(io, moveSocketWhite, gameManager, { from: 'a1', to: 'a2' });

  assert.equal(room.chess.get('a2'), undefined);
  assert.deepEqual(room.mutatorState.boardModifiers.mines, []);
  assert.equal(room.mutatorState.activeRules.some((r) => r.rule.id === 'minefield'), true);
  assert.equal(room.status, 'active');
  assert.equal(roomEvents.some((e) => e.name === 'gameEnded' && e.payload?.reason === 'king-destroyed'), false);
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
  assert.doesNotThrow(() => validateRoomIntegrity(room, 'test:minefield-baseline'));
});

test('combination: two kids places bishop on bottomless pit, bishop is destroyed immediately, stale lock is cleaned up, pit persists', async () => {
  const { room, gameManager, io, whiteSocket, moveSocketWhite, moveSocketBlack, roomEvents } = setupRoom({
    roomCode: 'TKT-COMBO-1',
    fen: '4k3/8/8/8/8/8/3P1P2/4K2R w - - 0 1',
  });
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'e3' }];

  setPendingAction(room, 'two_kids_in_a_trenchcoat', 'w');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'd2' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'f2' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'e3' });

  assert.equal(room.chess.get('e3'), undefined);
  assert.deepEqual(room.mutatorState.boardModifiers.lockedSquares, []);
  assert.deepEqual(room.mutatorState.boardModifiers.bottomlessPits.map((p) => p.square), ['e3']);

  await handleMove(io, moveSocketWhite, gameManager, { from: 'e3', to: 'f4' });
  const reject = moveSocketWhite.emitted.find((e) => e.name === 'moveRejected');
  assert.deepEqual(reject, { name: 'moveRejected', payload: { error: 'No piece on that square.' } });

  await handleMove(io, moveSocketWhite, gameManager, { from: 'h1', to: 'h2' });
  await handleMove(io, moveSocketBlack, gameManager, { from: 'e8', to: 'f8' });

  assert.deepEqual(room.mutatorState.boardModifiers.lockedSquares, []);
  assert.equal(roomEvents.some((e) => e.name === 'gameEnded' && e.payload?.reason === 'king-destroyed'), false);
  assert.equal(room.status, 'active');
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
  assertKingCounts(room);
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.equal(room.mutatorState.pendingChoice?.chooser, 'w');
  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.doesNotThrow(() => validateRoomIntegrity(room, 'test:two-kids-bottomless-pit-combo'));
});

test('combination: two kids places bishop on minefield, bishop is destroyed immediately, stale lock is cleaned up, mine is consumed', async () => {
  const { room, gameManager, io, whiteSocket, moveSocketWhite, moveSocketBlack, roomEvents } = setupRoom({
    roomCode: 'TKT-COMBO-2',
    fen: '4k3/8/8/8/8/8/3P1P2/4K2R w - - 0 1',
  });
  room.mutatorState.boardModifiers.mines = [{ square: 'e3' }];
  room.mutatorState.activeRules.push({ rule: getRule('minefield'), turnsLeft: -1, placedBy: 'w' });

  setPendingAction(room, 'two_kids_in_a_trenchcoat', 'w');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'd2' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'f2' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'e3' });

  assert.equal(room.chess.get('e3'), undefined);
  assert.deepEqual(room.mutatorState.boardModifiers.lockedSquares, []);
  assert.deepEqual(room.mutatorState.boardModifiers.mines.map((m) => m.square), []);
  assert.equal(room.mutatorState.activeRules.some((r) => r.rule.id === 'minefield'), true);

  await handleMove(io, moveSocketWhite, gameManager, { from: 'e3', to: 'f4' });
  const reject = moveSocketWhite.emitted.find((e) => e.name === 'moveRejected');
  assert.deepEqual(reject, { name: 'moveRejected', payload: { error: 'No piece on that square.' } });

  await handleMove(io, moveSocketWhite, gameManager, { from: 'h1', to: 'h2' });
  await handleMove(io, moveSocketBlack, gameManager, { from: 'e8', to: 'f8' });

  assert.deepEqual(room.mutatorState.boardModifiers.lockedSquares, []);
  assert.equal(roomEvents.some((e) => e.name === 'gameEnded' && e.payload?.reason === 'king-destroyed'), false);
  assert.equal(room.status, 'active');
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
  assertKingCounts(room);
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.equal(room.mutatorState.pendingChoice?.chooser, 'w');
  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.doesNotThrow(() => validateRoomIntegrity(room, 'test:two-kids-minefield-combo'));
});
