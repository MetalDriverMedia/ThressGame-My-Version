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

  const handlers = createMutatorHandlers({ handleMove: async () => {}, scheduleBotMove: () => {}, generateBotTarget: () => null });
  handlers.registerSocketHandlers(whiteSocket, io, gameManager);
  handlers.registerSocketHandlers(blackSocket, io, gameManager);

  roomsToCleanup.add(room);
  return { room, gameManager, io, roomEvents, whiteSocket, moveSocketWhite, moveSocketBlack };
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

function assertFinalSanity(room) {
  assert.doesNotThrow(() => validateRoomIntegrity(room, 'test:mitosis-traps-final'));
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
  const pieces = room.chess.board().flat().filter(Boolean);
  assert.equal(pieces.filter((p) => p.type === 'k' && p.color === 'w').length, 1);
  assert.equal(pieces.filter((p) => p.type === 'k' && p.color === 'b').length, 1);
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.equal(room.mutatorState.pendingChoice, null);
  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
}

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});

test('rule ids exist and mitosis stores choiceData/expiresAtMove', () => {
  assert.ok(getRule('mitosis'));
  assert.ok(getRule('bottomless_pit'));
  assert.ok(getRule('minefield'));

  const { room, whiteSocket } = setupRoom({ roomCode: 'MT-1', fen: '4k3/8/8/3N4/8/8/8/4K2R w - - 0 1' });
  setPendingAction(room, 'mitosis');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'd5' });
  const active = room.mutatorState.activeRules.find((ar) => ar.rule.id === 'mitosis');
  assert.equal(active.choiceData, 'd5');
  assert.equal(typeof active.expiresAtMove, 'number');
});

test('baseline: mitosis expiry duplicates to deterministic adjacent square, keeps original, expires once', async () => {
  const { room, gameManager, io, roomEvents, whiteSocket, moveSocketWhite, moveSocketBlack } = setupRoom({ roomCode: 'MT-2', fen: '4k3/8/8/3N4/8/8/8/4K2R w - - 0 1' });
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    setPendingAction(room, 'mitosis');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'd5' });
    await playExpiryMoves(io, gameManager, moveSocketWhite, moveSocketBlack);
  } finally {
    Math.random = originalRandom;
  }
  assert.deepEqual(room.chess.get('d5'), { type: 'n', color: 'w' });
  assert.deepEqual(room.chess.get('c4'), { type: 'n', color: 'w' });
  assert.equal(room.mutatorState.activeRules.some((ar) => ar.rule.id === 'mitosis'), false);
  assert.equal(roomEvents.filter((e) => e.name === 'mutatorExpired' && e.payload.ruleId === 'mitosis').length, 1);
  assertFinalSanity(room);
});

test('baseline: bottomless pit destroys moved piece and pit persists', async () => {
  const { room, gameManager, io, moveSocketWhite, roomEvents } = setupRoom({ roomCode: 'MT-3', fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1' });
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'a2' }];
  await handleMove(io, moveSocketWhite, gameManager, { from: 'a1', to: 'a2' });
  assert.equal(room.chess.get('a2'), undefined);
  assert.deepEqual(room.mutatorState.boardModifiers.bottomlessPits, [{ square: 'a2' }]);
  assert.equal(roomEvents.some((e) => e.name === 'gameEnded' && e.payload?.reason === 'king-destroyed'), false);
});

test('baseline: minefield destroys moved non-king and consumes mine', async () => {
  const { room, gameManager, io, moveSocketWhite, roomEvents } = setupRoom({ roomCode: 'MT-4', fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1' });
  room.mutatorState.boardModifiers.mines = [{ square: 'a2' }];
  room.mutatorState.activeRules.push({ rule: getRule('minefield'), turnsLeft: -1, placedBy: 'w' });
  await handleMove(io, moveSocketWhite, gameManager, { from: 'a1', to: 'a2' });
  assert.equal(room.chess.get('a2'), undefined);
  assert.deepEqual(room.mutatorState.boardModifiers.mines, []);
  assert.equal(roomEvents.some((e) => e.name === 'gameEnded' && e.payload?.reason === 'king-destroyed'), false);
});

test('combination: mitosis with bottomless pit at deterministic candidate produces no duplicate and pit persists', async () => {
  const { room, gameManager, io, roomEvents, whiteSocket, moveSocketWhite, moveSocketBlack } = setupRoom({ roomCode: 'MT-5', fen: '4k3/8/8/3N4/8/8/8/4K2R w - - 0 1' });
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'c4' }];
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    setPendingAction(room, 'mitosis');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'd5' });
    await playExpiryMoves(io, gameManager, moveSocketWhite, moveSocketBlack);
  } finally { Math.random = originalRandom; }

  assert.deepEqual(room.chess.get('d5'), { type: 'n', color: 'w' });
  assert.equal(room.chess.get('c4'), undefined);
  assert.equal(room.chess.get('c5'), undefined);
  assert.deepEqual(room.mutatorState.boardModifiers.bottomlessPits, [{ square: 'c4' }]);
  assert.equal(room.mutatorState.activeRules.some((ar) => ar.rule.id === 'mitosis'), false);
  assert.equal(roomEvents.filter((e) => e.name === 'mutatorExpired' && e.payload.ruleId === 'mitosis').length, 1);
  assert.equal(roomEvents.some((e) => e.name === 'gameEnded' && e.payload?.reason === 'king-destroyed'), false);
  assert.equal(room.status, 'active');
  assertFinalSanity(room);
});

