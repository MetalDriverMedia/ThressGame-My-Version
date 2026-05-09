const test = require('node:test');
const assert = require('node:assert/strict');

const { GameRoom, GameManager } = require('../gameManager');
const { createPlayer } = require('../gameController');
const { handleCreateRoom, handleJoinRoom, handleJoinBot, handleListRooms } = require('../handlers/joinHandler');
const {
  emitGameEnded,
  scheduleRoomDeletion,
  autoResignOnTimeout,
} = require('../utils/gameLifecycle');

function createSocket(id = 'sock-1') {
  return {
    id,
    handshake: { headers: {}, address: '127.0.0.1' },
    emitted: [],
    joined: [],
    left: [],
    emit(name, payload) { this.emitted.push({ name, payload }); },
    join(roomCode) { this.joined.push(roomCode); },
    leave(roomCode) { this.left.push(roomCode); },
  };
}

function createIoRecorder() {
  const roomEvents = [];
  const sockets = new Map();
  return {
    roomEvents,
    io: {
      sockets: { sockets },
      to(roomCode) {
        return {
          emit(name, payload) {
            roomEvents.push({ roomCode, name, payload });
          },
        };
      },
    },
  };
}

function createBroadcastSpy() {
  const calls = [];
  const fn = (...args) => calls.push(args);
  fn.calls = calls;
  return fn;
}

function createStartGameSpy(io) {
  const calls = [];
  const fn = (room) => {
    calls.push(room.roomCode);
    room.startGame();
    if (io) io.to(room.roomCode).emit('gameStarted', { roomCode: room.roomCode });
  };
  fn.calls = calls;
  return fn;
}

function createBotAdderSpy() {
  const calls = [];
  const fn = (room, botColor) => {
    calls.push({ roomCode: room.roomCode, botColor });
    room.addPlayer(createPlayer('bot-socket', 'Bot', 'bot-hash', botColor, true));
  };
  fn.calls = calls;
  return fn;
}

test('GameRoom constructor defaults are waiting-room clean', () => {
  const room = new GameRoom('ABCD');
  assert.equal(room.status, 'waiting');
  assert.ok(room.chess);
  assert.equal(room.white, null);
  assert.equal(room.black, null);
  assert.deepEqual(room.moveHistory, []);
  assert.equal(room.mutatorState, null);
  assert.ok(room.spectators instanceof Set);
  assert.equal(room.spectatingDisabled, false);
  assert.ok(room.disconnectTimers instanceof Map);
  assert.ok(Number.isFinite(room.createdAt));
  assert.equal(room.endedAt, null);
  assert.equal(room.isFull(), false);
  assert.equal(room.isJoinable(), true);
  assert.equal(room.getOpenColor(), 'w');
});

test('GameRoom player add/remove/get helpers work', () => {
  const room = new GameRoom('ABCD');
  const white = createPlayer('s1', 'W', 'h1', 'w', false);
  const blackBot = createPlayer('s2', 'B', 'h2', 'b', true);
  room.addPlayer(white);
  room.addPlayer(blackBot);
  assert.equal(room.getPlayer('w'), white);
  assert.equal(room.getPlayer('b'), blackBot);
  assert.equal(room.getPlayerBySocket('s1'), white);
  assert.equal(room.getPlayerByToken(blackBot.token), blackBot);
  assert.equal(room.getOpponent('w'), blackBot);
  assert.equal(room.getPlayerCount(), 2);
  assert.equal(room.getHumanCount(), 1);
  room.removePlayer('b');
  assert.equal(room.black, null);
  assert.equal(room.getPlayerCount(), 1);
});

test('GameRoom.startGame transitions to active and initializes mutator state', () => {
  const room = new GameRoom('ABCD');
  const fenBefore = room.chess.fen();
  room.startGame();
  assert.equal(room.status, 'active');
  assert.ok(room.mutatorState);
  assert.ok(Array.isArray(room.mutatorState.activeRules));
  assert.ok('moveCount' in room.mutatorState);
  assert.equal(room.chess.fen(), fenBefore);
  assert.deepEqual(room.moveHistory, []);
});

