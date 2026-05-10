const test = require('node:test');
const assert = require('node:assert/strict');

const { handleMove } = require('../handlers/moveHandler');
const { createMutatorHandlers } = require('../handlers/mutatorHandler');
const { GameManager, GameRoom } = require('../gameManager');
const turnClock = require('../utils/turnClock');
const { RULES } = require('../mutators/mutatorDefs');
const { checkCoinFlipSkipTurn, checkMutatorDeadlock } = require('../utils/gameLifecycle');
const {
  createIoRecorder,
  createRegisteredSocket,
} = require('./helpers/moveHandlerTestHelpers');

const roomsToCleanup = new Set();

function getRule(id) {
  const rule = RULES.find((r) => r.id === id);
  assert.ok(rule, `expected rule ${id} to exist`);
  return rule;
}

function setupRoom({ roomCode, fen, turn = 'w' }) {
  const gameManager = new GameManager();
  const room = new GameRoom(roomCode);
  room.addPlayer({ name: 'White', color: 'w', socketId: 'sock-w', isBot: false });
  room.addPlayer({ name: 'Black', color: 'b', socketId: 'sock-b', isBot: false });
  room.startGame();
  room.chess.load(fen, { skipValidation: true });

  if (turn !== room.chess.turn()) {
    const [pieces, , castling, ep, half, full] = room.chess.fen().split(' ');
    room.chess.load(`${pieces} ${turn} ${castling} ${ep} ${half} ${full}`, { skipValidation: true });
  }

  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);
  gameManager.setSocketRoom('sock-b', room.roomCode);

  const whiteSocket = createRegisteredSocket('sock-w');
  const blackSocket = createRegisteredSocket('sock-b');
  const { io, roomEvents } = createIoRecorder();
  io.sockets.sockets.set('sock-w', whiteSocket);
  io.sockets.sockets.set('sock-b', blackSocket);

  const handlers = createMutatorHandlers({
    handleMove,
    scheduleBotMove: () => {},
    generateBotTarget: () => null,
  });
  handlers.registerSocketHandlers(whiteSocket, io, gameManager);
  handlers.registerSocketHandlers(blackSocket, io, gameManager);

  roomsToCleanup.add(room);

  return { gameManager, room, whiteSocket, blackSocket, io, roomEvents };
}

function activateRule(room, id, attrs = {}) {
  room.mutatorState.activeRules.push({ rule: getRule(id), ...attrs });
}

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});

test('baseline: no_cowards blocks backward movement', async () => {
  const { gameManager, room, whiteSocket, io, roomEvents } = setupRoom({
    roomCode: 'AONC-1',
    fen: '4k3/8/8/8/8/4P3/8/4K3 w - - 0 1',
  });
  activateRule(room, 'no_cowards');
  const before = room.chess.fen();

  await handleMove(io, whiteSocket, gameManager, { from: 'e3', to: 'e2' });

  const rejection = whiteSocket.emitted.find((e) => e.name === 'moveRejected');
  assert.ok(rejection);
  assert.equal(rejection.payload.error, 'Move blocked by active rule.');
  assert.equal(roomEvents.filter((e) => e.name === 'moveApplied').length, 0);
  assert.equal(room.chess.fen(), before);
});

test('baseline: no_cowards allows forward movement', async () => {
  const { gameManager, room, whiteSocket, io, roomEvents } = setupRoom({
    roomCode: 'AONC-2',
    fen: '4k3/8/8/8/8/4P3/8/4K3 w - - 0 1',
  });
  activateRule(room, 'no_cowards');

  await handleMove(io, whiteSocket, gameManager, { from: 'e3', to: 'e4' });

  const applied = roomEvents.filter((e) => e.name === 'moveApplied');
  assert.equal(applied.length, 1);
  assert.equal(room.chess.get('e4').type, 'p');
  assert.equal(room.chess.get('e3'), undefined);
  assert.equal(room.chess.turn(), 'b');
});

test('baseline: all_on_red tails blocks non-king movement', async () => {
  const { gameManager, room, whiteSocket, io, roomEvents } = setupRoom({
    roomCode: 'AONC-3',
    fen: '4k3/8/8/8/8/8/2P5/4K3 w - - 0 1',
  });
  activateRule(room, 'all_on_red', { chooser: 'w', remainingMoves: 3 });
  room.mutatorState.coinFlipResult = { result: 'tails', moveCount: room.mutatorState.moveCount };
  const before = room.chess.fen();

  await handleMove(io, whiteSocket, gameManager, { from: 'c2', to: 'c3' });

  const rejection = whiteSocket.emitted.find((e) => e.name === 'moveRejected');
  assert.ok(rejection);
  assert.equal(rejection.payload.error, 'Move blocked by active rule.');
  assert.equal(roomEvents.filter((e) => e.name === 'moveApplied').length, 0);
  assert.equal(room.chess.fen(), before);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
});