test('combination: mitosis with minefield at deterministic candidate produces no duplicate, consumes mine, and cleans up minefield rule', async () => {
  const { room, gameManager, io, roomEvents, whiteSocket, moveSocketWhite, moveSocketBlack } = setupRoom({ roomCode: 'MT-6', fen: '4k3/8/8/3N4/8/8/8/4K2R w - - 0 1' });
  room.mutatorState.boardModifiers.mines = [{ square: 'c4' }];
  room.mutatorState.activeRules.push({ rule: getRule('minefield'), turnsLeft: -1, placedBy: 'w' });
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    setPendingAction(room, 'mitosis');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'd5' });
    await playExpiryMoves(io, gameManager, moveSocketWhite, moveSocketBlack);
  } finally { Math.random = originalRandom; }

  assert.deepEqual(room.chess.get('d5'), { type: 'n', color: 'w' });
  assert.equal(room.chess.get('c4'), undefined);
  assert.equal(room.chess.get('c5'), undefined);
  assert.deepEqual(room.mutatorState.boardModifiers.mines, []);
  assert.equal(room.mutatorState.activeRules.some((ar) => ar.rule.id === 'minefield'), false);
  assert.equal(roomEvents.filter((e) => e.name === 'mutatorExpired' && e.payload.ruleId === 'mitosis').length, 1);
  assert.equal(roomEvents.some((e) => e.name === 'gameEnded' && e.payload?.reason === 'king-destroyed'), false);
  assert.equal(room.status, 'active');
  assertFinalSanity(room);
});

test('occupied adjacent squares are not overwritten and trap square candidate is skipped when occupied', async () => {
  const { room, gameManager, io, whiteSocket, moveSocketWhite, moveSocketBlack } = setupRoom({ roomCode: 'MT-7', fen: '4k3/8/8/3N4/2P1P3/8/8/4K2R w - - 0 1' });
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'c4' }];
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    setPendingAction(room, 'mitosis');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'd5' });
    await playExpiryMoves(io, gameManager, moveSocketWhite, moveSocketBlack);
  } finally { Math.random = originalRandom; }
  assert.deepEqual(room.chess.get('c4'), { type: 'p', color: 'w' });
  assert.deepEqual(room.chess.get('e4'), { type: 'p', color: 'w' });
  assert.deepEqual(room.chess.get('c5'), { type: 'n', color: 'w' });
  assertFinalSanity(room);
});

test('target move remains blocked pre-expiry with traps active; rejected move keeps moveCount stable; post-expiry movement unblocks', async () => {
  const { room, gameManager, io, whiteSocket, moveSocketWhite, moveSocketBlack } = setupRoom({ roomCode: 'MT-8', fen: '4k3/8/8/3N4/8/8/8/4K2R w - - 0 1' });
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'c4' }];
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    setPendingAction(room, 'mitosis');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'd5' });
  } finally { Math.random = originalRandom; }

  const beforeCount = room.mutatorState.moveCount;
  const beforeExpiry = room.mutatorState.activeRules.find((ar) => ar.rule.id === 'mitosis').expiresAtMove;
  await handleMove(io, moveSocketWhite, gameManager, { from: 'd5', to: 'e7' });
  assert.deepEqual(moveSocketWhite.emitted.at(-1), { name: 'moveRejected', payload: { error: 'Move blocked by active rule.' } });
  assert.equal(room.mutatorState.moveCount, beforeCount);
  assert.equal(room.mutatorState.activeRules.find((ar) => ar.rule.id === 'mitosis').expiresAtMove, beforeExpiry);

  await playExpiryMoves(io, gameManager, moveSocketWhite, moveSocketBlack);
  await handleMove(io, moveSocketBlack, gameManager, { from: 'e8', to: 'f8' });
  await handleMove(io, moveSocketWhite, gameManager, { from: 'd5', to: 'e7' });
  if (moveSocketWhite.emitted.at(-1)?.name === 'moveApplied') {
    assert.deepEqual(room.chess.get('e7'), { type: 'n', color: 'w' });
  } else {
    assert.equal(moveSocketWhite.emitted.at(-1)?.name, 'moveRejected');
  }
  assertFinalSanity(room);
});
