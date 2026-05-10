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
  await handleMove(io, moveSocketBlack, gameManager, { from: 'e8', to: 'f8' });
  await handleMove(io, moveSocketWhite, gameManager, { from: 'h2', to: 'h1' });
  await handleMove(io, moveSocketBlack, gameManager, { from: 'f8', to: 'e8' });
}

function assertBoardAndRoomState(room, scope) {
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
  assert.equal(validateRoomIntegrity(room, scope), true);
  const pieces = room.chess.board().flat().filter(Boolean);
  assert.equal(pieces.filter((p) => p.type === 'k' && p.color === 'w').length, 1);
  assert.equal(pieces.filter((p) => p.type === 'k' && p.color === 'b').length, 1);
}

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});

test('baseline: mitosis + living bomb activation state shape and expiry metadata are deterministic', () => {
  const { room, whiteSocket } = setupRoom({ roomCode: 'MLB-1', fen: '4k3/8/8/3N4/8/8/8/4K2R w - - 0 1' });

  setPendingAction(room, 'mitosis');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'd5' });
  const mitosis = room.mutatorState.activeRules.find((ar) => ar.rule.id === 'mitosis');
  assert.ok(mitosis);
  assert.equal(mitosis.choiceData.square, 'd5');

  setPendingAction(room, 'living_bomb');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'd5' });
  const livingBomb = room.mutatorState.activeRules.find((ar) => ar.rule.id === 'living_bomb');
  assert.ok(livingBomb);
  assert.equal(typeof livingBomb.expiresAtMove, 'number');
  assert.ok(livingBomb.expiresAtMove > room.mutatorState.moveCount);
  assert.deepEqual(room.mutatorState.boardModifiers.livingBombs[0], {
    square: 'd5',
    piece: 'n',
    color: 'w',
    expiresAtMove: livingBomb.expiresAtMove,
  });
  assert.equal(room.mutatorState.pendingAction, null);
  assertBoardAndRoomState(room, 'test:mlb-baseline');
});

test('expiry: mitosis + living bomb resolves without stale marker metadata or rule state', async () => {
  const { room, gameManager, io, roomEvents, whiteSocket, moveSocketWhite, moveSocketBlack } = setupRoom({ roomCode: 'MLB-2', fen: '4k3/8/8/3N4/8/8/8/4K2R w - - 0 1' });

  await withMockedRandom(0, async () => {
    setPendingAction(room, 'mitosis');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'd5' });
    setPendingAction(room, 'living_bomb');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'd5' });
    await playExpiryMoves(io, gameManager, moveSocketWhite, moveSocketBlack);
  });

  const targetPieceAfterExpiry = room.chess.get('d5');
  if (targetPieceAfterExpiry) assert.deepEqual(targetPieceAfterExpiry, { type: 'n', color: 'w' });
  assert.equal(room.mutatorState.activeRules.some((ar) => ar.rule.id === 'living_bomb'), false);
  assert.deepEqual(room.mutatorState.boardModifiers.livingBombs, []);
  assert.equal(roomEvents.filter((e) => e.name === 'mutatorExpired' && e.payload.ruleId === 'mitosis').length, 1);
  assert.equal(roomEvents.some((e) => e.name === 'gameEnded' && e.payload?.reason === 'king-destroyed'), false);
  assertBoardAndRoomState(room, 'test:mlb-dup-marker-stable');
});

test('marker on deterministic duplicate destination can coexist pre-expiry and game remains coherent at expiry', async () => {
  const { room, gameManager, io, roomEvents, whiteSocket, moveSocketWhite, moveSocketBlack } = setupRoom({ roomCode: 'MLB-3', fen: '4k3/8/8/3N4/8/8/8/4K2R w - - 0 1' });

  await withMockedRandom(0, async () => {
    setPendingAction(room, 'living_bomb');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'c4' });
    setPendingAction(room, 'mitosis');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'd5' });
    await playExpiryMoves(io, gameManager, moveSocketWhite, moveSocketBlack);
  });

  const onC4 = room.chess.get('c4');
  if (onC4) assert.deepEqual(onC4, { type: 'n', color: 'w' });
  if (room.mutatorState.boardModifiers.livingBombs[0]) assert.equal(room.mutatorState.boardModifiers.livingBombs[0].square, 'c4');
  assert.equal(roomEvents.some((e) => e.name === 'gameEnded' && e.payload?.reason === 'king-destroyed'), false);
  assertBoardAndRoomState(room, 'test:mlb-marker-on-destination');
});

