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

  const handlers = createMutatorHandlers({ handleMove: async () => {}, scheduleBotMove: () => {}, generateBotTarget: () => null });
  handlers.registerSocketHandlers(whiteSocket, io, gameManager);
  handlers.registerSocketHandlers(blackSocket, io, gameManager);

  roomsToCleanup.add(room);
  return { room, gameManager, io, roomEvents, whiteSocket, blackSocket, moveSocketWhite, moveSocketBlack };
}

function setPendingMindControl(room, forPlayer = 'w') {
  const rule = getRule('mind_control');
  room.mutatorState.pendingAction = { ruleId: 'mind_control', actionType: rule.choiceType, forPlayer, rule };
}

function resolveMindControl(room, whiteSocket, blackSocket, whiteTarget, blackTarget) {
  setPendingMindControl(room, 'w');
  whiteSocket.trigger('mutatorActionResponse', { targets: whiteTarget });
  if (blackTarget) blackSocket.trigger('mutatorActionResponse', { targets: blackTarget });
}

function assertFinalSanity(room, label) {
  const board = room.chess.fen().split(' ')[0];
  assert.equal((board.match(/K/g) || []).length, 1);
  assert.equal((board.match(/k/g) || []).length, 1);
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.equal(room.mutatorState.pendingChoice, null);
  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
  assert.equal(validateRoomIntegrity(room, label), true);
}

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});

test('baseline: mind control converts enemy non-king', () => {
  const { room, whiteSocket, blackSocket } = setupRoom({ roomCode: 'MCT-1', fen: '4k3/4n3/8/8/8/8/4B3/4K3 w - - 0 1' });
  resolveMindControl(room, whiteSocket, blackSocket, 'e7', 'e2');
  assert.deepEqual(room.chess.get('e7'), { type: 'n', color: 'w' });
  assert.deepEqual(room.chess.get('e2'), { type: 'b', color: 'b' });
  assertFinalSanity(room, 'mct-baseline-convert');
});

test('baseline: mind control rejects king targets', () => {
  const { room, whiteSocket } = setupRoom({ roomCode: 'MCT-2', fen: '4k3/4n3/8/8/8/8/4B3/4K3 w - - 0 1' });
  const before = room.chess.fen();
  setPendingMindControl(room, 'w');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'e8' });
  assert.equal(room.chess.fen(), before);
  assert.deepEqual(room.chess.get('e8'), { type: 'k', color: 'b' });
  assert.ok(room.mutatorState.pendingAction);
});

test('baseline: bottomless pit destroys non-king movers and persists', async () => {
  const { room, gameManager, io, moveSocketWhite } = setupRoom({ roomCode: 'MCT-3', fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1' });
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'a2' }];
  await handleMove(io, moveSocketWhite, gameManager, { from: 'a1', to: 'a2' });
  assert.equal(room.chess.get('a2'), undefined);
  assert.deepEqual(room.mutatorState.boardModifiers.bottomlessPits, [{ square: 'a2' }]);
});

test('baseline: minefield destroys non-king movers and consumes mine', async () => {
  const { room, gameManager, io, moveSocketWhite } = setupRoom({ roomCode: 'MCT-4', fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1' });
  room.mutatorState.boardModifiers.mines = [{ square: 'a2' }];
  room.mutatorState.activeRules.push({ rule: getRule('minefield'), turnsLeft: -1, placedBy: 'w' });
  await handleMove(io, moveSocketWhite, gameManager, { from: 'a1', to: 'a2' });
  assert.equal(room.chess.get('a2'), undefined);
  assert.deepEqual(room.mutatorState.boardModifiers.mines, []);
  assert.equal(room.mutatorState.activeRules.some((r) => r.rule.id === 'minefield'), false);
});

test('mind control target standing on bottomless pit square does not immediately trigger trap', () => {
  const { room, whiteSocket, blackSocket } = setupRoom({ roomCode: 'MCT-5', fen: '4k3/4n3/8/8/8/8/4B3/4K3 w - - 0 1' });
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'e7' }];
  resolveMindControl(room, whiteSocket, blackSocket, 'e7', 'e2');
  assert.deepEqual(room.chess.get('e7'), { type: 'n', color: 'w' });
  assert.deepEqual(room.mutatorState.boardModifiers.bottomlessPits, [{ square: 'e7' }]);
  assertFinalSanity(room, 'mct-pit-origin');
});

