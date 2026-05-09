const test = require('node:test');
const assert = require('node:assert/strict');

const { GameManager } = require('../gameManager');
const { handleMove } = require('../handlers/moveHandler');
const { createMutatorHandlers } = require('../handlers/mutatorHandler');
const {
  createIoRecorder,
  createRegisteredSocket,
  createParryCaptureSetup,
} = require('./helpers/moveHandlerTestHelpers');

function withImmediateTimers(fn) {
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (cb) => {
    cb();
    return 1;
  };
  try {
    return fn();
  } finally {
    global.setTimeout = originalSetTimeout;
  }
}

function withMockedRandomSequence(values, fn) {
  const originalRandom = Math.random;
  let idx = 0;
  Math.random = () => {
    const value = values[Math.min(idx, values.length - 1)] ?? 0;
    idx += 1;
    return value;
  };
  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

function withCapturedTimeout(fn) {
  const originalSetTimeout = global.setTimeout;
  const callbacks = [];
  global.setTimeout = (cb) => {
    callbacks.push(cb);
    return callbacks.length;
  };
  try {
    return fn({
      flushAll() {
        while (callbacks.length > 0) callbacks.shift()();
      },
      pendingCount() {
        return callbacks.length;
      },
    });
  } finally {
    global.setTimeout = originalSetTimeout;
  }
}

function setupParryRoom({ roomCode, whiteIsBot, blackIsBot }) {
  const gameManager = new GameManager();
  const room = createParryCaptureSetup(roomCode);
  room.white = { name: whiteIsBot ? 'WhiteBot' : 'WhiteHuman', color: 'w', socketId: whiteIsBot ? 'bot-w' : 'sock-w', isBot: whiteIsBot };
  room.black = { name: blackIsBot ? 'BlackBot' : 'BlackHuman', color: 'b', socketId: blackIsBot ? 'bot-b' : 'sock-b', isBot: blackIsBot };

  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom(room.white.socketId, room.roomCode);
  gameManager.setSocketRoom(room.black.socketId, room.roomCode);

  const { io, roomEvents } = createIoRecorder();
  const whiteSocket = whiteIsBot ? null : createRegisteredSocket(room.white.socketId);
  const blackSocket = blackIsBot ? null : createRegisteredSocket(room.black.socketId);

  if (whiteSocket) io.sockets.sockets.set(room.white.socketId, whiteSocket);
  if (blackSocket) io.sockets.sockets.set(room.black.socketId, blackSocket);

  const handlers = createMutatorHandlers({
    handleMove,
    scheduleBotMove: () => {},
    generateBotTarget: () => null,
  });

  if (whiteSocket) handlers.registerSocketHandlers(whiteSocket, io, gameManager);
  if (blackSocket) handlers.registerSocketHandlers(blackSocket, io, gameManager);

  return { gameManager, room, io, roomEvents, whiteSocket, blackSocket, handlers };
}

test('human attacker vs bot defender: bot auto-RPS loses and capture proceeds', async () => {
  const { gameManager, room, io, roomEvents, whiteSocket, handlers } = setupParryRoom({ roomCode: 'BPR01', whiteIsBot: false, blackIsBot: true });

  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });
  assert.ok(room.mutatorState.pendingRPS);
  assert.ok(roomEvents.some((e) => e.name === 'rpsPrompt'));

  withImmediateTimers(() => withMockedRandomSequence([0.95, 0.9], () => {
    handlers.botAutoMutatorResponse(room, io, gameManager);
  }));
  assert.equal(room.mutatorState.pendingRPS.defenderChoice, 'scissors');

  whiteSocket.trigger('rpsChoice', { choice: 'rock' });

  const rpsResult = roomEvents.find((e) => e.name === 'rpsResult');
  const moveApplied = roomEvents.find((e) => e.name === 'moveApplied');
  assert.equal(room.mutatorState.pendingRPS, null);
  assert.ok(rpsResult);
  assert.equal(rpsResult.payload.captureProceeds, true);
  assert.equal(room.chess.get('d1'), undefined);
  assert.equal(room.chess.get('d2').type, 'q');
  assert.equal(moveApplied.payload.from, 'd1');
  assert.equal(moveApplied.payload.to, 'd2');
});