test('GameRoom.endGame transitions and clears disconnect timers', () => {
  const room = new GameRoom('ABCD');
  const cleared = [];
  const original = global.clearTimeout;
  try {
    global.clearTimeout = (id) => cleared.push(id);
    room.disconnectTimers.set('w', 101);
    room.disconnectTimers.set('b', 202);
    room.endGame('resignation', 'w');
    assert.equal(room.status, 'ended');
    assert.ok(Number.isFinite(room.endedAt));
    assert.equal(room.endReason, 'resignation');
    assert.equal(room.winner, 'w');
    assert.deepEqual(cleared, [101, 202]);
    assert.equal(room.disconnectTimers.size, 0);
  } finally { global.clearTimeout = original; }
});

test('GameManager room creation/deletion/stats/cleanup lifecycle', () => {
  const manager = new GameManager();
  const r1 = manager.createRoom(false);
  const r2 = manager.createRoom(true);
  assert.notEqual(r1.roomCode, r2.roomCode);
  assert.equal(manager.getRoom(r1.roomCode), r1);
  assert.equal(r2.isPrivate, true);
  assert.ok(manager.getAllRooms().includes(r1));
  assert.ok(manager.getActiveRooms().includes(r1));

  const p1 = createPlayer('s1', 'A', 'h1', 'w', false);
  const p2 = createPlayer('s2', 'B', 'h2', 'b', false);
  r1.addPlayer(p1); r1.addPlayer(p2);
  manager.setSocketRoom('s1', r1.roomCode); manager.setSocketRoom('s2', r1.roomCode);
  manager.setTokenRoom(p1.token, r1.roomCode); manager.setTokenRoom(p2.token, r1.roomCode);

  const oldNow = Date.now;
  Date.now = () => 1_000_000;
  r1.status = 'ended'; r1.endedAt = 1_000_000 - (6 * 60 * 1000);
  r2.status = 'waiting';
  const r3 = manager.createRoom(false); r3.status = 'active';
  const r4 = manager.createRoom(false); r4.status = 'ended'; r4.endedAt = 1_000_000 - (2 * 60 * 1000);
  manager.cleanupOldRooms();
  Date.now = oldNow;

  assert.equal(manager.getRoom(r1.roomCode), null);
  assert.ok(manager.getRoom(r2.roomCode));
  assert.ok(manager.getRoom(r3.roomCode));
  assert.ok(manager.getRoom(r4.roomCode));
  assert.equal(manager.getRoomForSocket('s1'), null);
  assert.equal(manager.getRoomForToken(p1.token), null);
  manager.deleteRoom('MISSING');

  const stats = manager.getStats();
  assert.equal(stats.waiting, 1);
  assert.equal(stats.active, 1);
  assert.equal(stats.ended, 1);
});

test('GameRoom summary and spectatable behavior', () => {
  const room = new GameRoom('ABCD');
  room.isPrivate = false;
  room.disabledMutators = new Set(['parry']);
  room.manualCoinFlip = true;
  room.addPlayer(createPlayer('s1', 'A', 'h1', 'w', false));
  room.addPlayer(createPlayer('s2', 'B', 'h2', 'b', false));
  room.status = 'active';
  room.spectators.add('spec1');
  const summary = room.getSummary();
  assert.equal(summary.roomCode, 'ABCD');
  assert.equal(summary.playerCount, 2);
  assert.deepEqual(summary.disabledMutators, ['parry']);
  assert.equal(summary.manualCoinFlip, true);
  assert.equal(summary.spectatorCount, 1);
  assert.equal(room.isSpectatable(), true);
  room.status = 'waiting';
  assert.equal(room.isSpectatable(), false);
  room.status = 'active';
  room.black.isBot = true;
  assert.equal(room.isSpectatable(), false);
  room.black.isBot = false;
  room.spectatingDisabled = true;
  assert.equal(room.isSpectatable(), false);
});

