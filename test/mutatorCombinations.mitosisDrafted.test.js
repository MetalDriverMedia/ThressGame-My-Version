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

function createRoom({ roomCode, fen }) {
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
  return { room, gameManager, io, roomEvents, whiteSocket, blackSocket, moveSocketWhite, moveSocketBlack };
}

function setPending(room, ruleId, forPlayer = 'w') {
  const rule = getRule(ruleId);
  room.mutatorState.pendingAction = { ruleId, actionType: rule.choiceType, forPlayer, rule };
}

function applyMitosis(room, whiteSocket, target = 'g2') {
  setPending(room, 'mitosis');
  whiteSocket.trigger('mutatorActionResponse', { targets: target });
}

function applyDrafted(room, whiteSocket, blackSocket, whiteTarget = 'g2', blackTarget = 'g7') {
  setPending(room, 'drafted_for_battle');
  whiteSocket.trigger('mutatorActionResponse', { targets: whiteTarget });
  blackSocket.trigger('mutatorActionResponse', { targets: blackTarget });
}

async function withMockedRandom(value, fn) {
  const originalRandom = Math.random;
  try {
    Math.random = () => value;
    return await fn();
  } finally {
    Math.random = originalRandom;
  }
}

async function playExpiryMoves(io, gameManager, moveSocketWhite, moveSocketBlack) {
  await handleMove(io, moveSocketWhite, gameManager, { from: 'h1', to: 'h2' });
  await handleMove(io, moveSocketBlack, gameManager, { from: 'h8', to: 'h7' });
  await handleMove(io, moveSocketWhite, gameManager, { from: 'h2', to: 'h1' });
  await handleMove(io, moveSocketBlack, gameManager, { from: 'h7', to: 'h8' });
}

async function advanceUntilMitosisExpires(ctx, maxCycles = 6) {
  for (let i = 0; i < maxCycles; i += 1) {
    if (!ctx.room.mutatorState.activeRules.some((r) => r.rule.id === 'mitosis')) return;
    await playExpiryMoves(ctx.io, ctx.gameManager, ctx.moveSocketWhite, ctx.moveSocketBlack);
  }
}

function assertFinalSanity(room, label) {
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
    assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.ok(Array.isArray(room.mutatorState.activeRules));
  assert.ok(Array.isArray(room.mutatorState.boardModifiers.lockedSquares));
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
  const pieces = room.chess.board().flat().filter(Boolean);
  assert.equal(pieces.filter((p) => p.type === 'k' && p.color === 'w').length, 1);
  assert.equal(pieces.filter((p) => p.type === 'k' && p.color === 'b').length, 1);
  assert.equal(validateRoomIntegrity(room, label), true);
}

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});

const BASE_FEN = '4k2r/6n1/8/8/8/8/6B1/4K2R w - - 0 1';

test('baseline mitosis activation/expiry duplication is deterministic', async () => {
  const { room, gameManager, io, roomEvents, whiteSocket, moveSocketWhite, moveSocketBlack } = createRoom({ roomCode: 'MD-1', fen: BASE_FEN });
  await withMockedRandom(0, async () => {
    applyMitosis(room, whiteSocket, 'g2');
    await advanceUntilMitosisExpires({ room, io, gameManager, moveSocketWhite, moveSocketBlack });
  });
  assert.equal(roomEvents.filter((e) => e.name === 'mutatorExpired' && e.payload.ruleId === 'mitosis').length, 1);
  assertFinalSanity(room, 'test:md-baseline-mitosis');
});

test('baseline drafted for battle swaps bishop/knight with kings', () => {
  const { room, whiteSocket, blackSocket } = createRoom({ roomCode: 'MD-2', fen: BASE_FEN });
  applyDrafted(room, whiteSocket, blackSocket);
  assert.deepEqual(room.chess.get('g2'), { type: 'k', color: 'w' });
  assert.deepEqual(room.chess.get('e1'), { type: 'b', color: 'w' });
  assert.deepEqual(room.chess.get('g7'), { type: 'k', color: 'b' });
  assert.deepEqual(room.chess.get('e8'), { type: 'n', color: 'b' });
  assertFinalSanity(room, 'test:md-baseline-drafted');
});

test('mitosis target later selected by drafted for battle remains coherent through expiry', async () => {
  const { room, gameManager, io, whiteSocket, blackSocket, moveSocketWhite, moveSocketBlack } = createRoom({ roomCode: 'MD-3', fen: BASE_FEN });
  await withMockedRandom(0, async () => {
    applyMitosis(room, whiteSocket, 'g2');
    applyDrafted(room, whiteSocket, blackSocket);
    await advanceUntilMitosisExpires({ room, io, gameManager, moveSocketWhite, moveSocketBlack });
  });
  assertFinalSanity(room, 'test:md-mitosis-then-drafted');
});

