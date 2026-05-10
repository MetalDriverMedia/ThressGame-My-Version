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

function hasMove(moves, from, to) {
  return moves.some((m) => m.from === from && m.to === to);
}

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});

test('baseline: pacman_style enables known wrap move a2->h4', async () => {
  const fen = '4k3/8/8/8/8/8/N7/4K3 w - - 0 1';

  const baseline = setupRoom({ roomCode: 'PAC-IA-BASE-1', fen });
  assert.equal(hasMove(getEffectiveLegalMoves(baseline.room, 'w'), 'a2', 'h4'), false);
  await handleMove(baseline.io, baseline.whiteSocket, baseline.gameManager, { from: 'a2', to: 'h4' });
  assert.ok(baseline.whiteSocket.emitted.find((e) => e.name === 'moveRejected'));

  const pacman = setupRoom({ roomCode: 'PAC-IA-BASE-2', fen, activeRuleIds: ['pacman_style'] });
  assert.equal(hasMove(getEffectiveLegalMoves(pacman.room, 'w'), 'a2', 'h4'), true);
  await handleMove(pacman.io, pacman.whiteSocket, pacman.gameManager, { from: 'a2', to: 'h4' });
  assert.equal(pacman.roomEvents.filter((e) => e.name === 'moveApplied').length, 1);
  assert.equal(pacman.room.chess.get('a2'), undefined);
  assert.equal(pacman.room.chess.get('h4').type, 'n');
});

test('baseline: ice_age blocks normal movement from A/H files but not from non-edge files', async () => {
  const edgeA = setupRoom({ roomCode: 'PAC-IA-BASE-3', fen: '4k3/8/8/8/8/8/N7/4K2N w - - 0 1', activeRuleIds: ['ice_age'] });
  const edgeABefore = edgeA.room.chess.fen();
  await handleMove(edgeA.io, edgeA.whiteSocket, edgeA.gameManager, { from: 'a2', to: 'b4' });
  assert.ok(edgeA.whiteSocket.emitted.find((e) => e.name === 'moveRejected'));
  assert.equal(edgeA.roomEvents.filter((e) => e.name === 'moveApplied').length, 0);
  assert.equal(edgeA.room.chess.fen(), edgeABefore);

  const edgeH = setupRoom({ roomCode: 'PAC-IA-BASE-4', fen: '4k3/8/8/8/8/8/N7/4K2N w - - 0 1', activeRuleIds: ['ice_age'] });
  const edgeHBefore = edgeH.room.chess.fen();
  await handleMove(edgeH.io, edgeH.whiteSocket, edgeH.gameManager, { from: 'h1', to: 'f2' });
  assert.ok(edgeH.whiteSocket.emitted.find((e) => e.name === 'moveRejected'));
  assert.equal(edgeH.roomEvents.filter((e) => e.name === 'moveApplied').length, 0);
  assert.equal(edgeH.room.chess.fen(), edgeHBefore);

  const nonEdge = setupRoom({ roomCode: 'PAC-IA-BASE-5', fen: '4k3/8/8/8/8/8/3N4/4K3 w - - 0 1', activeRuleIds: ['ice_age'] });
  await handleMove(nonEdge.io, nonEdge.whiteSocket, nonEdge.gameManager, { from: 'd2', to: 'f3' });
  assert.equal(nonEdge.roomEvents.filter((e) => e.name === 'moveApplied').length, 1);
  assert.equal(nonEdge.room.chess.get('d2'), undefined);
  assert.equal(nonEdge.room.chess.get('f3').type, 'n');
});

