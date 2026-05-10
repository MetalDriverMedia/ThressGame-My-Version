const test = require('node:test');
const assert = require('node:assert/strict');

const { GameManager, GameRoom } = require('../gameManager');
const { createMutatorHandlers } = require('../handlers/mutatorHandler');
const { handleMove } = require('../handlers/moveHandler');
const { RULES } = require('../mutators/mutatorDefs');
const { triggerCoinFlip, checkCoinFlipSkipTurn } = require('../utils/gameLifecycle');
const turnClock = require('../utils/turnClock');
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

function withMockedRandomSequence(values, fn) {
  const originalRandom = Math.random;
  let i = 0;
  Math.random = () => {
    const value = values[i] ?? values[values.length - 1];
    i += 1;
    return value;
  };
  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

function setupCoinFlipRoom({ roomCode = 'CFLP1', fen = null, manualCoinFlip = false, whiteIsBot = false, blackIsBot = false } = {}) {
  const gameManager = new GameManager();
  const room = new GameRoom(roomCode);
  room.addPlayer({ name: 'White', color: 'w', socketId: 'sock-w', isBot: whiteIsBot });
  room.addPlayer({ name: 'Black', color: 'b', socketId: 'sock-b', isBot: blackIsBot });
  room.startGame();
  if (fen) room.chess.load(fen, { skipValidation: true });
  room.manualCoinFlip = manualCoinFlip;
  room.mutatorState = room.mutatorState || { moveCount: 0, activeRules: [] };

  roomsToCleanup.add(room);

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

  return { gameManager, room, whiteSocket, blackSocket, io, roomEvents };
}

function activateAllOnRed(room, chooser = 'w', duration = 3) {
  room.mutatorState.activeRules.push({ rule: getRule('all_on_red'), chooser, remainingMoves: duration });
}

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});

test('triggerCoinFlip manual mode creates pendingCoinFlip and emits prompt', () => {
  const { room, io, roomEvents } = setupCoinFlipRoom({ roomCode: 'CFLP-A', manualCoinFlip: true });

  triggerCoinFlip(room, io, 'w');

  assert.deepEqual(room.mutatorState.pendingCoinFlip, { forPlayer: 'w', moveCount: room.mutatorState.moveCount });
  assert.equal(room.mutatorState.coinFlipResult, null);
  const prompt = roomEvents.find((e) => e.name === 'coinFlipPrompt');
  assert.ok(prompt);
  assert.equal(prompt.payload.forPlayer, 'w');
  assert.equal(roomEvents.some((e) => e.name === 'coinFlipResult' || e.name === 'coinFlip'), false);
});

test('triggerCoinFlip auto mode heads stores result and emits coinFlip', () => {
  const { room, io, roomEvents } = setupCoinFlipRoom({ roomCode: 'CFLP-B' });

  withMockedRandomSequence([0.1], () => triggerCoinFlip(room, io, 'w'));

  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.equal(room.mutatorState.coinFlipResult.result, 'heads');
  assert.equal(room.mutatorState.coinFlipResult.moveCount, room.mutatorState.moveCount);
  assert.ok(roomEvents.find((e) => e.name === 'coinFlip'));
});

test('triggerCoinFlip auto mode tails stores result and emits coinFlipResult for bot target', () => {
  const { room, io, roomEvents } = setupCoinFlipRoom({ roomCode: 'CFLP-C', whiteIsBot: true });

  withMockedRandomSequence([0.9], () => triggerCoinFlip(room, io, 'w'));

  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.equal(room.mutatorState.coinFlipResult.result, 'tails');
  assert.equal(room.mutatorState.coinFlipResult.moveCount, room.mutatorState.moveCount);
  const evt = roomEvents.find((e) => e.name === 'coinFlipResult');
  assert.ok(evt);
  assert.equal(evt.payload.result, 'tails');
});

test('triggerCoinFlip does not double-trigger during same moveCount', () => {
  const { room, io, roomEvents } = setupCoinFlipRoom({ roomCode: 'CFLP-D', manualCoinFlip: true });

  triggerCoinFlip(room, io, 'w');
  const firstPending = { ...room.mutatorState.pendingCoinFlip };
  const firstCount = roomEvents.length;
  triggerCoinFlip(room, io, 'w');

  assert.equal(roomEvents.length, firstCount);
  assert.deepEqual(room.mutatorState.pendingCoinFlip, firstPending);
});

