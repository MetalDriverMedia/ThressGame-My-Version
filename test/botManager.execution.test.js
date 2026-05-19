const test = require('node:test');
const assert = require('node:assert/strict');

const { GameManager, GameRoom } = require('../gameManager');
const { createMutatorState } = require('../mutators/mutatorEngine');
const { performBotMove } = require('../botManager');
const { handleMove } = require('../handlers/moveHandler');
const { createIoRecorder } = require('./helpers/moveHandlerTestHelpers');

function createActiveBotRoom({ roomCode, fen, whiteIsBot = true }) {
  const room = new GameRoom(roomCode);
  room.addPlayer({ name: 'WhiteBot', color: 'w', socketId: 'bot-w', isBot: whiteIsBot });
  room.addPlayer({ name: 'BlackHuman', color: 'b', socketId: 'human-b', isBot: false });
  room.startGame();
  room.chess.load(fen);
  room.mutatorState = createMutatorState();
  room.status = 'active';
  return room;
}

function registerRoom(gameManager, room) {
  gameManager.rooms.set(room.roomCode, room);
  if (room.white) gameManager.setSocketRoom(room.white.socketId, room.roomCode);
  if (room.black) gameManager.setSocketRoom(room.black.socketId, room.roomCode);
}

test('performBotMove executes a legal move through handleMove and emits moveApplied', async () => {
  const gameManager = new GameManager();
  const { io, roomEvents } = createIoRecorder();
  const room = createActiveBotRoom({
    roomCode: 'BOTEX1',
    fen: '4k3/8/8/8/8/8/7p/7K b - - 0 1',
    whiteIsBot: false,
  });

  room.white = { name: 'WhiteHuman', color: 'w', socketId: 'human-w', isBot: false };
  room.black = { name: 'BlackBot', color: 'b', socketId: 'bot-b', isBot: true };
  registerRoom(gameManager, room);

  const beforeFen = room.chess.fen();
  await performBotMove(room, io, gameManager, handleMove);

  const moveApplied = roomEvents.filter((e) => e.name === 'moveApplied');
  assert.equal(moveApplied.length, 1);
  assert.equal(moveApplied[0].payload.color, 'b');
  assert.ok(moveApplied[0].payload.from);
  assert.ok(moveApplied[0].payload.to);
  assert.notEqual(room.chess.fen(), beforeFen);
  assert.equal(room.chess.turn(), 'w');
});

test('performBotMove applies pacman wrap move through handleMove', async () => {
  const gameManager = new GameManager();
  const { io, roomEvents } = createIoRecorder();
  const room = createActiveBotRoom({
    roomCode: 'BOTEX2',
    fen: '4k3/8/7n/P7/8/8/8/4K3 w - - 0 1',
  });
  room.mutatorState.activeRules.push({ rule: { id: 'pacman_style' } });
  registerRoom(gameManager, room);

  await performBotMove(room, io, gameManager, handleMove);

  assert.equal(room.chess.get('a5'), undefined);
  const wrappedPiece = room.chess.get('h6');
  assert.ok(wrappedPiece);
  assert.equal(wrappedPiece.type, 'p');
  assert.equal(wrappedPiece.color, 'w');

  const moveApplied = roomEvents.find((e) => e.name === 'moveApplied');
  assert.ok(moveApplied);
  assert.equal(moveApplied.payload.from, 'a5');
  assert.equal(moveApplied.payload.to, 'h6');
});

test('performBotMove applies short_stop synthetic move through handleMove', async () => {
  const gameManager = new GameManager();
  const { io, roomEvents } = createIoRecorder();
  const room = createActiveBotRoom({
    roomCode: 'BOTEX3',
    fen: '7k/8/8/8/8/8/1q6/1N2K3 w - - 0 1',
  });
  room.mutatorState.activeRules.push({ rule: { id: 'short_stop' } });
  registerRoom(gameManager, room);

  await performBotMove(room, io, gameManager, handleMove);

  assert.equal(room.chess.get('b1'), undefined);
  const movedKnight = room.chess.get('b2');
  assert.ok(movedKnight);
  assert.equal(movedKnight.type, 'n');
  assert.equal(movedKnight.color, 'w');

  const moveApplied = roomEvents.find((e) => e.name === 'moveApplied');
  assert.ok(moveApplied);
  assert.equal(moveApplied.payload.from, 'b1');
  assert.equal(moveApplied.payload.to, 'b2');
});

