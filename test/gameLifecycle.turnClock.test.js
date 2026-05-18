const test = require('node:test');
const assert = require('node:assert/strict');

const { GameManager, GameRoom } = require('../gameManager');
const { handleMove } = require('../handlers/moveHandler');
const turnClock = require('../utils/turnClock');
const { emitGameEnded, autoResignOnTimeout, ROOM_CLEANUP_DELAY_MS } = require('../utils/gameLifecycle');
const { createParryCaptureSetup } = require('./helpers/moveHandlerTestHelpers');

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
    emit(name, payload) {
      this.emitted.push({ name, payload });
    },
  };
}

function createActiveHumanRoom(roomCode = 'TCLK1') {
  const gameManager = new GameManager();
  const room = new GameRoom(roomCode);
  room.addPlayer({ name: 'White', color: 'w', socketId: 'sock-w', isBot: false });
  room.addPlayer({ name: 'Black', color: 'b', socketId: 'sock-b', isBot: false });
  room.startGame();

  const whiteSocket = createSocket('sock-w');
  const blackSocket = createSocket('sock-b');
  const { io, roomEvents } = createIoRecorder();
  io.sockets.sockets.set('sock-w', whiteSocket);
  io.sockets.sockets.set('sock-b', blackSocket);

  gameManager.rooms.set(roomCode, room);
  gameManager.setSocketRoom('sock-w', roomCode);
  gameManager.setSocketRoom('sock-b', roomCode);

  return { gameManager, room, whiteSocket, blackSocket, io, roomEvents };
}

function withMockedDateNow(valueOrFn, fn) {
  const originalDateNow = Date.now;
  Date.now = typeof valueOrFn === 'function' ? valueOrFn : () => valueOrFn;

  const restore = () => {
    Date.now = originalDateNow;
  };

  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (err) {
    restore();
    throw err;
  }
}

