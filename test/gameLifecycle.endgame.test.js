const test = require('node:test');
const assert = require('node:assert/strict');

const { GameManager } = require('../gameManager');
const { createPlayer } = require('../gameController');
const { handleMove } = require('../handlers/moveHandler');
const {
  emitGameEnded,
  checkKingDestroyed,
  checkMutatorDeadlock,
  checkParryDeadlock,
} = require('../utils/gameLifecycle');
const turnClock = require('../utils/turnClock');

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

function createSocket(id) {
  return {
    id,
    emitted: [],
    emit(name, payload) { this.emitted.push({ name, payload }); },
  };
}

function createActiveRoom({ roomCode = 'END01', fen = null, manualCoinFlip = true, disabledMutators = [], mutatorsEnabled = false } = {}) {
  const gameManager = new GameManager();
  const room = gameManager.createRoom();
  room.roomCode = roomCode;
  gameManager.rooms.set(roomCode, room);

  const white = createPlayer('sock-w', 'White', 'hash-w', 'w', false);
  const black = createPlayer('sock-b', 'Black', 'hash-b', 'b', false);
  room.addPlayer(white);
  room.addPlayer(black);
  room.startGame();
  if (!mutatorsEnabled) room.mutatorState = null;
  if (fen) room.chess.load(fen, { skipValidation: true });
  room.manualCoinFlip = manualCoinFlip;
  room.disabledMutators = new Set(disabledMutators);

  const whiteSocket = createSocket('sock-w');
  const blackSocket = createSocket('sock-b');
  const { io, roomEvents } = createIoRecorder();
  io.sockets.sockets.set('sock-w', whiteSocket);
  io.sockets.sockets.set('sock-b', blackSocket);
  gameManager.setSocketRoom('sock-w', roomCode);
  gameManager.setSocketRoom('sock-b', roomCode);

  return { gameManager, room, whiteSocket, blackSocket, io, roomEvents };
}