test('pendingCoinFlip blocks affected player movement', async () => {
  const { gameManager, room, whiteSocket } = setupCoinFlipRoom({ roomCode: 'CFLP-E' });
  const before = room.chess.fen();
  room.mutatorState.pendingCoinFlip = { forPlayer: 'w', moveCount: room.mutatorState.moveCount };

  await handleMove({ to: () => ({ emit: () => {} }), sockets: { sockets: new Map() } }, whiteSocket, gameManager, { from: 'e2', to: 'e4' });

  const rejection = whiteSocket.emitted.find((e) => e.name === 'moveRejected');
  assert.ok(rejection);
  assert.equal(rejection.payload.message, 'Flip the coin first!');
  assert.equal(room.chess.fen(), before);
  assert.ok(room.mutatorState.pendingCoinFlip);
});

test('pendingCoinFlip does not block unaffected player movement', async () => {
  const { gameManager, room, blackSocket, roomEvents, io } = setupCoinFlipRoom({ roomCode: 'CFLP-F', fen: '4k3/8/8/8/8/8/8/4K3 b - - 0 1' });
  room.mutatorState.pendingCoinFlip = { forPlayer: 'w', moveCount: room.mutatorState.moveCount };

  await handleMove(io, blackSocket, gameManager, { from: 'e8', to: 'e7' });

  assert.ok(roomEvents.find((e) => e.name === 'moveApplied'));
  assert.equal(blackSocket.emitted.some((e) => e.name === 'moveRejected'), false);
});

test('all_on_red heads allows normal non-king movement', async () => {
  const { gameManager, room, whiteSocket, roomEvents, io } = setupCoinFlipRoom({ roomCode: 'CFLP-G' });
  activateAllOnRed(room);
  room.mutatorState.coinFlipResult = { result: 'heads', moveCount: room.mutatorState.moveCount };

  await handleMove(io, whiteSocket, gameManager, { from: 'e2', to: 'e4' });

  assert.ok(roomEvents.find((e) => e.name === 'moveApplied'));
});

test('all_on_red tails blocks non-king movement', async () => {
  const { gameManager, room, whiteSocket } = setupCoinFlipRoom({ roomCode: 'CFLP-H' });
  const before = room.chess.fen();
  activateAllOnRed(room);
  room.mutatorState.coinFlipResult = { result: 'tails', moveCount: room.mutatorState.moveCount };

  await handleMove({ to: () => ({ emit: () => {} }), sockets: { sockets: new Map() } }, whiteSocket, gameManager, { from: 'e2', to: 'e4' });

  const rejection = whiteSocket.emitted.find((e) => e.name === 'moveRejected');
  assert.ok(rejection);
  assert.equal(rejection.payload.error, 'Move blocked by active rule.');
  assert.equal(room.chess.fen(), before);
});

