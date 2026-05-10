const test = require('node:test');
const assert = require('node:assert/strict');

const { handleMove } = require('../handlers/moveHandler');
const { createMutatorHandlers } = require('../handlers/mutatorHandler');
const { GameManager } = require('../gameManager');
const turnClock = require('../utils/turnClock');
const {
  createIoRecorder,
  createRegisteredSocket,
  createParryCaptureSetup,
} = require('./helpers/moveHandlerTestHelpers');


const roomsToCleanup = new Set();

function createTrackedParryRoom(roomCode) {
  const room = createParryCaptureSetup(roomCode);
  roomsToCleanup.add(room);
  return room;
}

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});
test('parry RPS resolution: attacker win proceeds capture via socket rpsChoice handlers', async () => {
  const gameManager = new GameManager();
  const room = createTrackedParryRoom('MVT32');
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

  const result = await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });
  assert.deepEqual(result, { status: 'deferred', reason: 'pendingRPS', pending: 'pendingRPS' });
  assert.ok(room.mutatorState.pendingRPS);

  whiteSocket.trigger('rpsChoice', { choice: 'rock' });
  assert.ok(room.mutatorState.pendingRPS);
  blackSocket.trigger('rpsChoice', { choice: 'scissors' });

  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.chess.get('d1'), undefined);
  assert.equal(room.chess.get('d2').type, 'q');
  assert.equal(room.chess.turn(), 'b');
  assert.equal(room.mutatorState.rpsResolved, false);

  const rpsResult = roomEvents.find(e => e.name === 'rpsResult');
  assert.ok(rpsResult);
  assert.equal(rpsResult.payload.captureProceeds, true);

  const moveApplied = roomEvents.filter(e => e.name === 'moveApplied');
  assert.equal(moveApplied.length, 1);
  assert.equal(moveApplied[0].payload.from, 'd1');
  assert.equal(moveApplied[0].payload.to, 'd2');
  assert.equal(moveApplied[0].payload.captured, 'p');
});

test('parry RPS resolution: tie also proceeds capture', async () => {
  const gameManager = new GameManager();
  const room = createTrackedParryRoom('MVT36');
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

  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });
  whiteSocket.trigger('rpsChoice', { choice: 'paper' });
  blackSocket.trigger('rpsChoice', { choice: 'paper' });

  const rpsResult = roomEvents.find(e => e.name === 'rpsResult');
  assert.ok(rpsResult);
  assert.equal(rpsResult.payload.outcome, 'tie');
  assert.equal(rpsResult.payload.captureProceeds, true);
  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.chess.get('d2').type, 'q');
});

test('parry RPS resolution: defender win blocks capture and skips attacker turn', async () => {
  const gameManager = new GameManager();
  const room = createTrackedParryRoom('MVT33');
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);
  gameManager.setSocketRoom('sock-b', room.roomCode);

  const whiteSocket = createRegisteredSocket('sock-w');
  const blackSocket = createRegisteredSocket('sock-b');
  const { io, roomEvents } = createIoRecorder();

  const handlers = createMutatorHandlers({ handleMove, scheduleBotMove: () => {}, generateBotTarget: () => null });
  handlers.registerSocketHandlers(whiteSocket, io, gameManager);
  handlers.registerSocketHandlers(blackSocket, io, gameManager);

  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });
  blackSocket.trigger('rpsChoice', { choice: 'paper' });
  whiteSocket.trigger('rpsChoice', { choice: 'rock' });

  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.chess.get('d1').type, 'q');
  assert.equal(room.chess.get('d2').type, 'p');
  assert.equal(room.chess.turn(), 'b');

  const rpsResult = roomEvents.find(e => e.name === 'rpsResult');
  assert.ok(rpsResult);
  assert.equal(rpsResult.payload.captureProceeds, false);

  const blocked = roomEvents.filter(e => e.name === 'moveApplied').at(-1);
  assert.equal(blocked.payload.from, null);
  assert.equal(blocked.payload.to, null);
  assert.equal(blocked.payload.san, '(blocked)');
  assert.equal(blocked.payload.skipTurn, true);
  assert.equal(blocked.payload.skipMessage, 'Parry! Capture was blocked -- turn lost!');
});

test('parry RPS resolution: single valid choice does not resolve', async () => {
  const gameManager = new GameManager();
  const room = createTrackedParryRoom('MVT34');
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);
  gameManager.setSocketRoom('sock-b', room.roomCode);

  const whiteSocket = createRegisteredSocket('sock-w');
  const blackSocket = createRegisteredSocket('sock-b');
  const { io, roomEvents } = createIoRecorder();

  const handlers = createMutatorHandlers({ handleMove, scheduleBotMove: () => {}, generateBotTarget: () => null });
  handlers.registerSocketHandlers(whiteSocket, io, gameManager);
  handlers.registerSocketHandlers(blackSocket, io, gameManager);

  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });
  whiteSocket.trigger('rpsChoice', { choice: 'rock' });

  assert.ok(room.mutatorState.pendingRPS);
  assert.equal(roomEvents.some(e => e.name === 'rpsResult'), false);
  assert.equal(roomEvents.some(e => e.name === 'moveApplied'), false);
});

test('parry RPS resolution: invalid or unrelated rpsChoice is ignored', async () => {
  const gameManager = new GameManager();
  const room = createTrackedParryRoom('MVT35');
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);
  gameManager.setSocketRoom('sock-b', room.roomCode);
  gameManager.setSocketRoom('sock-x', room.roomCode);

  const whiteSocket = createRegisteredSocket('sock-w');
  const blackSocket = createRegisteredSocket('sock-b');
  const outsiderSocket = createRegisteredSocket('sock-x');
  const { io, roomEvents } = createIoRecorder();

  const handlers = createMutatorHandlers({ handleMove, scheduleBotMove: () => {}, generateBotTarget: () => null });
  handlers.registerSocketHandlers(whiteSocket, io, gameManager);
  handlers.registerSocketHandlers(blackSocket, io, gameManager);
  handlers.registerSocketHandlers(outsiderSocket, io, gameManager);

  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });
  whiteSocket.trigger('rpsChoice', { choice: 'lizard' });
  outsiderSocket.trigger('rpsChoice', { choice: 'paper' });

  assert.ok(room.mutatorState.pendingRPS);
  assert.equal(room.mutatorState.pendingRPS.attackerChoice, null);
  assert.equal(room.mutatorState.pendingRPS.defenderChoice, null);
  assert.equal(roomEvents.some(e => e.name === 'rpsResult'), false);
});