test('drafted then mitosis on relocated white piece stays valid and expires cleanly', async () => {
  const { room, gameManager, io, whiteSocket, blackSocket, moveSocketWhite, moveSocketBlack } = createRoom({ roomCode: 'MD-4', fen: BASE_FEN });
  await withMockedRandom(0, async () => {
    applyDrafted(room, whiteSocket, blackSocket);
    applyMitosis(room, whiteSocket, 'e1');
    await advanceUntilMitosisExpires({ room, io, gameManager, moveSocketWhite, moveSocketBlack });
  });
  assertFinalSanity(room, 'test:md-drafted-then-mitosis');
});

test('mitosis targeting king square produced by drafted path remains fen-safe', async () => {
  const { room, gameManager, io, whiteSocket, blackSocket, moveSocketWhite, moveSocketBlack } = createRoom({ roomCode: 'MD-5', fen: BASE_FEN });
  await withMockedRandom(0, async () => {
    applyDrafted(room, whiteSocket, blackSocket);
    applyMitosis(room, whiteSocket, 'g2');
    await advanceUntilMitosisExpires({ room, io, gameManager, moveSocketWhite, moveSocketBlack });
  });
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
  assert.equal(validateRoomIntegrity(room, 'test:md-king-target-path'), true);
});

test('pre-expiry target movement blocked when drafted state also exists', async () => {
  const { room, gameManager, io, whiteSocket, blackSocket, moveSocketWhite } = createRoom({ roomCode: 'MD-6', fen: BASE_FEN });
  applyMitosis(room, whiteSocket, 'g2');
  applyDrafted(room, whiteSocket, blackSocket);
  const mitosis = room.mutatorState.activeRules.find((r) => r.rule.id === 'mitosis');
  const trackedSquare = typeof mitosis?.choiceData === 'string' ? mitosis.choiceData : mitosis?.choiceData?.square;
  const before = room.mutatorState.moveCount;
  await handleMove(io, moveSocketWhite, gameManager, { from: trackedSquare, to: 'f3' });
  assert.deepEqual(moveSocketWhite.emitted.at(-1), { name: 'moveRejected', payload: { error: 'Move blocked by active rule.' } });
  assert.equal(room.mutatorState.moveCount, before);
  assertFinalSanity(room, 'test:md-pre-expiry-blocked');
});

test('post-expiry target movement unblocks when target remains legal', async () => {
  const { room, gameManager, io, whiteSocket, moveSocketWhite, moveSocketBlack } = createRoom({ roomCode: 'MD-7', fen: BASE_FEN });
  await withMockedRandom(0, async () => {
    applyMitosis(room, whiteSocket, 'g2');
    await advanceUntilMitosisExpires({ room, io, gameManager, moveSocketWhite, moveSocketBlack });
  });
  await handleMove(io, moveSocketWhite, gameManager, { from: 'g2', to: 'h3' });
  assert.notEqual(moveSocketWhite.emitted.at(-1)?.name, 'moveRejected');
  assertFinalSanity(room, 'test:md-post-expiry-unblocked');
});

test('expiry ordering sanity for drafted + mitosis in close sequence', async () => {
  const { room, gameManager, io, roomEvents, whiteSocket, blackSocket, moveSocketWhite, moveSocketBlack } = createRoom({ roomCode: 'MD-8', fen: BASE_FEN });
  await withMockedRandom(0, async () => {
    applyDrafted(room, whiteSocket, blackSocket);
    applyMitosis(room, whiteSocket, 'e1');
  });
  const mitosis = room.mutatorState.activeRules.find((r) => r.rule.id === 'mitosis');
  assert.ok(typeof mitosis?.expiresAtMove === 'number');
  await playExpiryMoves(io, gameManager, moveSocketWhite, moveSocketBlack);
  assert.equal(roomEvents.filter((e) => e.name === 'mutatorExpired' && e.payload.ruleId === 'mitosis').length, 1);
  assertFinalSanity(room, 'test:md-expiry-order');
});

test('no false king destruction during drafted + mitosis interaction', async () => {
  const { room, gameManager, io, roomEvents, whiteSocket, blackSocket, moveSocketWhite, moveSocketBlack } = createRoom({ roomCode: 'MD-9', fen: BASE_FEN });
  await withMockedRandom(0, async () => {
    applyMitosis(room, whiteSocket, 'g2');
    applyDrafted(room, whiteSocket, blackSocket);
    await advanceUntilMitosisExpires({ room, io, gameManager, moveSocketWhite, moveSocketBlack });
  });
  assert.equal(roomEvents.some((e) => e.name === 'gameEnded' && e.payload?.reason === 'king-destroyed'), false);
  assertFinalSanity(room, 'test:md-no-false-king-destroyed');
});