test('all_on_red tails allows king movement', async () => {
  const { gameManager, room, whiteSocket, roomEvents, io } = setupCoinFlipRoom({ roomCode: 'CFLP-I', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' });
  activateAllOnRed(room);
  room.mutatorState.coinFlipResult = { result: 'tails', moveCount: room.mutatorState.moveCount };

  await handleMove(io, whiteSocket, gameManager, { from: 'e1', to: 'd1' });

  assert.ok(roomEvents.find((e) => e.name === 'moveApplied'));
});

test('checkCoinFlipSkipTurn does nothing on heads', () => {
  const { room, io, roomEvents } = setupCoinFlipRoom({ roomCode: 'CFLP-J' });
  const beforeTurn = room.chess.turn();
  room.mutatorState.coinFlipResult = { result: 'heads', moveCount: room.mutatorState.moveCount };

  checkCoinFlipSkipTurn(room, io, 'w');

  assert.equal(room.chess.turn(), beforeTurn);
  assert.equal(roomEvents.some((e) => e.name === 'moveApplied' && e.payload?.skipTurn), false);
});

test('checkCoinFlipSkipTurn does nothing on tails when king has legal move', () => {
  const { room, io, roomEvents } = setupCoinFlipRoom({ roomCode: 'CFLP-K', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' });
  const beforeTurn = room.chess.turn();
  room.mutatorState.coinFlipResult = { result: 'tails', moveCount: room.mutatorState.moveCount };

  checkCoinFlipSkipTurn(room, io, 'w');

  assert.equal(room.chess.turn(), beforeTurn);
  assert.equal(roomEvents.some((e) => e.name === 'moveApplied' && e.payload?.skipTurn), false);
});

test('checkCoinFlipSkipTurn skips turn on tails when king has no legal moves', () => {
  const { room, io, roomEvents } = setupCoinFlipRoom({ roomCode: 'CFLP-L', fen: '7k/8/8/8/8/8/PP6/KP6 w - - 0 1' });
  room.mutatorState.coinFlipResult = { result: 'tails', moveCount: room.mutatorState.moveCount };

  checkCoinFlipSkipTurn(room, io, 'w');

  assert.equal(room.chess.turn(), 'b');
  const skipEvent = roomEvents.find((e) => e.name === 'moveApplied' && e.payload?.skipTurn);
  assert.ok(skipEvent);
  assert.equal(skipEvent.payload.from, null);
  assert.equal(skipEvent.payload.to, null);
  assert.equal(skipEvent.payload.san, '(skipped)');
  assert.equal(skipEvent.payload.skipMessage, 'No valid King moves -- turn skipped!');
});

test('coinFlipChoice validates payload and enforces pending player before applying result', () => {
  const { gameManager, room, whiteSocket, blackSocket, io, roomEvents } = setupCoinFlipRoom({ roomCode: 'CFLP-M', manualCoinFlip: true });
  room.mutatorState.pendingCoinFlip = { forPlayer: 'w', moveCount: room.mutatorState.moveCount };

  whiteSocket.trigger('coinFlipChoice', null);
  whiteSocket.trigger('coinFlipChoice', { choice: 'bad' });
  assert.ok(room.mutatorState.pendingCoinFlip);
  assert.equal(roomEvents.some((e) => e.name === 'coinFlipResult'), false);

  blackSocket.trigger('coinFlipChoice', { choice: 'heads' });
  assert.ok(room.mutatorState.pendingCoinFlip);
  assert.equal(roomEvents.some((e) => e.name === 'coinFlipResult'), false);

  const unmapped = createRegisteredSocket('sock-z');
  const handlers = createMutatorHandlers({ handleMove, scheduleBotMove: () => {}, generateBotTarget: () => null });
  handlers.registerSocketHandlers(unmapped, io, gameManager);
  unmapped.trigger('coinFlipChoice', { choice: 'heads' });
  assert.ok(room.mutatorState.pendingCoinFlip);

  whiteSocket.trigger('coinFlipChoice', { choice: 'tails' });
  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.deepEqual(room.mutatorState.coinFlipResult, { result: 'tails', moveCount: room.mutatorState.moveCount });
  assert.ok(roomEvents.find((e) => e.name === 'coinFlipResult' && e.payload.result === 'tails'));
});

test('triggerCoinFlip does not run while pendingAction or pendingRPS is unresolved', () => {
  const { room, io, roomEvents } = setupCoinFlipRoom({ roomCode: 'CFLP-PEND-BLOCK', manualCoinFlip: true });
  room.mutatorState.pendingAction = { ruleId: 'drafted', actionType: 'square', forPlayer: 'w' };
  triggerCoinFlip(room, io, 'w');
  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.equal(roomEvents.some((e) => e.name === 'coinFlipPrompt' || e.name === 'coinFlip' || e.name === 'coinFlipResult'), false);

  room.mutatorState.pendingAction = null;
  room.mutatorState.pendingRPS = { attacker: 'w', defender: 'b', move: { from: 'e2', to: 'e4', promotion: null } };
  triggerCoinFlip(room, io, 'w');
  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.equal(roomEvents.some((e) => e.name === 'coinFlipPrompt' || e.name === 'coinFlip' || e.name === 'coinFlipResult'), false);
});