test('pacman_style + ice_age blocks forward wrap move from frozen file A', async () => {
  const fen = '4k3/8/8/8/8/8/N7/4K3 w - - 0 1';
  const pacmanOnly = setupRoom({ roomCode: 'PAC-IA-COMB-1', fen, activeRuleIds: ['pacman_style'] });
  assert.equal(hasMove(getEffectiveLegalMoves(pacmanOnly.room, 'w'), 'a2', 'h4'), true);

  const combined = setupRoom({ roomCode: 'PAC-IA-COMB-2', fen, activeRuleIds: ['pacman_style', 'ice_age'] });
  const before = combined.room.chess.fen();
  assert.equal(hasMove(getEffectiveLegalMoves(combined.room, 'w'), 'a2', 'h4'), false);

  await handleMove(combined.io, combined.whiteSocket, combined.gameManager, { from: 'a2', to: 'h4' });
  assert.ok(combined.whiteSocket.emitted.find((e) => e.name === 'moveRejected'));
  assert.equal(combined.roomEvents.filter((e) => e.name === 'moveApplied').length, 0);
  assert.equal(combined.room.chess.fen(), before);
  assert.equal(combined.room.mutatorState.pendingRPS, null);
  assert.equal(combined.room.mutatorState.pendingChoice, null);
  assert.equal(combined.room.mutatorState.pendingAction, null);
  assert.equal(combined.room.mutatorState.pendingSecondAction, null);
});

test('pacman_style + ice_age blocks backward wrap move from frozen file A', async () => {
  const fen = '4k3/8/8/8/N7/8/8/4K3 w - - 0 1';
  const pacmanOnly = setupRoom({ roomCode: 'PAC-IA-BACK-1', fen, activeRuleIds: ['pacman_style'] });
  assert.equal(hasMove(getEffectiveLegalMoves(pacmanOnly.room, 'w'), 'a4', 'h2'), true);

  const combined = setupRoom({ roomCode: 'PAC-IA-BACK-2', fen, activeRuleIds: ['pacman_style', 'ice_age'] });
  const before = combined.room.chess.fen();
  assert.equal(hasMove(getEffectiveLegalMoves(combined.room, 'w'), 'a4', 'h2'), false);

  await handleMove(combined.io, combined.whiteSocket, combined.gameManager, { from: 'a4', to: 'h2' });
  assert.ok(combined.whiteSocket.emitted.find((e) => e.name === 'moveRejected'));
  assert.equal(combined.roomEvents.filter((e) => e.name === 'moveApplied').length, 0);
  assert.equal(combined.room.chess.fen(), before);
});

test('pacman_style + ice_age blocks wrap capture from frozen file A', async () => {
  const fen = '4k3/8/8/8/7p/8/N7/4K3 w - - 0 1';
  const pacmanOnly = setupRoom({ roomCode: 'PAC-IA-CAP-1', fen, activeRuleIds: ['pacman_style'] });
  assert.equal(hasMove(getEffectiveLegalMoves(pacmanOnly.room, 'w'), 'a2', 'h4'), true);
  await handleMove(pacmanOnly.io, pacmanOnly.whiteSocket, pacmanOnly.gameManager, { from: 'a2', to: 'h4' });
  assert.equal(pacmanOnly.roomEvents.filter((e) => e.name === 'moveApplied').length, 1);

  const combined = setupRoom({ roomCode: 'PAC-IA-CAP-2', fen, activeRuleIds: ['pacman_style', 'ice_age'] });
  assert.equal(hasMove(getEffectiveLegalMoves(combined.room, 'w'), 'a2', 'h4'), false);
  await handleMove(combined.io, combined.whiteSocket, combined.gameManager, { from: 'a2', to: 'h4' });
  assert.ok(combined.whiteSocket.emitted.find((e) => e.name === 'moveRejected'));
  assert.equal(combined.roomEvents.filter((e) => e.name === 'moveApplied').length, 0);
  assert.equal(combined.room.chess.get('a2').type, 'n');
  assert.equal(combined.room.chess.get('h4').type, 'p');
});