test('join handlers create/join/start/bot and duplicate-hash rejection', () => {
  const manager = new GameManager();
  const { io } = createIoRecorder();
  const broadcast = createBroadcastSpy();
  const s1 = createSocket('sock-a');
  const s2 = createSocket('sock-b');
  const s3 = createSocket('sock-c');

  handleCreateRoom(io, s1, manager, { name: '###' }, broadcast);
  assert.equal(s1.emitted.at(-1).name, 'joinError');

  handleCreateRoom(io, s1, manager, { name: 'Alice', preferredColor: 'w', browserId: 'same-id-1', disabledMutators: ['x'], manualCoinFlip: true }, broadcast);
  const okCreate = s1.emitted.find(e => e.name === 'joinSuccess');
  assert.ok(okCreate);
  const code = okCreate.payload.roomCode;
  assert.ok(manager.getRoom(code));
  assert.deepEqual(s1.left, ['lobby']);
  assert.deepEqual(s1.joined, [code]);
  assert.ok(broadcast.calls.length >= 1);
  assert.equal(okCreate.payload.color, 'w');
  assert.equal(okCreate.payload.status, 'waiting');
  assert.ok(okCreate.payload.board);
  assert.equal(okCreate.payload.manualCoinFlip, true);
  assert.equal(okCreate.payload.disabledMutatorCount, 1);
  const createdRoom = manager.getRoom(code);
  assert.equal(createdRoom.disabledMutators.has('x'), true);
  assert.equal(createdRoom.manualCoinFlip, true);
  assert.equal(manager.getRoomForSocket('sock-a'), createdRoom);
  assert.equal(manager.getRoomForToken(okCreate.payload.token), createdRoom);

  const startSpy = createStartGameSpy(io);
  handleJoinRoom(io, s2, manager, { name: 'Bob', roomCode: '??' }, startSpy, broadcast);
  assert.equal(s2.emitted.at(-1).name, 'joinError');
  handleJoinRoom(io, s2, manager, { name: 'Bob', roomCode: 'ZZZZ' }, startSpy, broadcast);
  assert.equal(s2.emitted.at(-1).name, 'joinError');

  handleJoinRoom(io, s2, manager, { name: 'Bob', roomCode: code, browserId: 'other-id-1' }, startSpy, broadcast);
  assert.equal(s2.emitted.at(-1).name, 'joinSuccess');
  assert.equal(s2.emitted.at(-1).payload.status, 'waiting');
  assert.equal(startSpy.calls.length, 1);
  assert.equal(manager.getRoomForSocket('sock-b'), createdRoom);
  assert.equal(manager.getRoomForToken(s2.emitted.at(-1).payload.token), createdRoom);

  handleJoinRoom(io, s3, manager, { name: 'Eve', roomCode: code }, startSpy, broadcast);
  assert.equal(s3.emitted.at(-1).name, 'spectateSuccess');

  const manager2 = new GameManager();
  const s4 = createSocket('sock-d');
  const s5 = createSocket('sock-e');
  handleCreateRoom(io, s4, manager2, { name: 'Self', browserId: 'duplicate-id' }, broadcast);
  const code2 = s4.emitted.find(e => e.name === 'joinSuccess').payload.roomCode;
  handleJoinRoom(io, s5, manager2, { name: 'Self2', roomCode: code2, browserId: 'duplicate-id' }, startSpy, broadcast);
  assert.equal(s5.emitted.at(-1).payload, "You can't join your own room.");

  const manager3 = new GameManager();
  const s6 = createSocket('sock-f');
  const botSpy = createBotAdderSpy();
  const startSpy2 = createStartGameSpy(io);
  handleJoinBot(io, s6, manager3, { name: 'Human', browserId: 'human-bot-id', disabledMutators: ['fork'], manualCoinFlip: true }, startSpy2, botSpy);
  const botJoin = s6.emitted.find(e => e.name === 'joinSuccess');
  assert.ok(botJoin);
  const botRoom = manager3.getRoom(botJoin.payload.roomCode);
  assert.equal(botRoom.isPrivate, true);
  assert.equal(botRoom.isFull(), true);
  assert.equal(botRoom.hasBot(), true);
  assert.equal(botRoom.manualCoinFlip, true);
  assert.equal(botRoom.disabledMutators.has('fork'), true);
  assert.equal(manager3.getRoomForSocket('sock-f'), botRoom);
  assert.equal(manager3.getRoomForToken(botJoin.payload.token), botRoom);
  assert.equal(startSpy2.calls.length, 1);
});

