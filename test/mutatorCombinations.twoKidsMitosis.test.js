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
  return { room, gameManager, io, roomEvents, whiteSocket, blackSocket, moveSocketWhite, moveSocketBlack };
}

function setPendingAction(room, ruleId, forPlayer = 'w') {
  const rule = getRule(ruleId);
  room.mutatorState.pendingAction = { ruleId, actionType: rule.choiceType, forPlayer, rule };
}

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});

test('two kids baseline places bishop, records lock, and rejects same-turn bishop move', async () => {
  const { room, gameManager, io, roomEvents, whiteSocket, moveSocketWhite } = setupRoom({
    roomCode: 'TKM-1',
    fen: '4k3/8/8/8/8/8/PP2P3/4K3 w - - 0 1',
  });

  setPendingAction(room, 'two_kids_in_a_trenchcoat', 'w');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'a2' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'b2' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'c3' });

  assert.equal(room.chess.get('a2'), undefined);
  assert.equal(room.chess.get('b2'), undefined);
  assert.deepEqual(room.chess.get('c3'), { type: 'b', color: 'w' });
  assert.deepEqual(room.mutatorState.boardModifiers.lockedSquares, [{ square: 'c3' }]);

  await handleMove(io, moveSocketWhite, gameManager, { from: 'c3', to: 'd4' });

  assert.deepEqual(moveSocketWhite.emitted[0], { name: 'moveRejected', payload: { message: "That piece can't move on the same turn it was placed." } });
  assert.equal(roomEvents.some((e) => e.name === 'moveApplied'), false);
});

test('two kids lock clears after successful move and bishop can move later', async () => {
  const { room, gameManager, io, roomEvents, whiteSocket, moveSocketWhite, moveSocketBlack } = setupRoom({
    roomCode: 'TKM-2',
    fen: '4k3/8/8/8/8/8/PP2P3/4K2R w - - 0 1',
  });

  setPendingAction(room, 'two_kids_in_a_trenchcoat', 'w');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'a2' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'b2' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'c3' });

  await handleMove(io, moveSocketWhite, gameManager, { from: 'h1', to: 'h2' });
  assert.ok(roomEvents.find((e) => e.name === 'moveApplied' && e.payload.from === 'h1' && e.payload.to === 'h2'));
  assert.deepEqual(room.mutatorState.boardModifiers.lockedSquares, []);

  await handleMove(io, moveSocketBlack, gameManager, { from: 'e8', to: 'f8' });
  await handleMove(io, moveSocketWhite, gameManager, { from: 'c3', to: 'a1' });
  assert.ok(roomEvents.find((e) => e.name === 'moveApplied' && e.payload.from === 'c3' && e.payload.to === 'a1'));
});

test('mitosis baseline stores target, blocks movement, and duplicates once on expiry', async () => {
  const { room, gameManager, io, roomEvents, whiteSocket, moveSocketWhite, moveSocketBlack } = setupRoom({
    roomCode: 'TKM-3',
    fen: '4k3/8/8/3N4/8/8/8/4K2R w - - 0 1',
  });

  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    setPendingAction(room, 'mitosis', 'w');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'd5' });
  } finally {
    Math.random = originalRandom;
  }

  const active = room.mutatorState.activeRules.find((ar) => ar.rule.id === 'mitosis');
  assert.ok(active);
  assert.equal(active.choiceData, 'd5');

  await handleMove(io, moveSocketWhite, gameManager, { from: 'd5', to: 'e7' });
  assert.deepEqual(moveSocketWhite.emitted[0], { name: 'moveRejected', payload: { error: 'Move blocked by active rule.' } });

  await handleMove(io, moveSocketWhite, gameManager, { from: 'h1', to: 'h2' });
  await handleMove(io, moveSocketBlack, gameManager, { from: 'e8', to: 'f8' });
  await handleMove(io, moveSocketWhite, gameManager, { from: 'h2', to: 'h1' });

  const knights = ['c4', 'c5', 'c6', 'd4', 'd5', 'd6', 'e4', 'e5', 'e6'].filter((sq) => {
    const p = room.chess.get(sq);
    return p && p.type === 'n' && p.color === 'w';
  });
  assert.deepEqual(knights, ['c4', 'd5']);
  assert.equal(roomEvents.filter((e) => e.name === 'mutatorExpired' && e.payload.ruleId === 'mitosis').length, 1);
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
});

