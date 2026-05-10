const test = require('node:test');
const assert = require('node:assert/strict');

const { handleMove } = require('../handlers/moveHandler');
const { createMutatorHandlers } = require('../handlers/mutatorHandler');
const { GameManager, GameRoom } = require('../gameManager');
const { RULES } = require('../mutators/mutatorDefs');
const { getEffectiveLegalMoves } = require('../mutators/legalMoveEngine');
const { getBotMovePool } = require('../botManager');
const { checkMutatorDeadlock } = require('../utils/gameLifecycle');
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

test('baseline: pacman_style enables deterministic wrap move and handleMove applies it once', async () => {
  const fen = '4k3/8/8/8/8/8/N7/4K3 w - - 0 1';

  const baseline = setupRoom({ roomCode: 'PAC-SS-BASE-1', fen });
  assert.equal(getEffectiveLegalMoves(baseline.room, 'w').some((m) => m.from === 'a2' && m.to === 'h4'), false);

  await handleMove(baseline.io, baseline.whiteSocket, baseline.gameManager, { from: 'a2', to: 'h4' });
  assert.ok(baseline.whiteSocket.emitted.find((e) => e.name === 'moveRejected'));
  assert.equal(baseline.room.chess.get('a2').type, 'n');
  assert.equal(baseline.room.chess.get('h4'), undefined);

  const pacman = setupRoom({ roomCode: 'PAC-SS-BASE-2', fen, activeRuleIds: ['pacman_style'] });
  assert.equal(getEffectiveLegalMoves(pacman.room, 'w').some((m) => m.from === 'a2' && m.to === 'h4'), true);

  await handleMove(pacman.io, pacman.whiteSocket, pacman.gameManager, { from: 'a2', to: 'h4' });

  assert.equal(pacman.room.chess.get('a2'), undefined);
  assert.equal(pacman.room.chess.get('h4').type, 'n');
  assert.equal(pacman.roomEvents.filter((e) => e.name === 'moveApplied').length, 1);
});

test('baseline: short_stop blocks normal long non-wrap move', async () => {
  const fen = '4k3/8/8/8/8/8/Q7/4K3 w - - 0 1';

  const baseline = setupRoom({ roomCode: 'PAC-SS-BASE-3', fen });
  assert.equal(getEffectiveLegalMoves(baseline.room, 'w').some((m) => m.from === 'a2' && m.to === 'a5'), true);
  await handleMove(baseline.io, baseline.whiteSocket, baseline.gameManager, { from: 'a2', to: 'a5' });
  assert.equal(baseline.roomEvents.filter((e) => e.name === 'moveApplied').length, 1);

  const shortStop = setupRoom({ roomCode: 'PAC-SS-BASE-4', fen, activeRuleIds: ['short_stop'] });
  const before = shortStop.room.chess.fen();
  assert.equal(getEffectiveLegalMoves(shortStop.room, 'w').some((m) => m.from === 'a2' && m.to === 'a5'), false);

  await handleMove(shortStop.io, shortStop.whiteSocket, shortStop.gameManager, { from: 'a2', to: 'a5' });

  assert.ok(shortStop.whiteSocket.emitted.find((e) => e.name === 'moveRejected'));
  assert.equal(shortStop.roomEvents.filter((e) => e.name === 'moveApplied').length, 0);
  assert.equal(shortStop.room.chess.fen(), before);
});

test('pacman_style + short_stop filters long wrap move from effective pool and handleMove rejects it', async () => {
  const fen = '4k3/8/8/8/8/8/N7/4K3 w - - 0 1';

  const pacmanOnly = setupRoom({ roomCode: 'PAC-SS-COMB-1', fen, activeRuleIds: ['pacman_style'] });
  assert.equal(getEffectiveLegalMoves(pacmanOnly.room, 'w').some((m) => m.from === 'a2' && m.to === 'h4'), true);

  const combined = setupRoom({ roomCode: 'PAC-SS-COMB-2', fen, activeRuleIds: ['pacman_style', 'short_stop'] });
  const before = combined.room.chess.fen();

  assert.equal(getEffectiveLegalMoves(combined.room, 'w').some((m) => m.from === 'a2' && m.to === 'h4'), false);
  await handleMove(combined.io, combined.whiteSocket, combined.gameManager, { from: 'a2', to: 'h4' });

  assert.equal(combined.room.mutatorState.pendingRPS, null);
  assert.equal(combined.room.mutatorState.pendingChoice, null);
  assert.equal(combined.room.mutatorState.pendingAction, null);
  assert.equal(combined.room.mutatorState.pendingSecondAction, null);
  assert.ok(combined.whiteSocket.emitted.find((e) => e.name === 'moveRejected'));
  assert.equal(combined.roomEvents.filter((e) => e.name === 'moveApplied').length, 0);
  assert.equal(combined.room.chess.fen(), before);
  assert.equal(combined.room.chess.get('a2').type, 'n');
  assert.equal(combined.room.chess.get('h4'), undefined);
});

test('pacman_style + short_stop allows normal 1-square move, emits once, and advances turn', async () => {
  const fen = '4k3/8/8/8/8/8/8/4K2R w - - 0 1';
  const combined = setupRoom({ roomCode: 'PAC-SS-COMB-3', fen, activeRuleIds: ['pacman_style', 'short_stop'] });

  const before = combined.room.chess.fen();
  assert.equal(getEffectiveLegalMoves(combined.room, 'w').some((m) => m.from === 'h1' && m.to === 'g1'), true);

  await handleMove(combined.io, combined.whiteSocket, combined.gameManager, { from: 'h1', to: 'g1' });

  assert.notEqual(combined.room.chess.fen(), before);
  assert.equal(combined.room.chess.get('h1'), undefined);
  assert.equal(combined.room.chess.get('g1').type, 'r');
  assert.equal(combined.roomEvents.filter((e) => e.name === 'moveApplied').length, 1);
  assert.equal(combined.room.chess.turn(), 'b');
});