function withCapturedTimers(fn) {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let nextId = 1;
  const scheduled = [];
  const cleared = [];

  global.setTimeout = (cb, delay) => {
    const timer = {
      id: nextId++,
      cb,
      delay,
      unrefCalled: false,
      unref() { this.unrefCalled = true; },
    };
    scheduled.push(timer);
    return timer;
  };

  global.clearTimeout = (timer) => {
    cleared.push(timer);
  };

  const restore = () => {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  };

  try {
    const result = fn({ scheduled, cleared });
    if (result && typeof result.then === 'function') {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (err) {
    restore();
    throw err;
  }
}

test.afterEach(() => {
  turnClock.setTimeoutResignHandler(() => {});
});

test('shouldRunClock only runs for active human-vs-human games', () => {
  const waitingRoom = new GameRoom('W1');
  const endedRoom = new GameRoom('E1');
  endedRoom.status = 'ended';
  const activeRoom = createActiveHumanRoom('A1').room;
  const whiteBotRoom = createActiveHumanRoom('WB1').room;
  whiteBotRoom.white.isBot = true;
  const blackBotRoom = createActiveHumanRoom('BB1').room;
  blackBotRoom.black.isBot = true;

  assert.equal(turnClock.shouldRunClock(waitingRoom), false);
  assert.equal(turnClock.shouldRunClock(endedRoom), false);
  assert.equal(turnClock.shouldRunClock(activeRoom), true);
  assert.equal(turnClock.shouldRunClock(whiteBotRoom), false);
  assert.equal(turnClock.shouldRunClock(blackBotRoom), false);
  assert.equal(turnClock.shouldRunClock(null), false);
});

test('startClock initializes turn state, emits update, and honors explicit forColor', () => {
  withCapturedTimers(({ scheduled, cleared }) => {
    withMockedDateNow(123456, () => {
      const ctx = createActiveHumanRoom('S1');
      turnClock.startClock(ctx.room, ctx.io);
      assert.equal(ctx.room.turnStartTime, 123456);
      assert.equal(ctx.room.turnClockFor, 'w');
      assert.ok(ctx.room._turnExpireTimer);
      assert.equal(scheduled[0].delay, turnClock.TURN_DURATION_MS);
      const update = ctx.roomEvents.find(e => e.name === 'turnClockUpdate');
      assert.equal(update.payload.durationMs, turnClock.TURN_DURATION_MS);
      assert.equal(update.payload.forColor, 'w');

      turnClock.startClock(ctx.room, ctx.io, 'b');
      assert.ok(cleared.length >= 1);
      assert.equal(ctx.room.turnClockFor, 'b');
      assert.equal(ctx.roomEvents.filter(e => e.name === 'turnClockUpdate').at(-1).payload.forColor, 'b');
    });
  });
});

test('startClock no-ops for bot games and inactive rooms', () => {
  withCapturedTimers(({ scheduled }) => {
    const botCtx = createActiveHumanRoom('N1');
    botCtx.room.white.isBot = true;
    turnClock.startClock(botCtx.room, botCtx.io);
    assert.equal(scheduled.length, 0);
    assert.equal(botCtx.roomEvents.length, 0);
    assert.equal(botCtx.room.turnStartTime, null);
    assert.equal(botCtx.room.turnClockFor, null);

    const inactiveCtx = createActiveHumanRoom('N2');
    inactiveCtx.room.status = 'waiting';
    turnClock.startClock(inactiveCtx.room, inactiveCtx.io);
    assert.equal(scheduled.length, 0);
    assert.equal(inactiveCtx.roomEvents.length, 0);
  });
});

test('clearClock clears timer and nulls state, null room safe', () => {
  withCapturedTimers(({ cleared }) => {
    const ctx = createActiveHumanRoom('C1');
    const oldTimer = { id: 'old' };
    ctx.room._turnExpireTimer = oldTimer;
    ctx.room.turnStartTime = 10;
    ctx.room.turnClockFor = 'w';

    turnClock.clearClock(ctx.room);
    assert.deepEqual(cleared, [oldTimer]);
    assert.equal(ctx.room._turnExpireTimer, null);
    assert.equal(ctx.room.turnStartTime, null);
    assert.equal(ctx.room.turnClockFor, null);
    assert.doesNotThrow(() => turnClock.clearClock(null));
  });
});



test('stale timeout callbacks are ignored after clock restart', () => {
  withCapturedTimers(({ scheduled }) => {
    const ctx = createActiveHumanRoom('STALE1');
    const calls = [];
    turnClock.setTimeoutResignHandler((_room, _io, stallingColor) => {
      calls.push(stallingColor);
    });

    turnClock.startClock(ctx.room, ctx.io, 'w');
    const firstTimer = scheduled[0];

    turnClock.startClock(ctx.room, ctx.io, 'b');
    const secondTimer = scheduled[1];

    firstTimer.cb();
    assert.deepEqual(calls, []);
    assert.equal(ctx.room.status, 'active');

    secondTimer.cb();
    assert.deepEqual(calls, ['b']);
  });
});
test('turn expiry clears clock and calls timeout-resign handler once; inactive expiry no-ops', () => {
  withCapturedTimers(({ scheduled }) => {
    const ctx = createActiveHumanRoom('X1');
    const calls = [];
    turnClock.setTimeoutResignHandler((room, io, stallingColor) => {
      calls.push({ room, io, stallingColor });
    });

    turnClock.startClock(ctx.room, ctx.io, 'w');
    scheduled[0].cb();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].stallingColor, 'w');
    assert.equal(ctx.room._turnExpireTimer, null);
    assert.equal(ctx.room.turnStartTime, null);
    assert.equal(ctx.room.turnClockFor, null);

    const ctx2 = createActiveHumanRoom('X2');
    let called = 0;
    turnClock.setTimeoutResignHandler(() => { called++; });
    turnClock.startClock(ctx2.room, ctx2.io);
    ctx2.room.status = 'ended';
    scheduled[1].cb();
    assert.equal(called, 0);
  });
});