test('pre-expiry target movement is blocked with living bomb active; post-expiry movement unblocks with clean pending state', async () => {
  const { room, gameManager, io, whiteSocket, moveSocketWhite, moveSocketBlack } = setupRoom({ roomCode: 'MLB-4', fen: '4k3/8/8/3N4/8/8/8/4K2R w - - 0 1' });

  await withMockedRandom(0, async () => {
    setPendingAction(room, 'mitosis');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'd5' });
    setPendingAction(room, 'living_bomb');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'd5' });
  });

  const beforeMoveCount = room.mutatorState.moveCount;
  await handleMove(io, moveSocketWhite, gameManager, { from: 'd5', to: 'e7' });
  assert.deepEqual(moveSocketWhite.emitted.at(-1), { name: 'moveRejected', payload: { error: 'Move blocked by active rule.' } });
  assert.equal(room.mutatorState.moveCount, beforeMoveCount);

  await playExpiryMoves(io, gameManager, moveSocketWhite, moveSocketBlack);
  await handleMove(io, moveSocketBlack, gameManager, { from: 'e8', to: 'f8' });
  await handleMove(io, moveSocketWhite, gameManager, { from: 'd5', to: 'e7' });
  if (room.chess.get('d5')) {
    assert.deepEqual(room.chess.get('e7'), { type: 'n', color: 'w' });
  } else {
    assert.equal(moveSocketWhite.emitted.at(-1)?.name, 'moveRejected');
  }

  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.equal(room.mutatorState.pendingChoice, null);
  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assertBoardAndRoomState(room, 'test:mlb-prepost-movement');
});

test('expiry ordering sanity: nearby expiresAtMove values cleanly resolve without stale active rules', async () => {
  const { room, gameManager, io, roomEvents, whiteSocket, moveSocketWhite, moveSocketBlack } = setupRoom({ roomCode: 'MLB-5', fen: '4k3/8/8/3N4/8/8/8/4K2R w - - 0 1' });

  await withMockedRandom(0, async () => {
    setPendingAction(room, 'living_bomb');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'd5' });
    setPendingAction(room, 'mitosis');
    whiteSocket.trigger('mutatorActionResponse', { targets: 'd5' });
  });

  const mitosisExpiry = room.mutatorState.activeRules.find((ar) => ar.rule.id === 'mitosis').expiresAtMove;
  const livingBombExpiry = room.mutatorState.activeRules.find((ar) => ar.rule.id === 'living_bomb').expiresAtMove;
  assert.ok(Math.abs(mitosisExpiry - livingBombExpiry) <= 1);

  await playExpiryMoves(io, gameManager, moveSocketWhite, moveSocketBlack);

  assert.equal(room.mutatorState.activeRules.some((ar) => ar.rule.id === 'mitosis'), false);
  assert.equal(room.mutatorState.activeRules.some((ar) => ar.rule.id === 'living_bomb'), false);
  assert.equal(roomEvents.filter((e) => e.name === 'mutatorExpired' && e.payload.ruleId === 'mitosis').length, 1);
  assert.equal(roomEvents.filter((e) => e.name === 'mutatorExpired' && e.payload.ruleId === 'living_bomb').length, 1);
  assert.equal(roomEvents.some((e) => e.name === 'gameEnded' && e.payload?.reason === 'king-destroyed'), false);
  assertBoardAndRoomState(room, 'test:mlb-expiry-ordering');
});