test('handleListRooms emits waiting and active spectatable rooms', () => {
  const manager = new GameManager();
  const socket = createSocket('sock-list');
  const waiting = manager.createRoom(false);
  waiting.addPlayer(createPlayer('s1', 'A', 'h1', 'w', false));
  const active = manager.createRoom(false);
  active.status = 'active';
  active.addPlayer(createPlayer('s2', 'B', 'h2', 'w', false));
  active.addPlayer(createPlayer('s3', 'C', 'h3', 'b', false));
  const privateActive = manager.createRoom(true);
  privateActive.status = 'active';
  privateActive.addPlayer(createPlayer('s4', 'D', 'h4', 'w', false));
  privateActive.addPlayer(createPlayer('s5', 'E', 'h5', 'b', false));
  handleListRooms(socket, manager);
  const payload = socket.emitted.at(-1).payload;
  assert.equal(socket.emitted.at(-1).name, 'roomsList');
  assert.equal(payload.waiting.length, 1);
  assert.equal(payload.active.length, 1);
  assert.equal(payload.waiting[0].roomCode, waiting.roomCode);
  assert.equal(payload.active[0].roomCode, active.roomCode);
});

test('emitGameEnded emits payload', () => {
  const { io, roomEvents } = createIoRecorder();
  const room = new GameRoom('ABCD');
  room.addPlayer(createPlayer('s1', 'A', 'h1', 'w', false));
  room.addPlayer(createPlayer('s2', 'B', 'h2', 'b', false));
  emitGameEnded(io, room, 'timeout', 'w');
  const event = roomEvents.find(e => e.name === 'gameEnded');
  assert.ok(event);
  assert.equal(event.payload.reason, 'timeout');
  assert.equal(event.payload.winner, 'w');
  assert.equal(event.payload.loser, 'b');
  assert.ok(event.payload.board);
  assert.ok(event.payload.white && event.payload.black);
});

test('scheduleRoomDeletion and autoResignOnTimeout lifecycle', () => {
  const manager = new GameManager();
  const { io, roomEvents } = createIoRecorder();
  const room = manager.createRoom(false);
  room.addPlayer(createPlayer('s1', 'A', 'h1', 'w', false));
  room.addPlayer(createPlayer('s2', 'B', 'h2', 'b', false));
  room.status = 'active';

  const originalSet = global.setTimeout;
  const timers = [];
  try {
    global.setTimeout = (cb) => {
      const t = { unrefCalled: false, unref() { this.unrefCalled = true; } };
      timers.push({ cb, t });
      return t;
    };
    autoResignOnTimeout(room, io, manager, 'w');
    assert.equal(room.status, 'ended');
    assert.equal(room.winner, 'b');
    const endedEvent = roomEvents.find(e => e.name === 'gameEnded');
    assert.equal(endedEvent.payload.reason, 'timeout');
    assert.equal(timers.length, 1);
    assert.equal(timers[0].t.unrefCalled, true);
    timers[0].cb();
    assert.equal(manager.getRoom(room.roomCode), null);

    const room2 = manager.createRoom(false);
    room2.status = 'waiting';
    autoResignOnTimeout(room2, io, manager, 'w');
    assert.equal(room2.status, 'waiting');

    const room3 = manager.createRoom(false);
    scheduleRoomDeletion(manager, room3.roomCode, 123);
    assert.equal(timers.length, 2);
  } finally {
    global.setTimeout = originalSet;
  }
});

test.skip('room reset/rematch lifecycle coverage deferred: no reset/rematch handler currently exists', () => {});