test('consumeMoveAttempt no-op cases and timer-clearing behavior', () => {
  withCapturedTimers(({ cleared }) => {
    const botCtx = createActiveHumanRoom('M0');
    botCtx.room.white.isBot = true;
    turnClock.consumeMoveAttempt(botCtx.room, botCtx.io, 'w');

    const inactiveCtx = createActiveHumanRoom('M1');
    inactiveCtx.room.status = 'waiting';
    turnClock.consumeMoveAttempt(inactiveCtx.room, inactiveCtx.io, 'w');

    const noStartCtx = createActiveHumanRoom('M2');
    turnClock.consumeMoveAttempt(noStartCtx.room, noStartCtx.io, 'w');

    const activeCtx = createActiveHumanRoom('M3');
    turnClock.startClock(activeCtx.room, activeCtx.io, 'w');
    turnClock.consumeMoveAttempt(activeCtx.room, activeCtx.io, 'w');

    assert.equal(cleared.length, 1);
    assert.equal(activeCtx.room._turnExpireTimer, null);
    assert.equal(activeCtx.room.turnStartTime, null);
    assert.equal(activeCtx.room.turnClockFor, null);
  });
});

test('consumeMoveAttempt fast/slow/third-strike behavior and quiet resign events', () => {
  withCapturedTimers(() => {
    const ctx = createActiveHumanRoom('Q1');

    // Fast move resets strikes and revokes quiet resign
    turnClock.startClock(ctx.room, ctx.io, 'w');
    ctx.room.lowTimeStrikes = { w: 2, b: 0 };
    ctx.room.quietResignFor = 'b';
    withMockedDateNow(() => ctx.room.turnStartTime + 1000, () => {
      turnClock.consumeMoveAttempt(ctx.room, ctx.io, 'w');
    });
    assert.equal(ctx.room.lowTimeStrikes.w, 0);
    assert.equal(ctx.room.quietResignFor, null);
    assert.ok(ctx.roomEvents.some(e => e.name === 'quietResignRevoked' && e.payload.forColor === 'b'));

    // Slow move increments strike but below offer threshold
    turnClock.startClock(ctx.room, ctx.io, 'w');
    withMockedDateNow(() => ctx.room.turnStartTime + (turnClock.TURN_DURATION_MS - 30000), () => {
      turnClock.consumeMoveAttempt(ctx.room, ctx.io, 'w');
    });
    assert.equal(ctx.room.lowTimeStrikes.w, 1);

    // 3rd strike offers quiet resign once
    ctx.room.lowTimeStrikes.w = 2;
    turnClock.startClock(ctx.room, ctx.io, 'w');
    withMockedDateNow(() => ctx.room.turnStartTime + (turnClock.TURN_DURATION_MS - 30000), () => {
      turnClock.consumeMoveAttempt(ctx.room, ctx.io, 'w');
    });
    assert.equal(ctx.room.lowTimeStrikes.w, 3);
    assert.equal(ctx.room.quietResignFor, 'b');
    const offerCount = ctx.roomEvents.filter(e => e.name === 'quietResignAvailable').length;

    turnClock.startClock(ctx.room, ctx.io, 'w');
    withMockedDateNow(() => ctx.room.turnStartTime + (turnClock.TURN_DURATION_MS - 30000), () => {
      turnClock.consumeMoveAttempt(ctx.room, ctx.io, 'w');
    });
    assert.equal(ctx.roomEvents.filter(e => e.name === 'quietResignAvailable').length, offerCount);
  });
});

test('clearQuietResign resets state and is null-safe', () => {
  const ctx = createActiveHumanRoom('R1');
  ctx.room.quietResignFor = 'w';
  ctx.room.lowTimeStrikes = { w: 8, b: 4 };
  turnClock.clearQuietResign(ctx.room);
  assert.equal(ctx.room.quietResignFor, null);
  assert.deepEqual(ctx.room.lowTimeStrikes, { w: 0, b: 0 });
  assert.doesNotThrow(() => turnClock.clearQuietResign(null));
});