test('ice_age allows pacman wrap landing on frozen edge when origin is not frozen', async () => {
  const fen = '4k3/8/8/8/8/8/6N1/4K3 w - - 0 1';
  const pacmanOnly = setupRoom({ roomCode: 'PAC-IA-LAND-1', fen, activeRuleIds: ['pacman_style'] });
  assert.equal(hasMove(getEffectiveLegalMoves(pacmanOnly.room, 'w'), 'g2', 'a3'), true);

  const combined = setupRoom({ roomCode: 'PAC-IA-LAND-2', fen, activeRuleIds: ['pacman_style', 'ice_age'] });
  assert.equal(hasMove(getEffectiveLegalMoves(combined.room, 'w'), 'g2', 'a3'), true);
  await handleMove(combined.io, combined.whiteSocket, combined.gameManager, { from: 'g2', to: 'a3' });
  assert.equal(combined.roomEvents.filter((e) => e.name === 'moveApplied').length, 1);
  assert.equal(combined.room.chess.get('g2'), undefined);
  assert.equal(combined.room.chess.get('a3').type, 'n');
});

test('effective legal move pool alignment: default and synthetic-before-restrictions agree under pacman_style + ice_age', async () => {
  const fen = '4k3/8/8/8/8/8/N7/4K3 w - - 0 1';
  const combined = setupRoom({ roomCode: 'PAC-IA-POOL-1', fen, activeRuleIds: ['pacman_style', 'ice_age'] });
  const defaultMoves = getEffectiveLegalMoves(combined.room, 'w');
  const preRestrictionMoves = getEffectiveLegalMoves(combined.room, 'w', { syntheticMovesBeforeRestrictions: true });

  assert.equal(hasMove(defaultMoves, 'a2', 'h4'), false);
  assert.equal(hasMove(preRestrictionMoves, 'a2', 'h4'), false);
  assert.deepEqual(new Set(defaultMoves.map((m) => `${m.from}-${m.to}`)), new Set(preRestrictionMoves.map((m) => `${m.from}-${m.to}`)));

  await handleMove(combined.io, combined.whiteSocket, combined.gameManager, { from: 'a2', to: 'h4' });
  assert.ok(combined.whiteSocket.emitted.find((e) => e.name === 'moveRejected'));
});

test('bot move pool alignment: includes known wrap in pacman_style alone and excludes it under pacman_style + ice_age', () => {
  const fen = '4k3/8/8/8/8/8/N7/4K3 w - - 0 1';
  const pacmanOnly = setupRoom({ roomCode: 'PAC-IA-BOT-1', fen, activeRuleIds: ['pacman_style'] });
  const combined = setupRoom({ roomCode: 'PAC-IA-BOT-2', fen, activeRuleIds: ['pacman_style', 'ice_age'] });

  assert.equal(hasMove(getBotMovePool(pacmanOnly.room, 'w'), 'a2', 'h4'), true);

  const botPool = getBotMovePool(combined.room, 'w');
  const defaultMoves = getEffectiveLegalMoves(combined.room, 'w');
  const preRestrictionMoves = getEffectiveLegalMoves(combined.room, 'w', { syntheticMovesBeforeRestrictions: true });
  assert.equal(hasMove(botPool, 'a2', 'h4'), false);
  assert.deepEqual(new Set(botPool.map((m) => `${m.from}-${m.to}`)), new Set(defaultMoves.map((m) => `${m.from}-${m.to}`)));
  assert.deepEqual(new Set(botPool.map((m) => `${m.from}-${m.to}`)), new Set(preRestrictionMoves.map((m) => `${m.from}-${m.to}`)));
});

test('checkMutatorDeadlock default effective callers do not see illegal pacman wraps from frozen file A', () => {
  const fen = '4k3/8/8/8/8/8/N7/4K3 w - - 0 1';
  const combined = setupRoom({ roomCode: 'PAC-IA-DEAD-1', fen, activeRuleIds: ['pacman_style', 'ice_age'] });

  assert.equal(hasMove(getEffectiveLegalMoves(combined.room, 'w'), 'a2', 'h4'), false);
  const ended = checkMutatorDeadlock(combined.room, combined.io, combined.gameManager);
  assert.equal(ended, false);
});
