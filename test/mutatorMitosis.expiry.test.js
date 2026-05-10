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
  room.disabledMutators = RULES.map((r) => r.id);

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

async function playExpiryMoves(io, gameManager, moveSocketWhite, moveSocketBlack) {
  await handleMove(io, moveSocketWhite, gameManager, { from: 'h1', to: 'h2' });
  await handleMove(io, moveSocketBlack, gameManager, { from: 'e8', to: 'f8' });
  await handleMove(io, moveSocketWhite, gameManager, { from: 'h2', to: 'h1' });
  await handleMove(io, moveSocketBlack, gameManager, { from: 'f8', to: 'e8' });
}

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});

test('activation stores mitosis target in activeRules.choiceData and clears pending action', () => {
  const { room, whiteSocket } = setupRoom({ roomCode: 'ME-1', fen: '4k3/8/8/3N4/8/8/8/4K2R w - - 0 1' });
  setPendingAction(room, 'mitosis', 'w');

  whiteSocket.trigger('mutatorActionResponse', { targets: 'd5' });

  const active = room.mutatorState.activeRules.find((ar) => ar.rule.id === 'mitosis');
  assert.ok(active);
  assert.equal(active.choiceData, 'd5');
  assert.equal(typeof active.expiresAtMove, 'number');
  assert.equal(room.mutatorState.pendingAction, null);
  assert.deepEqual(room.chess.get('d5'), { type: 'n', color: 'w' });
  assert.deepEqual(room.chess.get('e1'), { type: 'k', color: 'w' });
  assert.deepEqual(room.chess.get('e8'), { type: 'k', color: 'b' });
  assert.doesNotThrow(() => validateRoomIntegrity(room, 'test:mitosis-activation-storage'));
});

test('mitosis allows empty/enemy piece targets but rejects king/off-board targets', () => {
  const { room, whiteSocket } = setupRoom({ roomCode: 'ME-2', fen: '4k3/8/8/3N4/8/8/8/4K2R w - - 0 1' });
  setPendingAction(room, 'mitosis', 'w');
  const startFen = room.chess.fen();

  whiteSocket.trigger('mutatorActionResponse', { targets: 'a1' });
  const active = room.mutatorState.activeRules.find((ar) => ar.rule.id === 'mitosis');
  assert.ok(active);
  assert.equal(active.choiceData, 'a1');

  setPendingAction(room, 'mitosis', 'w');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'e8' });
  assert.equal(room.chess.fen(), startFen);
  assert.ok(whiteSocket.emitted.at(-1).payload.prompt.includes('cannot select a King'));
  assert.equal(room.mutatorState.pendingAction.ruleId, 'mitosis');
});

test('target move is blocked and rejected move does not advance moveCount or expiry', async () => {
  const { room, gameManager, io, whiteSocket, moveSocketWhite } = setupRoom({ roomCode: 'ME-3', fen: '4k3/8/8/3N4/8/8/8/4K2R w - - 0 1' });
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    setPendingAction(room, 'mitosis', 'w');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'd5' });
  } finally {
    Math.random = originalRandom;
  }

  const beforeCount = room.mutatorState.moveCount;
  const beforeExpires = room.mutatorState.activeRules.find((ar) => ar.rule.id === 'mitosis').expiresAtMove;
  await handleMove(io, moveSocketWhite, gameManager, { from: 'd5', to: 'e7' });

  assert.deepEqual(moveSocketWhite.emitted.at(-1), { name: 'moveRejected', payload: { error: 'Move blocked by active rule.' } });
  assert.equal(room.mutatorState.moveCount, beforeCount);
  assert.equal(room.mutatorState.activeRules.find((ar) => ar.rule.id === 'mitosis').expiresAtMove, beforeExpires);
});