test('emitGameEnded and autoResignOnTimeout clear timers/quiet resign and schedule deletion', () => {
  withCapturedTimers(({ cleared, scheduled }) => {
    const ctx = createActiveHumanRoom('G1');
    ctx.room.manualCoinFlip = true;
    const liveTimer = { id: 'live' };
    ctx.room._turnExpireTimer = liveTimer;
    ctx.room.turnStartTime = 1;
    ctx.room.turnClockFor = 'w';
    ctx.room.quietResignFor = 'b';
    ctx.room.lowTimeStrikes = { w: 2, b: 1 };

    emitGameEnded(ctx.io, ctx.room, 'resignation', 'w');
    assert.ok(cleared.includes(liveTimer));
    assert.equal(ctx.room.turnStartTime, null);
    assert.equal(ctx.room.turnClockFor, null);
    assert.equal(ctx.room.quietResignFor, null);
    assert.deepEqual(ctx.room.lowTimeStrikes, { w: 0, b: 0 });
    assert.ok(ctx.roomEvents.some(e => e.name === 'gameEnded'));

    const ctx2 = createActiveHumanRoom('G2');
    ctx2.room.manualCoinFlip = true;
    autoResignOnTimeout(ctx2.room, ctx2.io, ctx2.gameManager, 'w');
    assert.equal(ctx2.room.status, 'ended');
    assert.equal(ctx2.room.winner, 'b');
    assert.equal(scheduled.at(-1).delay, ROOM_CLEANUP_DELAY_MS);
    assert.equal(scheduled.at(-1).unrefCalled, true);
  });
});

test('handleMove: legal move rotates clock, parry path clears clock, rejected move preserves clock', async () => {
  await withCapturedTimers(async ({ cleared }) => {
    const ctx = createActiveHumanRoom('H1');
    turnClock.startClock(ctx.room, ctx.io, 'w');
    const oldTimer = ctx.room._turnExpireTimer;

    await handleMove(ctx.io, ctx.whiteSocket, ctx.gameManager, { from: 'e2', to: 'e4' });
    assert.ok(cleared.includes(oldTimer));
    assert.equal(ctx.room.turnClockFor, 'b');
    assert.ok(ctx.roomEvents.some(e => e.name === 'moveApplied'));
    assert.ok(ctx.roomEvents.some(e => e.name === 'turnClockUpdate' && e.payload.forColor === 'b'));
  });

  await withCapturedTimers(async () => {
    const gameManager = new GameManager();
    const room = createParryCaptureSetup('H2');
    gameManager.rooms.set(room.roomCode, room);
    gameManager.setSocketRoom('sock-w', room.roomCode);
    const socket = createSocket('sock-w');
    const { io, roomEvents } = createIoRecorder();

    turnClock.startClock(room, io, 'w');
    await handleMove(io, socket, gameManager, { from: 'd1', to: 'd2' });
    assert.equal(room._turnExpireTimer, null);
    assert.equal(room.turnStartTime, null);
    assert.equal(room.turnClockFor, null);
    assert.ok(room.mutatorState.pendingRPS);
    assert.ok(roomEvents.some(e => e.name === 'rpsPrompt'));
  });

  await withCapturedTimers(async () => {
    const ctx = createActiveHumanRoom('H3');
    turnClock.startClock(ctx.room, ctx.io, 'w');
    const timer = ctx.room._turnExpireTimer;
    const start = ctx.room.turnStartTime;

    await handleMove(ctx.io, ctx.whiteSocket, ctx.gameManager, { from: 'e3', to: 'e4' });
    assert.ok(ctx.whiteSocket.emitted.some(e => e.name === 'moveRejected'));
    assert.equal(ctx.room._turnExpireTimer, timer);
    assert.equal(ctx.room.turnStartTime, start);
    assert.equal(ctx.room.turnClockFor, 'w');
  });
});

test('disconnect timers and turn timers are independent cleanup paths', () => {
  withCapturedTimers(({ cleared }) => {
    const ctx = createActiveHumanRoom('D1');
    const wDisc = { id: 'wDisc' };
    const bDisc = { id: 'bDisc' };
    const turnTimer = { id: 'turnTimer' };
    ctx.room.disconnectTimers.set('w', wDisc);
    ctx.room.disconnectTimers.set('b', bDisc);
    ctx.room._turnExpireTimer = turnTimer;

    ctx.room.endGame('resignation', 'w');
    assert.ok(cleared.includes(wDisc));
    assert.ok(cleared.includes(bDisc));

    emitGameEnded(ctx.io, ctx.room, 'resignation', 'w');
    assert.ok(cleared.includes(turnTimer));
  });
});