function withCapturedTimers(fn) {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const scheduled = [];
  const cleared = [];
  global.setTimeout = (cb, ms, ...args) => {
    const timer = { id: Symbol('t'), cb, ms, args, unref() { return this; } };
    scheduled.push(timer);
    return timer;
  };
  global.clearTimeout = (timer) => { cleared.push(timer); };
  const restore = () => {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  };

  try {
    const result = fn({ scheduled, cleared });
    if (result && typeof result.finally === 'function') {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (err) {
    restore();
    throw err;
  }
}

function getLastEvent(roomEvents, name) {
  return roomEvents.filter(e => e.name === name).at(-1);
}

function assertGameEnded(room, roomEvents, { reason, winner, loser }) {
  assert.equal(room.status, 'ended');
  const ev = getLastEvent(roomEvents, 'gameEnded');
  assert.ok(ev);
  assert.equal(ev.payload.reason, reason);
  assert.equal(ev.payload.winner, winner);
  assert.equal(ev.payload.loser, loser);
  assert.ok(ev.payload.board);
  assert.ok(ev.payload.white);
  assert.ok(ev.payload.black);
}

test('handleMove detects standard checkmate (fools mate) and emits gameEnded', async () => {
  await withCapturedTimers(async ({ scheduled }) => {
    const { gameManager, room, io, whiteSocket, blackSocket, roomEvents } = createActiveRoom({ roomCode: 'ENDCM', mutatorsEnabled: false });
    turnClock.startClock(room, io);

    await handleMove(io, whiteSocket, gameManager, { from: 'f2', to: 'f3' });
    await handleMove(io, blackSocket, gameManager, { from: 'e7', to: 'e5' });
    await handleMove(io, whiteSocket, gameManager, { from: 'g2', to: 'g4' });
    await handleMove(io, blackSocket, gameManager, { from: 'd8', to: 'h4' });

    assertGameEnded(room, roomEvents, { reason: 'checkmate', winner: 'b', loser: 'w' });
    assert.equal(room.endReason, 'checkmate');
    assert.equal(room.winner, 'b');
    assert.equal(room._turnExpireTimer, null);
    assert.equal(roomEvents.some(e => e.name === 'mutatorBoardUpdate'), false);
    const cleanupTimers = scheduled.filter(t => t.ms === 5 * 60 * 1000);
    assert.equal(cleanupTimers.length, 1);
  });
});

test('handleMove detects standard stalemate', async () => {
  await withCapturedTimers(async ({ scheduled }) => {
    const { gameManager, room, io, whiteSocket, roomEvents } = createActiveRoom({
      roomCode: 'ENDSM',
      mutatorsEnabled: false,
      fen: '8/8/8/8/8/8/8/KQk5 w - - 0 1',
    });
    await handleMove(io, whiteSocket, gameManager, { from: 'b1', to: 'd3' });
    assertGameEnded(room, roomEvents, { reason: 'stalemate', winner: null, loser: undefined });
    assert.equal(scheduled.filter(t => t.ms === 5 * 60 * 1000).length, 1);
  });
});

test('handleMove detects insufficient material', async () => {
  await withCapturedTimers(async ({ scheduled }) => {
    const { gameManager, room, io, whiteSocket, roomEvents } = createActiveRoom({
      roomCode: 'ENDIM',
      mutatorsEnabled: false,
      fen: '8/8/8/8/8/8/2k5/K1B5 w - - 0 1',
    });
    await handleMove(io, whiteSocket, gameManager, { from: 'c1', to: 'd2' });
    assertGameEnded(room, roomEvents, { reason: 'insufficient-material', winner: null, loser: undefined });
    assert.equal(scheduled.filter(t => t.ms === 5 * 60 * 1000).length, 1);
  });
});

test('handleMove detects threefold repetition', async () => {
  await withCapturedTimers(async ({ scheduled }) => {
    const { gameManager, room, io, whiteSocket, blackSocket, roomEvents } = createActiveRoom({ roomCode: 'END3F', mutatorsEnabled: false });

    const seq = [
      [whiteSocket, { from: 'g1', to: 'f3' }], [blackSocket, { from: 'g8', to: 'f6' }],
      [whiteSocket, { from: 'f3', to: 'g1' }], [blackSocket, { from: 'f6', to: 'g8' }],
      [whiteSocket, { from: 'g1', to: 'f3' }], [blackSocket, { from: 'g8', to: 'f6' }],
      [whiteSocket, { from: 'f3', to: 'g1' }], [blackSocket, { from: 'f6', to: 'g8' }],
    ];
    for (const [sock, mv] of seq) await handleMove(io, sock, gameManager, mv);

    assertGameEnded(room, roomEvents, { reason: 'threefold-repetition', winner: null, loser: undefined });
    assert.equal(scheduled.filter(t => t.ms === 5 * 60 * 1000).length, 1);
  });
});

test.skip('generic draw fallback coverage deferred: no compact deterministic 50-move-rule fixture yet', () => {});

test('checkKingDestroyed handles white-missing, black-missing, both-missing, and no-op states', () => {
  withCapturedTimers(({ scheduled }) => {
    const a = createActiveRoom({ roomCode: 'ENDKD1', fen: '4k3/8/8/8/8/8/8/8 w - - 0 1' });
    assert.equal(checkKingDestroyed(a.room, a.io, a.gameManager), true);
    assertGameEnded(a.room, a.roomEvents, { reason: 'king-destroyed', winner: 'b', loser: 'w' });

    const b = createActiveRoom({ roomCode: 'ENDKD2', fen: '8/8/8/8/8/8/8/4K3 w - - 0 1' });
    assert.equal(checkKingDestroyed(b.room, b.io, b.gameManager), true);
    assertGameEnded(b.room, b.roomEvents, { reason: 'king-destroyed', winner: 'w', loser: 'b' });

    const c = createActiveRoom({ roomCode: 'ENDKD3' });
    c.room.chess.load('8/8/8/8/8/8/8/8 w - - 0 1', { skipValidation: true });
    assert.equal(checkKingDestroyed(c.room, c.io, c.gameManager), true);
    assertGameEnded(c.room, c.roomEvents, { reason: 'draw', winner: null, loser: undefined });

    const d = createActiveRoom({ roomCode: 'ENDKD4' });
    d.room.status = 'waiting';
    assert.equal(checkKingDestroyed(d.room, d.io, d.gameManager), false);
    assert.equal(d.roomEvents.some(e => e.name === 'gameEnded'), false);

    const e = createActiveRoom({ roomCode: 'ENDKD5' });
    assert.equal(checkKingDestroyed(e.room, e.io, e.gameManager), false);
    assert.equal(e.roomEvents.some(ev => ev.name === 'gameEnded'), false);

    assert.ok(scheduled.filter(t => t.ms === 5 * 60 * 1000).length >= 3);
  });
});

test('checkMutatorDeadlock and checkParryDeadlock coverage', () => {
  withCapturedTimers(() => {
    const noop = createActiveRoom({ roomCode: 'ENDMD0' });
    assert.equal(checkMutatorDeadlock(noop.room, noop.io, noop.gameManager), false);

    const stalemate = createActiveRoom({ roomCode: 'ENDMD1', mutatorsEnabled: true, fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' });
    stalemate.room.mutatorState.activeRules = [{ rule: { id: 'short_stop' } }];
    assert.equal(checkMutatorDeadlock(stalemate.room, stalemate.io, stalemate.gameManager), true);
    assertGameEnded(stalemate.room, stalemate.roomEvents, { reason: 'stalemate', winner: null, loser: undefined });

    const mate = createActiveRoom({ roomCode: 'ENDMD2', mutatorsEnabled: true, fen: '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1' });
    mate.room.mutatorState.activeRules = [{ rule: { id: 'short_stop' } }];
    assert.equal(checkMutatorDeadlock(mate.room, mate.io, mate.gameManager), true);
    assertGameEnded(mate.room, mate.roomEvents, { reason: 'checkmate', winner: 'w', loser: 'b' });

    const hasMoves = createActiveRoom({ roomCode: 'ENDMD3', mutatorsEnabled: true });
    hasMoves.room.mutatorState.activeRules = [{ rule: { id: 'parry' } }];
    assert.equal(checkMutatorDeadlock(hasMoves.room, hasMoves.io, hasMoves.gameManager), false);

    const parryNoMovesMate = createActiveRoom({ roomCode: 'ENDPR1', fen: '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1' });
    assert.equal(checkParryDeadlock(parryNoMovesMate.room, parryNoMovesMate.io, parryNoMovesMate.gameManager), true);
    assertGameEnded(parryNoMovesMate.room, parryNoMovesMate.roomEvents, { reason: 'checkmate', winner: 'w', loser: 'b' });

    const parryNoMovesStale = createActiveRoom({ roomCode: 'ENDPR2', fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' });
    assert.equal(checkParryDeadlock(parryNoMovesStale.room, parryNoMovesStale.io, parryNoMovesStale.gameManager), true);
    assertGameEnded(parryNoMovesStale.room, parryNoMovesStale.roomEvents, { reason: 'stalemate', winner: null, loser: undefined });

    const parryHasQuietMove = createActiveRoom({ roomCode: 'ENDPR3' });
    assert.equal(checkParryDeadlock(parryHasQuietMove.room, parryHasQuietMove.io, parryHasQuietMove.gameManager), false);

    const parryOnlyCaptures = createActiveRoom({ roomCode: 'ENDPR4', fen: '8/8/8/8/8/k7/1p6/KQ6 w - - 0 1' });
    assert.equal(checkParryDeadlock(parryOnlyCaptures.room, parryOnlyCaptures.io, parryOnlyCaptures.gameManager), true);
    assertGameEnded(parryOnlyCaptures.room, parryOnlyCaptures.roomEvents, { reason: 'checkmate', winner: 'b', loser: 'w' });

  });
});

test('emitGameEnded payload stability for draw and winner, with cleanup of timers/offers', () => {
  const draw = createActiveRoom({ roomCode: 'ENDE1' });
  draw.room.quietResignFor = 'b';
  draw.room._turnExpireTimer = { id: 1 };
  emitGameEnded(draw.io, draw.room, 'draw', null);
  const drawEv = getLastEvent(draw.roomEvents, 'gameEnded');
  assert.equal(drawEv.payload.reason, 'draw');
  assert.equal(drawEv.payload.winner, null);
  assert.equal(drawEv.payload.loser, undefined);
  assert.equal(draw.room._turnExpireTimer, null);
  assert.equal(draw.room.quietResignFor, null);

  const win = createActiveRoom({ roomCode: 'ENDE2' });
  emitGameEnded(win.io, win.room, 'checkmate', 'w');
  const winEv = getLastEvent(win.roomEvents, 'gameEnded');
  assert.equal(winEv.payload.winner, 'w');
  assert.equal(winEv.payload.loser, 'b');
});
