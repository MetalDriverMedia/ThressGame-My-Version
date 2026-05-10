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

test('baseline: ice_age blocks movement from frozen edge files', async () => {
  const { gameManager, room, whiteSocket, io, roomEvents } = setupRoom({
    roomCode: 'AOI-1',
    fen: '4k3/8/8/8/8/8/P7/4K3 w - - 0 1',
  });
  activateRule(room, 'ice_age');
  const before = room.chess.fen();

  await handleMove(io, whiteSocket, gameManager, { from: 'a2', to: 'a3' });

  const rejection = whiteSocket.emitted.find((e) => e.name === 'moveRejected');
  assert.ok(rejection);
  assert.equal(rejection.payload.error, 'Move blocked by active rule.');
  assert.equal(roomEvents.filter((e) => e.name === 'moveApplied').length, 0);
  assert.equal(room.chess.fen(), before);
});

test('baseline: all_on_red tails blocks non-king movement', async () => {
  const { gameManager, room, whiteSocket, io, roomEvents } = setupRoom({
    roomCode: 'AOI-2',
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
});

test('all_on_red heads + ice_age still blocks frozen-file non-king movement', async () => {
  const { gameManager, room, whiteSocket, io, roomEvents } = setupRoom({
    roomCode: 'AOI-3',
    fen: '4k3/8/8/8/8/8/P7/4K3 w - - 0 1',
  });
  activateRule(room, 'all_on_red', { chooser: 'w', remainingMoves: 3 });
  activateRule(room, 'ice_age');
  room.mutatorState.coinFlipResult = { result: 'heads', moveCount: room.mutatorState.moveCount };
  const before = room.chess.fen();

  await handleMove(io, whiteSocket, gameManager, { from: 'a2', to: 'a3' });

  const rejection = whiteSocket.emitted.find((e) => e.name === 'moveRejected');
  assert.ok(rejection);
  assert.equal(rejection.payload.error, 'Move blocked by active rule.');
  assert.equal(roomEvents.filter((e) => e.name === 'moveApplied').length, 0);
  assert.equal(room.chess.fen(), before);
});

test('all_on_red tails + ice_age blocks non-king movement from non-frozen file', async () => {
  const { gameManager, room, whiteSocket, io, roomEvents } = setupRoom({
    roomCode: 'AOI-4',
    fen: '4k3/8/8/8/8/8/2P5/4K3 w - - 0 1',
  });
  activateRule(room, 'all_on_red', { chooser: 'w', remainingMoves: 3 });
  activateRule(room, 'ice_age');
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

test('all_on_red tails permits king movement when king is not frozen', async () => {
  const { gameManager, room, whiteSocket, io, roomEvents } = setupRoom({
    roomCode: 'AOI-5',
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
  });
  activateRule(room, 'all_on_red', { chooser: 'w', remainingMoves: 3 });
  activateRule(room, 'ice_age');
  room.mutatorState.coinFlipResult = { result: 'tails', moveCount: room.mutatorState.moveCount };

  await handleMove(io, whiteSocket, gameManager, { from: 'e1', to: 'e2' });

  const applied = roomEvents.filter((e) => e.name === 'moveApplied');
  assert.equal(applied.length, 1);
  assert.equal(room.chess.get('e2').type, 'k');
  assert.equal(room.chess.turn(), 'b');
  assert.equal(room.mutatorState.pendingCoinFlip, null);
});

test('all_on_red tails + ice_age with king on frozen file blocks king movement', async () => {
  const { gameManager, room, whiteSocket, io, roomEvents } = setupRoom({
    roomCode: 'AOI-6',
    fen: '4k3/8/8/8/8/8/K7/8 w - - 0 1',
  });
  activateRule(room, 'all_on_red', { chooser: 'w', remainingMoves: 3 });
  activateRule(room, 'ice_age');
  room.mutatorState.coinFlipResult = { result: 'tails', moveCount: room.mutatorState.moveCount };
  const before = room.chess.fen();

  await handleMove(io, whiteSocket, gameManager, { from: 'a2', to: 'a3' });

  const rejection = whiteSocket.emitted.find((e) => e.name === 'moveRejected');
  assert.ok(rejection);
  assert.equal(rejection.payload.error, 'Move blocked by active rule.');
  assert.equal(roomEvents.filter((e) => e.name === 'moveApplied').length, 0);
  assert.equal(room.chess.fen(), before);
});

test('deadlock/stuck-state sanity: tails + ice_age with frozen king does not create stuck pending state', async () => {
  const { gameManager, room, whiteSocket, io, roomEvents } = setupRoom({
    roomCode: 'AOI-7',
    fen: '4k3/8/8/8/8/8/K7/8 w - - 0 1',
  });
  activateRule(room, 'all_on_red', { chooser: 'w', remainingMoves: 3 });
  activateRule(room, 'ice_age');
  room.mutatorState.coinFlipResult = { result: 'tails', moveCount: room.mutatorState.moveCount };

  checkCoinFlipSkipTurn(room, io, 'w');
  assert.equal(roomEvents.some((e) => e.name === 'moveApplied' && e.payload?.skipTurn), false);

  const before = room.chess.fen();
  await handleMove(io, whiteSocket, gameManager, { from: 'a2', to: 'a3' });

  const rejection = whiteSocket.emitted.find((e) => e.name === 'moveRejected');
  assert.ok(rejection);
  assert.equal(rejection.payload.error, 'Move blocked by active rule.');
  assert.equal(room.chess.fen(), before);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.equal(roomEvents.some((e) => e.name === 'gameEnded'), false);

  const ended = checkMutatorDeadlock(room, io, gameManager);
  assert.equal(ended, true);
  assert.equal(roomEvents.some((e) => e.name === 'gameEnded'), true);
});