test('all_on_red heads + no_cowards still blocks backward movement', async () => {
  const { gameManager, room, whiteSocket, io, roomEvents } = setupRoom({
    roomCode: 'AONC-4',
    fen: '4k3/8/8/8/8/4P3/8/4K3 w - - 0 1',
  });
  activateRule(room, 'all_on_red', { chooser: 'w', remainingMoves: 3 });
  activateRule(room, 'no_cowards');
  room.mutatorState.coinFlipResult = { result: 'heads', moveCount: room.mutatorState.moveCount };
  const before = room.chess.fen();

  await handleMove(io, whiteSocket, gameManager, { from: 'e3', to: 'e2' });

  const rejection = whiteSocket.emitted.find((e) => e.name === 'moveRejected');
  assert.ok(rejection);
  assert.equal(rejection.payload.error, 'Move blocked by active rule.');
  assert.equal(roomEvents.filter((e) => e.name === 'moveApplied').length, 0);
  assert.equal(room.chess.fen(), before);
});

test('all_on_red tails + no_cowards blocks forward non-king movement', async () => {
  const { gameManager, room, whiteSocket, io, roomEvents } = setupRoom({
    roomCode: 'AONC-5',
    fen: '4k3/8/8/8/8/4P3/8/4K3 w - - 0 1',
  });
  activateRule(room, 'all_on_red', { chooser: 'w', remainingMoves: 3 });
  activateRule(room, 'no_cowards');
  room.mutatorState.coinFlipResult = { result: 'tails', moveCount: room.mutatorState.moveCount };
  const before = room.chess.fen();

  await handleMove(io, whiteSocket, gameManager, { from: 'e3', to: 'e4' });

  const rejection = whiteSocket.emitted.find((e) => e.name === 'moveRejected');
  assert.ok(rejection);
  assert.equal(rejection.payload.error, 'Move blocked by active rule.');
  assert.equal(roomEvents.filter((e) => e.name === 'moveApplied').length, 0);
  assert.equal(room.chess.fen(), before);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
});

test('all_on_red tails + no_cowards permits king forward movement', async () => {
  const { gameManager, room, whiteSocket, io, roomEvents } = setupRoom({
    roomCode: 'AONC-6',
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
  });
  activateRule(room, 'all_on_red', { chooser: 'w', remainingMoves: 3 });
  activateRule(room, 'no_cowards');
  room.mutatorState.coinFlipResult = { result: 'tails', moveCount: room.mutatorState.moveCount };

  await handleMove(io, whiteSocket, gameManager, { from: 'e1', to: 'e2' });

  const applied = roomEvents.filter((e) => e.name === 'moveApplied');
  assert.equal(applied.length, 1);
  assert.equal(room.chess.get('e2').type, 'k');
  assert.equal(room.chess.get('e1'), undefined);
  assert.equal(room.chess.turn(), 'b');
  assert.equal(room.mutatorState.pendingCoinFlip, null);
});

test('all_on_red tails + no_cowards rejects king backward movement', async () => {
  const { gameManager, room, whiteSocket, io, roomEvents } = setupRoom({
    roomCode: 'AONC-7',
    fen: '4k3/8/8/8/8/4K3/8/8 w - - 0 1',
  });
  activateRule(room, 'all_on_red', { chooser: 'w', remainingMoves: 3 });
  activateRule(room, 'no_cowards');
  room.mutatorState.coinFlipResult = { result: 'tails', moveCount: room.mutatorState.moveCount };
  const before = room.chess.fen();

  await handleMove(io, whiteSocket, gameManager, { from: 'e3', to: 'e2' });

  const rejection = whiteSocket.emitted.find((e) => e.name === 'moveRejected');
  assert.ok(rejection);
  assert.equal(rejection.payload.error, 'Move blocked by active rule.');
  assert.equal(roomEvents.filter((e) => e.name === 'moveApplied').length, 0);
  assert.equal(room.chess.fen(), before);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
});

test('deadlock/stuck-state sanity: tails + no_cowards with no king forward moves ends game by current behavior', async () => {
  const { gameManager, room, whiteSocket, io, roomEvents } = setupRoom({
    roomCode: 'AONC-8',
    fen: '7k/8/8/8/8/8/PP6/KP6 w - - 0 1',
  });
  activateRule(room, 'all_on_red', { chooser: 'w', remainingMoves: 3 });
  activateRule(room, 'no_cowards');
  room.mutatorState.coinFlipResult = { result: 'tails', moveCount: room.mutatorState.moveCount };

  checkCoinFlipSkipTurn(room, io, 'w');
  const skipEvent = roomEvents.find((e) => e.name === 'moveApplied' && e.payload?.skipTurn);
  assert.ok(skipEvent);
  assert.equal(skipEvent.payload.skipMessage, 'No valid King moves -- turn skipped!');
  assert.equal(room.chess.turn(), 'b');

  const before = room.chess.fen();
  await handleMove(io, whiteSocket, gameManager, { from: 'a1', to: 'a2' });

  assert.equal(whiteSocket.emitted.some((e) => e.name === 'moveRejected'), true);
  assert.equal(room.chess.fen(), before);
  assert.equal(room.mutatorState.pendingCoinFlip, null);

  const ended = checkMutatorDeadlock(room, io, gameManager);
  assert.equal(ended, false);
  const gameEnded = roomEvents.filter((e) => e.name === 'gameEnded');
  assert.equal(gameEnded.length, 0);
});