test('performBotMove exits early when room is inactive', async () => {
  const gameManager = new GameManager();
  const { io, roomEvents } = createIoRecorder();
  const room = createActiveBotRoom({ roomCode: 'BOTEX4', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' });
  registerRoom(gameManager, room);
  room.status = 'ended';

  let calls = 0;
  const beforeFen = room.chess.fen();
  await performBotMove(room, io, gameManager, async () => { calls++; });

  assert.equal(calls, 0);
  assert.equal(room.chess.fen(), beforeFen);
  assert.equal(roomEvents.some((e) => e.name === 'moveApplied'), false);
});

test('performBotMove exits early when current turn is human', async () => {
  const gameManager = new GameManager();
  const { io, roomEvents } = createIoRecorder();
  const room = createActiveBotRoom({ roomCode: 'BOTEX5', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' });
  room.white = { name: 'WhiteHuman', color: 'w', socketId: 'human-w', isBot: false };
  room.black = { name: 'BlackBot', color: 'b', socketId: 'bot-b', isBot: true };
  registerRoom(gameManager, room);

  let calls = 0;
  const beforeFen = room.chess.fen();
  await performBotMove(room, io, gameManager, async () => { calls++; });

  assert.equal(calls, 0);
  assert.equal(room.chess.fen(), beforeFen);
  assert.equal(roomEvents.some((e) => e.name === 'moveApplied'), false);
});

test('performBotMove defers when pendingChoice exists (no immediate handleMove call)', async () => {
  const gameManager = new GameManager();
  const { io } = createIoRecorder();
  const room = createActiveBotRoom({ roomCode: 'BOTEX6', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' });
  registerRoom(gameManager, room);
  room.mutatorState.pendingChoice = { chooser: 'w' };

  let calls = 0;
  const originalSetTimeout = global.setTimeout;
  try {
    global.setTimeout = () => 1;
    await performBotMove(room, io, gameManager, async () => { calls++; });
  } finally {
    global.setTimeout = originalSetTimeout;
  }

  assert.equal(calls, 0);
});

test('performBotMove does not log success or reschedule on rejected stale move', async () => {
  const gameManager = new GameManager();
  const { io } = createIoRecorder();
  const room = createActiveBotRoom({ roomCode: 'BOTEX7', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' });
  registerRoom(gameManager, room);

  let scheduled = 0;
  const originalSetTimeout = global.setTimeout;
  const originalLog = console.log;
  const logs = [];
  try {
    global.setTimeout = () => { scheduled++; return 1; };
    console.log = (...args) => logs.push(args.join(' '));
    await performBotMove(room, io, gameManager, async () => ({ applied: false, rejected: true }));
  } finally {
    global.setTimeout = originalSetTimeout;
    console.log = originalLog;
  }

  assert.equal(scheduled, 0);
  assert.equal(logs.some(l => l.includes('moved:')), false);
});

test('performBotMove stale rejection guard prevents repeated same-attempt loop', async () => {
  const gameManager = new GameManager();
  const { io } = createIoRecorder();
  const room = createActiveBotRoom({ roomCode: 'BOTEX8', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' });
  registerRoom(gameManager, room);

  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    await performBotMove(room, io, gameManager, async () => ({ applied: false, rejected: true }));
    const first = room._botStaleAttempt;
    await performBotMove(room, io, gameManager, async () => ({ applied: false, rejected: true }));
    assert.equal(room._botStaleAttempt, first);
  } finally {
    Math.random = originalRandom;
  }
});

test('scheduled bot callback does not execute when room instance is replaced before timer fires', async () => {
  const gameManager = new GameManager();
  const { io } = createIoRecorder();
  const room = createActiveBotRoom({ roomCode: 'BOTEX9', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' });
  registerRoom(gameManager, room);

  let scheduledCb;
  const originalSetTimeout = global.setTimeout;
  try {
    global.setTimeout = (cb) => {
      scheduledCb = cb;
      return 1;
    };
    const { scheduleBotMove } = require('../botManager');
    scheduleBotMove(room, io, gameManager, async () => ({ status: 'applied' }));
  } finally {
    global.setTimeout = originalSetTimeout;
  }

  const replacement = createActiveBotRoom({ roomCode: 'BOTEX9', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' });
  registerRoom(gameManager, replacement);

  let calls = 0;
  await scheduledCb?.();
  await performBotMove(room, io, gameManager, async () => { calls++; return { status: 'applied' }; });
  assert.equal(calls, 0);
});

test('performBotMove does not reschedule after deferred/rejected/ended/ignored statuses', async () => {
  const statuses = ['deferred', 'rejected', 'ended', 'ignored'];
  for (const status of statuses) {
    const gameManager = new GameManager();
    const { io } = createIoRecorder();
    const room = createActiveBotRoom({ roomCode: `BOTEX-${status}`, fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' });
    registerRoom(gameManager, room);

    let scheduled = 0;
    const originalSetTimeout = global.setTimeout;
    try {
      global.setTimeout = () => { scheduled++; return 1; };
      await performBotMove(room, io, gameManager, async () => ({ status }));
    } finally {
      global.setTimeout = originalSetTimeout;
    }
    assert.equal(scheduled, 0, `unexpected reschedule for status ${status}`);
  }
});


test('scheduleBotMove repeated scheduling for same state yields at most one applied bot move', async () => {
  const gameManager = new GameManager();
  const { io, roomEvents } = createIoRecorder();
  const room = createActiveBotRoom({ roomCode: 'BOTEX10', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' });
  registerRoom(gameManager, room);

  const callbacks = [];
  const originalSetTimeout = global.setTimeout;
  try {
    global.setTimeout = (cb) => { callbacks.push(cb); return { id: callbacks.length }; };
    const { scheduleBotMove } = require('../botManager');
    for (let i = 0; i < 3; i++) scheduleBotMove(room, io, gameManager, handleMove);
  } finally {
    global.setTimeout = originalSetTimeout;
  }

  assert.equal(callbacks.length, 3);
  for (const cb of callbacks) await cb();

  const moveApplied = roomEvents.filter((e) => e.name === 'moveApplied');
  assert.equal(moveApplied.length, 1);
  assert.equal(room.chess.turn(), 'b');
});

test('scheduled bot callback no-ops after room ends or bot turn ownership changes', async () => {
  const gameManager = new GameManager();
  const { io, roomEvents } = createIoRecorder();
  const room = createActiveBotRoom({ roomCode: 'BOTEX11', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' });
  registerRoom(gameManager, room);

  const originalSetTimeout = global.setTimeout;
  let scheduledCb;
  try {
    global.setTimeout = (cb) => { scheduledCb = cb; return 1; };
    const { scheduleBotMove } = require('../botManager');
    scheduleBotMove(room, io, gameManager, handleMove);
  } finally {
    global.setTimeout = originalSetTimeout;
  }

  room.endGame('disconnect', 'b');
  await scheduledCb?.();
  assert.equal(roomEvents.some((e) => e.name === 'moveApplied'), false);

  const room2 = createActiveBotRoom({ roomCode: 'BOTEX12', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' });
  registerRoom(gameManager, room2);
  let scheduledCb2;
  const originalSetTimeout2 = global.setTimeout;
  try {
    global.setTimeout = (cb) => { scheduledCb2 = cb; return 2; };
    const { scheduleBotMove } = require('../botManager');
    scheduleBotMove(room2, io, gameManager, handleMove);
  } finally {
    global.setTimeout = originalSetTimeout2;
  }

  room2.white.isBot = false;
  await scheduledCb2?.();
  const room2Moves = roomEvents.filter((e) => e.roomCode === 'BOTEX12' && e.name === 'moveApplied');
  assert.equal(room2Moves.length, 0);
});