test('human attacker vs bot defender: bot auto-RPS wins and capture is blocked', async () => {
  const { gameManager, room, io, roomEvents, whiteSocket, handlers } = setupParryRoom({ roomCode: 'BPR02', whiteIsBot: false, blackIsBot: true });

  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });

  withImmediateTimers(() => withMockedRandomSequence([0.6, 0.4], () => {
    handlers.botAutoMutatorResponse(room, io, gameManager);
  }));
  assert.equal(room.mutatorState.pendingRPS.defenderChoice, 'paper');

  whiteSocket.trigger('rpsChoice', { choice: 'rock' });

  const rpsResult = roomEvents.find((e) => e.name === 'rpsResult');
  const blocked = roomEvents.filter((e) => e.name === 'moveApplied').at(-1);
  assert.equal(room.mutatorState.pendingRPS, null);
  assert.ok(rpsResult);
  assert.equal(rpsResult.payload.captureProceeds, false);
  assert.equal(room.chess.get('d1').type, 'q');
  assert.equal(room.chess.get('d2').type, 'p');
  assert.equal(room.chess.turn(), 'b');
  assert.equal(blocked.payload.from, null);
  assert.equal(blocked.payload.to, null);
  assert.equal(blocked.payload.san, '(blocked)');
  assert.equal(blocked.payload.skipTurn, true);
  assert.equal(blocked.payload.skipMessage, 'Parry! Capture was blocked -- turn lost!');
});

test('bot attacker vs human defender: bot auto-choice resolves when human submits rpsChoice', async () => {
  const { gameManager, room, io, roomEvents, blackSocket, handlers } = setupParryRoom({ roomCode: 'BPR03', whiteIsBot: true, blackIsBot: false });

  const botSocket = { id: 'bot-w', emit() {} };
  await handleMove(io, botSocket, gameManager, { from: 'd1', to: 'd2' });

  withImmediateTimers(() => withMockedRandomSequence([0.9, 0.75], () => {
    handlers.botAutoMutatorResponse(room, io, gameManager);
  }));
  assert.equal(room.mutatorState.pendingRPS.attackerChoice, 'scissors');

  blackSocket.trigger('rpsChoice', { choice: 'paper' });

  const rpsResult = roomEvents.find((e) => e.name === 'rpsResult');
  const moveApplied = roomEvents.find((e) => e.name === 'moveApplied');
  assert.equal(room.mutatorState.pendingRPS, null);
  assert.ok(rpsResult);
  assert.equal(rpsResult.payload.outcome, 'attacker');
  assert.equal(rpsResult.payload.captureProceeds, true);
  assert.equal(room.chess.get('d1'), undefined);
  assert.equal(room.chess.get('d2').type, 'q');
  assert.equal(moveApplied.payload.from, 'd1');
  assert.equal(moveApplied.payload.to, 'd2');
});

test('bot vs bot: botAutoMutatorResponse resolves both RPS choices deterministically', async () => {
  const { gameManager, room, io, roomEvents, handlers } = setupParryRoom({ roomCode: 'BPR04', whiteIsBot: true, blackIsBot: true });

  const botSocket = { id: 'bot-w', emit() {} };
  await handleMove(io, botSocket, gameManager, { from: 'd1', to: 'd2' });

  withCapturedTimeout(({ flushAll, pendingCount }) => withMockedRandomSequence([0.1, 0.1, 0.4], () => {
    handlers.botAutoMutatorResponse(room, io, gameManager);
    assert.equal(pendingCount(), 1);
    flushAll();
  }));

  const rpsResult = roomEvents.find((e) => e.name === 'rpsResult');
  const blocked = roomEvents.filter((e) => e.name === 'moveApplied').at(-1);
  assert.equal(room.mutatorState.pendingRPS, null);
  assert.ok(rpsResult);
  assert.ok(rpsResult.payload.attackerChoice);
  assert.ok(rpsResult.payload.defenderChoice);
  assert.equal(rpsResult.payload.captureProceeds, false);
  assert.equal(blocked.payload.san, '(blocked)');
});

test('botAutoMutatorResponse is a no-op when no pendingRPS exists', () => {
  const { gameManager, room, io, roomEvents, handlers } = setupParryRoom({ roomCode: 'BPR05', whiteIsBot: true, blackIsBot: true });
  room.mutatorState.pendingRPS = null;

  withImmediateTimers(() => withMockedRandomSequence([0.2], () => {
    handlers.botAutoMutatorResponse(room, io, gameManager);
  }));

  assert.equal(roomEvents.some((e) => e.name === 'rpsResult'), false);
  assert.equal(roomEvents.some((e) => e.name === 'moveApplied'), false);
});
