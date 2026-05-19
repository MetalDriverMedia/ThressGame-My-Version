const test = require('node:test');
const assert = require('node:assert/strict');

const { GameManager, GameRoom } = require('../gameManager');
const { createPlayer } = require('../gameController');
const { handleDisconnect, handleResume } = require('../handlers/playerHandlers');
const botManager = require('../botManager');
const { emitGameEnded } = require('../utils/gameLifecycle');
const {
  createSeededRng,
  pick,
  parseStressSeeds,
  resolveStressStepCount,
} = require('./helpers/seededStressTestHelpers');

function createSocket(id) {
  return {
    id,
    emitted: [],
    handshake: { headers: {}, address: '127.0.0.1' },
    join() {},
    leave() {},
    emit(name, payload) { this.emitted.push({ name, payload }); },
  };
}

function createHarnessRoom(seed) {
  const gameManager = new GameManager();
  const room = new GameRoom(`H3E${String(seed).padStart(4, '0').slice(-4)}`);
  gameManager.rooms.set(room.roomCode, room);
  const white = createPlayer(`sock-w-${seed}`, 'White', `hash-w-${seed}`, 'w', false);
  const black = createPlayer(`sock-b-${seed}`, 'Black', `hash-b-${seed}`, 'b', false);
  room.addPlayer(white);
  room.addPlayer(black);
  room.startGame();
  room.mutatorState = room.mutatorState || { activeRules: [] };
  const io = {
    roomEvents: [],
    sockets: { sockets: new Map() },
    to(roomCode) {
      return {
        emit: (name, payload) => io.roomEvents.push({ roomCode, name, payload }),
      };
    },
  };
  const wSock = createSocket(white.socketId);
  const bSock = createSocket(black.socketId);
  io.sockets.sockets.set(wSock.id, wSock);
  io.sockets.sockets.set(bSock.id, bSock);
  gameManager.setSocketRoom(wSock.id, room.roomCode);
  gameManager.setSocketRoom(bSock.id, room.roomCode);
  gameManager.setTokenRoom(white.token, room.roomCode);
  gameManager.setTokenRoom(black.token, room.roomCode);
  return { gameManager, room, io, white, black, wSock, bSock };
}

function assertCommonInvariants(ctx, seed, step) {
  const { room, io, white, black } = ctx;
  assert.ok(['waiting', 'active', 'ended'].includes(room.status), `seed=${seed} step=${step} invalid status=${room.status}`);
  const endedEvents = io.roomEvents.filter((e) => e.name === 'gameEnded' && e.roomCode === room.roomCode);
  assert.ok(endedEvents.length <= 1, `seed=${seed} step=${step} duplicate gameEnded count=${endedEvents.length}`);
  if (room.mutatorState?.pendingAction?.owner) {
    assert.ok(['w', 'b'].includes(room.mutatorState.pendingAction.owner), `seed=${seed} step=${step} pending owner invalid`);
  }
  if (room.white) {
    assert.equal(room.white.token, white.token, `seed=${seed} step=${step} white token changed unexpectedly`);
  }
  if (room.black) {
    assert.equal(room.black.token, black.token, `seed=${seed} step=${step} black token changed unexpectedly`);
  }
}

function runReconnectChurnStep(ctx, rng) {
  const { io, gameManager, room, white, black } = ctx;
  const playerColor = pick(rng, ['w', 'b']);
  const player = playerColor === 'w' ? white : black;
  const opponent = playerColor === 'w' ? black : white;
  const oldSocket = createSocket(player.socketId);
  handleDisconnect(io, oldSocket, gameManager, () => {});

  const invalidResumeSocket = createSocket(`invalid-${playerColor}-${Math.floor(rng() * 1000)}`);
  handleResume(io, invalidResumeSocket, gameManager, { token: `bad-token-${Math.floor(rng() * 9)}` });
  assert.ok(invalidResumeSocket.emitted.some((e) => e.name === 'resumeRejected'));

  const newSocket = createSocket(`resumed-${playerColor}-${Math.floor(rng() * 1000)}`);
  handleResume(io, newSocket, gameManager, { token: player.token });
  assert.ok(newSocket.emitted.some((e) => e.name === 'resumeSuccess'));
  assert.equal(room.getPlayer(playerColor).socketId, newSocket.id);
  assert.equal(room.getPlayer(opponent.color).token, opponent.token);
}

function runBotSchedulingStep(ctx, rng) {
  const { room, io, gameManager } = ctx;
  const originalTurn = room.chess.turn();
  room.white.isBot = pick(rng, [true, false]);
  room.black.isBot = pick(rng, [true, false]);
  room.white.isBot = room.white.color === originalTurn ? false : room.white.isBot;
  room.black.isBot = room.black.color === originalTurn ? false : room.black.isBot;

  const beforeFen = room.chess.fen();
  return botManager.performBotMove(room, io, gameManager, async () => ({ applied: true }))
    .then(() => {
      assert.equal(room.chess.fen(), beforeFen, 'bot should not apply move when turn owner is human in harness callback');
    });
}

function runTerminalIdempotencyStep(ctx, rng) {
  const { room, io } = ctx;
  const terminal = pick(rng, [
    () => emitGameEnded(io, room, 'timeout', 'w'),
    () => emitGameEnded(io, room, 'resignation', 'b'),
    () => emitGameEnded(io, room, 'king-destroyed', null),
  ]);
  terminal();
  terminal();
  const endedEvents = io.roomEvents.filter((e) => e.name === 'gameEnded' && e.roomCode === room.roomCode);
  assert.equal(endedEvents.length, 1, 'terminal idempotency should emit once');
}

const seeds = parseStressSeeds(process.env.THRESS_STRESS_SEEDS);
const steps = resolveStressStepCount();

test(`H3E bounded seeded stress harness (seeds=${seeds.join(',')} steps=${steps})`, async () => {
  for (const seed of seeds) {
    const rng = createSeededRng(seed);
    const ctx = createHarnessRoom(seed);

    for (let step = 0; step < steps; step += 1) {
      const scenario = pick(rng, ['reconnect', 'bot-scheduling', 'terminal-idempotency']);
      if (scenario === 'reconnect') runReconnectChurnStep(ctx, rng);
      if (scenario === 'bot-scheduling') await runBotSchedulingStep(ctx, rng);
      if (scenario === 'terminal-idempotency') runTerminalIdempotencyStep(ctx, rng);
      assertCommonInvariants(ctx, seed, step);
    }
  }
});