test('forced expiry timing uses moveCount and emits single mutatorExpired with cleanup', async () => {
  const { room, gameManager, io, roomEvents, whiteSocket, moveSocketWhite, moveSocketBlack } = setupRoom({ roomCode: 'ME-4', fen: '4k3/8/8/3N4/8/8/8/4K2R w - - 0 1' });
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    setPendingAction(room, 'mitosis', 'w');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'd5' });
  } finally {
    Math.random = originalRandom;
  }

  const active = room.mutatorState.activeRules.find((ar) => ar.rule.id === 'mitosis');
  const startCount = room.mutatorState.moveCount;
  assert.equal(active.expiresAtMove, startCount + 3);

  await playExpiryMoves(io, gameManager, moveSocketWhite, moveSocketBlack);

  assert.equal(room.mutatorState.moveCount, startCount + 4);
  assert.equal(room.mutatorState.activeRules.some((ar) => ar.rule.id === 'mitosis'), false);
  const expiries = roomEvents.filter((e) => e.name === 'mutatorExpired' && e.payload.ruleId === 'mitosis');
  assert.equal(expiries.length, 1);
});

test('duplication on expiry creates same-type same-color piece in adjacent empty square via Math.random', async () => {
  const { room, gameManager, io, roomEvents, whiteSocket, moveSocketWhite, moveSocketBlack } = setupRoom({ roomCode: 'ME-5', fen: '4k3/8/8/3N4/8/8/8/4K2R w - - 0 1' });
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    setPendingAction(room, 'mitosis', 'w');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'd5' });
  } finally {
    Math.random = originalRandom;
  }

  try {
    Math.random = () => 0;
    await playExpiryMoves(io, gameManager, moveSocketWhite, moveSocketBlack);
  } finally {
    Math.random = originalRandom;
  }

  assert.deepEqual(room.chess.get('d5'), { type: 'n', color: 'w' });
  assert.deepEqual(room.chess.get('c4'), { type: 'n', color: 'w' });
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
});

test('occupied adjacent squares are not overwritten during mitosis duplication', async () => {
  const { room, gameManager, io, roomEvents, whiteSocket, moveSocketWhite, moveSocketBlack } = setupRoom({ roomCode: 'ME-6', fen: '4k3/8/8/3N4/2P1P3/8/8/4K2R w - - 0 1' });
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    setPendingAction(room, 'mitosis', 'w');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'd5' });
  } finally {
    Math.random = originalRandom;
  }

  try {
    Math.random = () => 0;
    await playExpiryMoves(io, gameManager, moveSocketWhite, moveSocketBlack);
  } finally {
    Math.random = originalRandom;
  }

  assert.deepEqual(room.chess.get('c4'), { type: 'p', color: 'w' });
  assert.deepEqual(room.chess.get('e4'), { type: 'p', color: 'w' });
  assert.deepEqual(room.chess.get('c5'), { type: 'n', color: 'w' });
});

test('post-expiry target movement unblocks and pending-state fields are clean', async () => {
  const { room, gameManager, io, roomEvents, whiteSocket, moveSocketWhite, moveSocketBlack } = setupRoom({ roomCode: 'ME-8', fen: '4k3/8/8/3N4/8/8/8/4K2R w - - 0 1' });
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    setPendingAction(room, 'mitosis', 'w');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'd5' });
  } finally {
    Math.random = originalRandom;
  }

  await playExpiryMoves(io, gameManager, moveSocketWhite, moveSocketBlack);

  await handleMove(io, moveSocketBlack, gameManager, { from: 'e8', to: 'f8' });
  await handleMove(io, moveSocketWhite, gameManager, { from: 'd5', to: 'e7' });
  const lastApplied = roomEvents.filter((e) => e.name === 'moveApplied').at(-1);
  assert.equal(lastApplied?.payload?.from, 'd5');
  assert.equal(lastApplied?.payload?.to, 'e7');
  assert.deepEqual(room.chess.get('e7'), { type: 'n', color: 'w' });
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.equal(room.mutatorState.pendingChoice, null);
  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
  assert.doesNotThrow(() => validateRoomIntegrity(room, 'test:mitosis-post-expiry-cleanup'));
});