test('mind control target standing on minefield square does not immediately trigger trap', () => {
  const { room, whiteSocket, blackSocket } = setupRoom({ roomCode: 'MCT-6', fen: '4k3/4n3/8/8/8/8/4B3/4K3 w - - 0 1' });
  room.mutatorState.boardModifiers.mines = [{ square: 'e7' }];
  room.mutatorState.activeRules.push({ rule: getRule('minefield'), turnsLeft: -1, placedBy: 'w' });
  resolveMindControl(room, whiteSocket, blackSocket, 'e7', 'e2');
  assert.deepEqual(room.chess.get('e7'), { type: 'n', color: 'w' });
  assert.deepEqual(room.mutatorState.boardModifiers.mines, [{ square: 'e7' }]);
  assertFinalSanity(room, 'mct-mine-origin');
});

test('converted piece later moves onto bottomless pit and is destroyed while pit persists', async () => {
  const { room, gameManager, io, whiteSocket, blackSocket, moveSocketWhite, moveSocketBlack } = setupRoom({ roomCode: 'MCT-7', fen: '4k3/4n3/8/8/8/8/4B3/4K2R w - - 0 1' });
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'f5' }];
  resolveMindControl(room, whiteSocket, blackSocket, 'e7', 'e2');
  await handleMove(io, moveSocketBlack, gameManager, { from: 'e8', to: 'f8' });
  await handleMove(io, moveSocketWhite, gameManager, { from: 'e7', to: 'f5' });
  assert.equal(room.chess.get('f5'), undefined);
  assert.deepEqual(room.mutatorState.boardModifiers.bottomlessPits, [{ square: 'f5' }]);
  assertFinalSanity(room, 'mct-pit-destination');
});

test('converted piece later moves onto minefield and is destroyed while mine is consumed', async () => {
  const { room, gameManager, io, whiteSocket, blackSocket, moveSocketWhite, moveSocketBlack } = setupRoom({ roomCode: 'MCT-8', fen: '4k3/4n3/8/8/8/8/4B3/4K2R w - - 0 1' });
  room.mutatorState.boardModifiers.mines = [{ square: 'f5' }];
  room.mutatorState.activeRules.push({ rule: getRule('minefield'), turnsLeft: -1, placedBy: 'w' });
  resolveMindControl(room, whiteSocket, blackSocket, 'e7', 'e2');
  await handleMove(io, moveSocketBlack, gameManager, { from: 'e8', to: 'f8' });
  await handleMove(io, moveSocketWhite, gameManager, { from: 'e7', to: 'f5' });
  assert.equal(room.chess.get('f5'), undefined);
  assert.deepEqual(room.mutatorState.boardModifiers.mines, []);
  assert.equal(room.mutatorState.activeRules.some((r) => r.rule.id === 'minefield'), false);
  assertFinalSanity(room, 'mct-mine-destination');
});

test('trap marker lifecycle with both traps stays coherent across conversion and movement trigger', async () => {
  const { room, gameManager, io, whiteSocket, blackSocket, moveSocketWhite, moveSocketBlack } = setupRoom({ roomCode: 'MCT-9', fen: '4k3/4n3/8/8/8/8/4B3/4K2R w - - 0 1' });
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'h4' }];
  room.mutatorState.boardModifiers.mines = [{ square: 'f5' }];
  room.mutatorState.activeRules.push({ rule: getRule('minefield'), turnsLeft: -1, placedBy: 'w' });

  resolveMindControl(room, whiteSocket, blackSocket, 'e7', 'e2');
  await handleMove(io, moveSocketBlack, gameManager, { from: 'e8', to: 'f8' });
  await handleMove(io, moveSocketWhite, gameManager, { from: 'e7', to: 'f5' });

  assert.deepEqual(room.mutatorState.boardModifiers.bottomlessPits, [{ square: 'h4' }]);
  assert.deepEqual(room.mutatorState.boardModifiers.mines, []);
  assert.equal(room.mutatorState.activeRules.some((r) => r.rule.id === 'minefield'), false);
  assertFinalSanity(room, 'mct-lifecycle');
});

test('post-combination state keeps room integrity and stable pending/actions data', () => {
  const { room, whiteSocket, blackSocket } = setupRoom({ roomCode: 'MCT-10', fen: '4k3/4n3/8/8/8/8/4B3/4K3 w - - 0 1' });
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'a3' }];
  room.mutatorState.boardModifiers.mines = [{ square: 'h6' }];
  room.mutatorState.activeRules.push({ rule: getRule('bottomless_pit'), turnsLeft: -1, placedBy: 'b' });
  room.mutatorState.activeRules.push({ rule: getRule('minefield'), turnsLeft: -1, placedBy: 'w' });

  resolveMindControl(room, whiteSocket, blackSocket, 'e7', 'e2');

  assert.equal(room.mutatorState.activeRules.some((r) => r.rule.id === 'bottomless_pit'), true);
  assert.equal(room.mutatorState.activeRules.some((r) => r.rule.id === 'minefield'), true);
  assertFinalSanity(room, 'mct-final-integrity');
});