test('combination allows mitosis targeting two-kids bishop and duplicates it on expiry', async () => {
  const { room, gameManager, io, roomEvents, whiteSocket, moveSocketWhite, moveSocketBlack } = setupRoom({
    roomCode: 'TKM-4',
    fen: '4k3/8/8/8/8/8/PP2P3/4K2R w - - 0 1',
  });

  setPendingAction(room, 'two_kids_in_a_trenchcoat', 'w');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'a2' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'b2' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'c3' });

  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    setPendingAction(room, 'mitosis', 'w');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'c3' });
  } finally {
    Math.random = originalRandom;
  }

  const mitosisRule = room.mutatorState.activeRules.find((ar) => ar.rule.id === 'mitosis');
  assert.ok(mitosisRule);
  assert.equal(mitosisRule.choiceData, 'c3');

  await handleMove(io, moveSocketWhite, gameManager, { from: 'c3', to: 'd4' });
  assert.deepEqual(moveSocketWhite.emitted[0], { name: 'moveRejected', payload: { message: "That piece can't move on the same turn it was placed." } });

  await handleMove(io, moveSocketWhite, gameManager, { from: 'h1', to: 'h2' });
  await handleMove(io, moveSocketBlack, gameManager, { from: 'e8', to: 'f8' });
  await handleMove(io, moveSocketWhite, gameManager, { from: 'h2', to: 'h1' });

  const bishops = ['b2', 'b3', 'b4', 'c2', 'c3', 'c4', 'd2', 'd3', 'd4'].filter((sq) => {
    const p = room.chess.get(sq);
    return p && p.type === 'b' && p.color === 'w';
  });
  assert.deepEqual(bishops, ['c3', 'd2']);
});

test('two kids activation while mitosis tracks another piece preserves mitosis target and expiry', async () => {
  const { room, gameManager, io, whiteSocket, moveSocketWhite, moveSocketBlack } = setupRoom({
    roomCode: 'TKM-5',
    fen: '4k3/8/8/8/8/8/PP1PP3/4K2R w - - 0 1',
  });

  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    setPendingAction(room, 'mitosis', 'w');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'd2' });
  } finally {
    Math.random = originalRandom;
  }

  setPendingAction(room, 'two_kids_in_a_trenchcoat', 'w');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'a2' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'b2' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'c3' });

  const mitosisRule = room.mutatorState.activeRules.find((ar) => ar.rule.id === 'mitosis');
  assert.equal(mitosisRule.choiceData, 'd2');
  assert.deepEqual(room.chess.get('c3'), { type: 'b', color: 'w' });

  await handleMove(io, moveSocketWhite, gameManager, { from: 'h1', to: 'h2' });
  await handleMove(io, moveSocketBlack, gameManager, { from: 'e8', to: 'f8' });

  assert.deepEqual(room.chess.get('e3'), { type: 'p', color: 'w' });
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
});

test('expiry + lock ordering resolves once, with no stale lock or repeated duplication', async () => {
  const { room, gameManager, io, roomEvents, whiteSocket, moveSocketWhite, moveSocketBlack } = setupRoom({
    roomCode: 'TKM-6',
    fen: '4k3/8/8/8/8/8/PP1PP3/4K2R w - - 0 1',
  });

  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    setPendingAction(room, 'mitosis', 'w');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'd2' });
  } finally {
    Math.random = originalRandom;
  }
  setPendingAction(room, 'two_kids_in_a_trenchcoat', 'w');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'a2' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'b2' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'c3' });

  await handleMove(io, moveSocketWhite, gameManager, { from: 'h1', to: 'h2' });
  assert.deepEqual(room.mutatorState.boardModifiers.lockedSquares, []);
  await handleMove(io, moveSocketBlack, gameManager, { from: 'e8', to: 'f8' });
  await handleMove(io, moveSocketWhite, gameManager, { from: 'h2', to: 'h1' });

  const expiries = roomEvents.filter((e) => e.name === 'mutatorExpired' && e.payload.ruleId === 'mitosis');
  assert.equal(expiries.length, 1);
  assert.deepEqual(room.chess.get('e3'), { type: 'p', color: 'w' });

  await handleMove(io, moveSocketWhite, gameManager, { from: 'c3', to: 'd4' });
  await handleMove(io, moveSocketBlack, gameManager, { from: 'f8', to: 'e8' });
  assert.deepEqual(room.chess.get('c1'), { type: 'p', color: 'w' });
});

test('board integrity and pending-state sanity after two-kids + mitosis resolution', async () => {
  const { room, gameManager, io, whiteSocket, moveSocketWhite, moveSocketBlack } = setupRoom({
    roomCode: 'TKM-7',
    fen: '4k3/8/8/8/8/8/PP1PP3/4K2R w - - 0 1',
  });

  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    setPendingAction(room, 'mitosis', 'w');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'd2' });
  } finally {
    Math.random = originalRandom;
  }
  setPendingAction(room, 'two_kids_in_a_trenchcoat', 'w');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'a2' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'b2' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'c3' });

  await handleMove(io, moveSocketWhite, gameManager, { from: 'h1', to: 'h2' });
  await handleMove(io, moveSocketBlack, gameManager, { from: 'e8', to: 'f8' });

  assert.doesNotThrow(() => validateRoomIntegrity(room, 'test:two-kids-mitosis'));
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
  assert.deepEqual(room.chess.get('e1'), { type: 'k', color: 'w' });
  assert.deepEqual(room.chess.get('f8'), { type: 'k', color: 'b' });
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
});
