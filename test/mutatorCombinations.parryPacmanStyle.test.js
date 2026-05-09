const test = require('node:test');
const assert = require('node:assert/strict');

const { handleMove } = require('../handlers/moveHandler');
const { createMutatorHandlers } = require('../handlers/mutatorHandler');
const { GameManager, GameRoom } = require('../gameManager');
const { RULES } = require('../mutators/mutatorDefs');
const { getEffectiveLegalMoves } = require('../mutators/legalMoveEngine');
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

async function triggerAndSettle(socket, eventName, payload) {
  socket.trigger(eventName, payload);
  await Promise.resolve();
  await Promise.resolve();
}

function setupRoom({ roomCode, fen, turn = 'w', activeRuleIds = [] }) {
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

  for (const id of activeRuleIds) {
    room.mutatorState.activeRules.push({ rule: getRule(id) });
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

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});

test('pacman_style alone enables deterministic wrap move exactly once', async () => {
  const fen = '4k3/8/8/8/8/8/N7/4K3 w - - 0 1';

  const baseline = setupRoom({ roomCode: 'PAC-BASE-1', fen });
  const baselineLegal = getEffectiveLegalMoves(baseline.room, 'w');
  assert.equal(baselineLegal.some((m) => m.from === 'a2' && m.to === 'h4'), false);

  await handleMove(baseline.io, baseline.whiteSocket, baseline.gameManager, { from: 'a2', to: 'h4' });
  const baselineReject = baseline.whiteSocket.emitted.find((e) => e.name === 'moveRejected');
  assert.ok(baselineReject);
  assert.equal(baseline.room.chess.get('a2').type, 'n');
  assert.equal(baseline.room.chess.get('h4'), undefined);

  const pacman = setupRoom({ roomCode: 'PAC-BASE-2', fen, activeRuleIds: ['pacman_style'] });
  const pacmanLegal = getEffectiveLegalMoves(pacman.room, 'w');
  assert.equal(pacmanLegal.some((m) => m.from === 'a2' && m.to === 'h4'), true);

  await handleMove(pacman.io, pacman.whiteSocket, pacman.gameManager, { from: 'a2', to: 'h4' });

  assert.equal(pacman.room.chess.get('a2'), undefined);
  assert.equal(pacman.room.chess.get('h4').type, 'n');
  assert.equal(pacman.roomEvents.filter((e) => e.name === 'moveApplied').length, 1);
});

test('pacman_style alone enables deterministic wrap capture exactly once', async () => {
  const fen = '4k3/8/8/8/7p/8/N7/4K3 w - - 0 1';
  const baseline = setupRoom({ roomCode: 'PAC-CAP-1', fen });
  const baselineLegal = getEffectiveLegalMoves(baseline.room, 'w');
  assert.equal(baselineLegal.some((m) => m.from === 'a2' && m.to === 'h4'), false);

  const pacman = setupRoom({ roomCode: 'PAC-CAP-2', fen, activeRuleIds: ['pacman_style'] });
  const pacmanLegal = getEffectiveLegalMoves(pacman.room, 'w');
  assert.equal(pacmanLegal.some((m) => m.from === 'a2' && m.to === 'h4'), true);

  await handleMove(pacman.io, pacman.whiteSocket, pacman.gameManager, { from: 'a2', to: 'h4' });

  assert.equal(pacman.room.chess.get('a2'), undefined);
  assert.equal(pacman.room.chess.get('h4').type, 'n');
  assert.equal(pacman.roomEvents.filter((e) => e.name === 'moveApplied').length, 1);
});

test('parry + pacman_style wrap capture creates pendingRPS and preserves board before resolution', async () => {
  const fen = '4k3/8/8/8/7p/8/N7/4K3 w - - 0 1';
  const { gameManager, room, whiteSocket, io, roomEvents } = setupRoom({
    roomCode: 'PAC-PARRY-1',
    fen,
    activeRuleIds: ['parry', 'pacman_style'],
  });
  const before = room.chess.fen();

  await handleMove(io, whiteSocket, gameManager, { from: 'a2', to: 'h4' });

  assert.ok(room.mutatorState.pendingRPS);
  assert.deepEqual(room.mutatorState.pendingRPS.move, { from: 'a2', to: 'h4', promotion: null });
  assert.equal(room.chess.fen(), before);
  assert.equal(roomEvents.filter((e) => e.name === 'rpsPrompt').length, 1);
  assert.equal(roomEvents.filter((e) => e.name === 'moveApplied').length, 0);
});