test('pacman_style + short_stop filters wrap capture from effective pool and handleMove rejects it', async () => {
  const fen = '4k3/8/8/8/7p/8/N7/4K3 w - - 0 1';

  const pacmanOnly = setupRoom({ roomCode: 'PAC-SS-CAP-1', fen, activeRuleIds: ['pacman_style'] });
  assert.equal(getEffectiveLegalMoves(pacmanOnly.room, 'w').some((m) => m.from === 'a2' && m.to === 'h4'), true);
  await handleMove(pacmanOnly.io, pacmanOnly.whiteSocket, pacmanOnly.gameManager, { from: 'a2', to: 'h4' });
  assert.equal(pacmanOnly.room.chess.get('a2'), undefined);
  assert.equal(pacmanOnly.room.chess.get('h4').type, 'n');
  assert.equal(pacmanOnly.roomEvents.filter((e) => e.name === 'moveApplied').length, 1);

  const combined = setupRoom({ roomCode: 'PAC-SS-CAP-2', fen, activeRuleIds: ['pacman_style', 'short_stop'] });
  const before = combined.room.chess.fen();

  assert.equal(getEffectiveLegalMoves(combined.room, 'w').some((m) => m.from === 'a2' && m.to === 'h4'), false);
  await handleMove(combined.io, combined.whiteSocket, combined.gameManager, { from: 'a2', to: 'h4' });

  assert.ok(combined.whiteSocket.emitted.find((e) => e.name === 'moveRejected'));
  assert.equal(combined.roomEvents.filter((e) => e.name === 'moveApplied').length, 0);
  assert.equal(combined.room.chess.fen(), before);
  assert.equal(combined.room.chess.get('a2').type, 'n');
  assert.equal(combined.room.chess.get('h4').type, 'p');
});

test('effective legal move pool ordering matches handleMove for pacman_style + short_stop', () => {
  const fen = '4k3/8/8/8/8/8/N7/4K3 w - - 0 1';

  const pacmanOnly = setupRoom({ roomCode: 'PAC-SS-POOL-1', fen, activeRuleIds: ['pacman_style'] });
  const combined = setupRoom({ roomCode: 'PAC-SS-POOL-2', fen, activeRuleIds: ['pacman_style', 'short_stop'] });

  assert.equal(getEffectiveLegalMoves(pacmanOnly.room, 'w').some((m) => m.from === 'a2' && m.to === 'h4'), true);
  const defaultCombinedMoves = getEffectiveLegalMoves(combined.room, 'w');
  const preRestrictionCombinedMoves = getEffectiveLegalMoves(combined.room, 'w', { syntheticMovesBeforeRestrictions: true });

  assert.equal(defaultCombinedMoves.some((m) => m.from === 'a2' && m.to === 'h4'), false);
  assert.equal(preRestrictionCombinedMoves.some((m) => m.from === 'a2' && m.to === 'h4'), false);

  const defaultPairs = new Set(defaultCombinedMoves.map((m) => `${m.from}-${m.to}`));
  const preRestrictionPairs = new Set(preRestrictionCombinedMoves.map((m) => `${m.from}-${m.to}`));
  assert.deepEqual(defaultPairs, preRestrictionPairs);
});

test('bot move pool excludes long wrap under short_stop and matches effective legal pools', () => {
  const fen = '4k3/8/8/8/8/8/N7/4K3 w - - 0 1';
  const pacmanOnly = setupRoom({ roomCode: 'PAC-SS-BOT-1', fen, activeRuleIds: ['pacman_style'] });
  const combined = setupRoom({ roomCode: 'PAC-SS-BOT-2', fen, activeRuleIds: ['pacman_style', 'short_stop'] });

  assert.equal(getBotMovePool(pacmanOnly.room, 'w').some((m) => m.from === 'a2' && m.to === 'h4'), true);
  assert.equal(getBotMovePool(combined.room, 'w').some((m) => m.from === 'a2' && m.to === 'h4'), false);

  const defaultCombined = getEffectiveLegalMoves(combined.room, 'w');
  const effectiveCombined = getEffectiveLegalMoves(combined.room, 'w', { syntheticMovesBeforeRestrictions: true });
  const combinedPairs = new Set(getBotMovePool(combined.room, 'w').map((m) => `${m.from}-${m.to}`));
  const defaultPairs = new Set(defaultCombined.map((m) => `${m.from}-${m.to}`));
  const effectivePairs = new Set(effectiveCombined.map((m) => `${m.from}-${m.to}`));
  assert.deepEqual(combinedPairs, defaultPairs);
  assert.deepEqual(combinedPairs, effectivePairs);
});

test('checkMutatorDeadlock default effective pool excludes long pacman wrap under short_stop', () => {
  const fen = '4k3/8/8/8/8/8/N7/4K3 w - - 0 1';
  const combined = setupRoom({ roomCode: 'PAC-SS-DEAD-1', fen, activeRuleIds: ['pacman_style', 'short_stop'] });

  const ended = checkMutatorDeadlock(combined.room, combined.io, combined.gameManager);
  assert.equal(ended, false);
});