test('parry + pacman_style attacker-win RPS resolves wrap capture exactly once', async () => {
  const { gameManager, room, whiteSocket, blackSocket, io, roomEvents } = setupRoom({
    roomCode: 'PAC-PARRY-2',
    fen: '4k3/8/8/8/7p/8/N7/4K3 w - - 0 1',
    activeRuleIds: ['parry', 'pacman_style'],
  });

  await handleMove(io, whiteSocket, gameManager, { from: 'a2', to: 'h4' });
  assert.ok(room.mutatorState.pendingRPS);

  await triggerAndSettle(whiteSocket, 'rpsChoice', { choice: 'rock' });
  await triggerAndSettle(blackSocket, 'rpsChoice', { choice: 'scissors' });

  assert.equal(room.mutatorState.pendingRPS, null);
  assert.notEqual(room.mutatorState.rpsResolved, true);
  assert.equal(room.chess.get('a2'), undefined);
  assert.equal(room.chess.get('h4').type, 'n');
  assert.equal(roomEvents.filter((e) => e.name === 'rpsPrompt').length, 1);
  assert.equal(roomEvents.filter((e) => e.name === 'moveApplied').length, 1);
});

test('parry + pacman_style defender-win RPS blocks wrap capture exactly once', async () => {
  const { gameManager, room, whiteSocket, blackSocket, io, roomEvents } = setupRoom({
    roomCode: 'PAC-PARRY-3',
    fen: '4k3/8/8/8/7p/8/N7/4K3 w - - 0 1',
    activeRuleIds: ['parry', 'pacman_style'],
  });

  await handleMove(io, whiteSocket, gameManager, { from: 'a2', to: 'h4' });
  assert.ok(room.mutatorState.pendingRPS);

  await triggerAndSettle(blackSocket, 'rpsChoice', { choice: 'paper' });
  await triggerAndSettle(whiteSocket, 'rpsChoice', { choice: 'rock' });

  assert.equal(room.mutatorState.pendingRPS, null);
  assert.notEqual(room.mutatorState.rpsResolved, true);
  assert.equal(room.chess.get('a2').type, 'n');
  assert.equal(room.chess.get('h4').type, 'p');

  const moveApplied = roomEvents.filter((e) => e.name === 'moveApplied');
  assert.equal(moveApplied.length, 1);
  assert.equal(moveApplied[0].payload.san, '(blocked)');
  assert.equal(moveApplied[0].payload.skipTurn, true);
});

test('parry + pacman_style attacker-win ordering: rpsPrompt before rpsResult before moveApplied', async () => {
  const { gameManager, room, whiteSocket, blackSocket, io, roomEvents } = setupRoom({
    roomCode: 'PAC-PARRY-4',
    fen: '4k3/8/8/8/7p/8/N7/4K3 w - - 0 1',
    activeRuleIds: ['parry', 'pacman_style'],
  });

  await handleMove(io, whiteSocket, gameManager, { from: 'a2', to: 'h4' });
  assert.ok(room.mutatorState.pendingRPS);
  await triggerAndSettle(whiteSocket, 'rpsChoice', { choice: 'rock' });
  await triggerAndSettle(blackSocket, 'rpsChoice', { choice: 'scissors' });

  const promptIndex = roomEvents.findIndex((e) => e.name === 'rpsPrompt');
  const resultIndex = roomEvents.findIndex((e) => e.name === 'rpsResult');
  const moveIndex = roomEvents.findIndex((e) => e.name === 'moveApplied');

  assert.ok(promptIndex > -1 && resultIndex > -1 && moveIndex > -1);
  assert.ok(promptIndex < resultIndex);
  assert.ok(resultIndex < moveIndex);
});
