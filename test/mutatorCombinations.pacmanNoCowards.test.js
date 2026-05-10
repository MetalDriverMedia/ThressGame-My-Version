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

test('baseline: pacman_style enables deterministic forward wrap move and handleMove applies it once', async () => {
  const fen = '4k3/8/8/8/8/8/N7/4K3 w - - 0 1';

  const baseline = setupRoom({ roomCode: 'PAC-NC-BASE-1', fen });
  assert.equal(hasMove(getEffectiveLegalMoves(baseline.room, 'w'), 'a2', 'h4'), false);
  await handleMove(baseline.io, baseline.whiteSocket, baseline.gameManager, { from: 'a2', to: 'h4' });
  assert.ok(baseline.whiteSocket.emitted.find((e) => e.name === 'moveRejected'));
  assert.equal(baseline.room.chess.get('a2').type, 'n');
  assert.equal(baseline.room.chess.get('h4'), undefined);

  const pacman = setupRoom({ roomCode: 'PAC-NC-BASE-2', fen, activeRuleIds: ['pacman_style'] });
  assert.equal(hasMove(getEffectiveLegalMoves(pacman.room, 'w'), 'a2', 'h4'), true);
  await handleMove(pacman.io, pacman.whiteSocket, pacman.gameManager, { from: 'a2', to: 'h4' });

  assert.equal(pacman.room.chess.get('a2'), undefined);
  assert.equal(pacman.room.chess.get('h4').type, 'n');
  assert.equal(pacman.roomEvents.filter((e) => e.name === 'moveApplied').length, 1);
});

test('baseline: no_cowards blocks backward movement and allows forward movement', async () => {
  const backward = setupRoom({ roomCode: 'PAC-NC-BASE-3', fen: '4k3/8/8/8/8/4P3/8/4K3 w - - 0 1', activeRuleIds: ['no_cowards'] });
  const beforeBackward = backward.room.chess.fen();
  await handleMove(backward.io, backward.whiteSocket, backward.gameManager, { from: 'e3', to: 'e2' });
  const rejection = backward.whiteSocket.emitted.find((e) => e.name === 'moveRejected');
  assert.ok(rejection);
  assert.equal(rejection.payload.error, 'Move blocked by active rule.');
  assert.equal(backward.roomEvents.filter((e) => e.name === 'moveApplied').length, 0);
  assert.equal(backward.room.chess.fen(), beforeBackward);

  const forward = setupRoom({ roomCode: 'PAC-NC-BASE-4', fen: '4k3/8/8/8/8/4P3/8/4K3 w - - 0 1', activeRuleIds: ['no_cowards'] });
  await handleMove(forward.io, forward.whiteSocket, forward.gameManager, { from: 'e3', to: 'e4' });
  assert.equal(forward.roomEvents.filter((e) => e.name === 'moveApplied').length, 1);
  assert.equal(forward.room.chess.get('e3'), undefined);
  assert.equal(forward.room.chess.get('e4').type, 'p');
});

test('pacman_style + no_cowards allows forward wrap move a2->h4 and applies it once', async () => {
  const fen = '4k3/8/8/8/8/8/N7/4K3 w - - 0 1';
  const pacmanOnly = setupRoom({ roomCode: 'PAC-NC-COMB-1', fen, activeRuleIds: ['pacman_style'] });
  assert.equal(hasMove(getEffectiveLegalMoves(pacmanOnly.room, 'w'), 'a2', 'h4'), true);

  const combined = setupRoom({ roomCode: 'PAC-NC-COMB-2', fen, activeRuleIds: ['pacman_style', 'no_cowards'] });
  assert.equal(hasMove(getEffectiveLegalMoves(combined.room, 'w'), 'a2', 'h4'), true);

  await handleMove(combined.io, combined.whiteSocket, combined.gameManager, { from: 'a2', to: 'h4' });

  assert.equal(combined.room.chess.get('a2'), undefined);
  assert.equal(combined.room.chess.get('h4').type, 'n');
  assert.equal(combined.roomEvents.filter((e) => e.name === 'moveApplied').length, 1);
});

test('pacman_style + no_cowards blocks backward wrap move a4->h2 and leaves no pending mutator state', async () => {
  const fen = '4k3/8/8/8/N7/8/8/4K3 w - - 0 1';
  const pacmanOnly = setupRoom({ roomCode: 'PAC-NC-BACK-1', fen, activeRuleIds: ['pacman_style'] });
  assert.equal(hasMove(getEffectiveLegalMoves(pacmanOnly.room, 'w'), 'a4', 'h2'), true);

  const combined = setupRoom({ roomCode: 'PAC-NC-BACK-2', fen, activeRuleIds: ['pacman_style', 'no_cowards'] });
  const before = combined.room.chess.fen();
  assert.equal(hasMove(getEffectiveLegalMoves(combined.room, 'w'), 'a4', 'h2'), false);

  await handleMove(combined.io, combined.whiteSocket, combined.gameManager, { from: 'a4', to: 'h2' });

  assert.ok(combined.whiteSocket.emitted.find((e) => e.name === 'moveRejected'));
  assert.equal(combined.roomEvents.filter((e) => e.name === 'moveApplied').length, 0);
  assert.equal(combined.room.chess.fen(), before);
  assert.equal(combined.room.mutatorState.pendingRPS, null);
  assert.equal(combined.room.mutatorState.pendingChoice, null);
  assert.equal(combined.room.mutatorState.pendingAction, null);
  assert.equal(combined.room.mutatorState.pendingSecondAction, null);
});

test('wrap capture filtering: forward wrap capture is allowed, backward wrap capture is blocked under no_cowards', async () => {
  const forwardFen = '4k3/8/8/8/7p/8/N7/4K3 w - - 0 1';
  const forwardPacman = setupRoom({ roomCode: 'PAC-NC-CAP-1', fen: forwardFen, activeRuleIds: ['pacman_style'] });
  assert.equal(hasMove(getEffectiveLegalMoves(forwardPacman.room, 'w'), 'a2', 'h4'), true);

  const forwardCombined = setupRoom({ roomCode: 'PAC-NC-CAP-2', fen: forwardFen, activeRuleIds: ['pacman_style', 'no_cowards'] });
  assert.equal(hasMove(getEffectiveLegalMoves(forwardCombined.room, 'w'), 'a2', 'h4'), true);
  await handleMove(forwardCombined.io, forwardCombined.whiteSocket, forwardCombined.gameManager, { from: 'a2', to: 'h4' });
  assert.equal(forwardCombined.roomEvents.filter((e) => e.name === 'moveApplied').length, 1);
  assert.equal(forwardCombined.room.chess.get('a2'), undefined);
  assert.equal(forwardCombined.room.chess.get('h4').type, 'n');

  const backwardFen = '4k3/8/8/8/N7/8/7p/4K3 w - - 0 1';
  const backwardPacman = setupRoom({ roomCode: 'PAC-NC-CAP-3', fen: backwardFen, activeRuleIds: ['pacman_style'] });
  assert.equal(hasMove(getEffectiveLegalMoves(backwardPacman.room, 'w'), 'a4', 'h2'), true);

  const backwardCombined = setupRoom({ roomCode: 'PAC-NC-CAP-4', fen: backwardFen, activeRuleIds: ['pacman_style', 'no_cowards'] });
  const beforeBackward = backwardCombined.room.chess.fen();
  assert.equal(hasMove(getEffectiveLegalMoves(backwardCombined.room, 'w'), 'a4', 'h2'), false);
  await handleMove(backwardCombined.io, backwardCombined.whiteSocket, backwardCombined.gameManager, { from: 'a4', to: 'h2' });
  assert.ok(backwardCombined.whiteSocket.emitted.find((e) => e.name === 'moveRejected'));
  assert.equal(backwardCombined.roomEvents.filter((e) => e.name === 'moveApplied').length, 0);
  assert.equal(backwardCombined.room.chess.fen(), beforeBackward);
});

test('effective legal move pool alignment: default and synthetic-before-restrictions agree under pacman_style + no_cowards', () => {
  const fen = '4k3/8/8/8/N7/8/8/4K3 w - - 0 1';
  const combined = setupRoom({ roomCode: 'PAC-NC-POOL-1', fen, activeRuleIds: ['pacman_style', 'no_cowards'] });

  const defaultMoves = getEffectiveLegalMoves(combined.room, 'w');
  const preRestrictionMoves = getEffectiveLegalMoves(combined.room, 'w', { syntheticMovesBeforeRestrictions: true });

  assert.equal(hasMove(defaultMoves, 'a4', 'h2'), false);
  assert.equal(hasMove(preRestrictionMoves, 'a4', 'h2'), false);

  const defaultPairs = new Set(defaultMoves.map((m) => `${m.from}-${m.to}`));
  const prePairs = new Set(preRestrictionMoves.map((m) => `${m.from}-${m.to}`));
  assert.deepEqual(defaultPairs, prePairs);
});

test('bot move pool alignment: includes forward wrap, excludes backward wrap, and matches effective legal pools', () => {
  const forwardFen = '4k3/8/8/8/8/8/N7/4K3 w - - 0 1';
  const forwardCombined = setupRoom({ roomCode: 'PAC-NC-BOT-1', fen: forwardFen, activeRuleIds: ['pacman_style', 'no_cowards'] });
  assert.equal(hasMove(getBotMovePool(forwardCombined.room, 'w'), 'a2', 'h4'), true);

  const backwardFen = '4k3/8/8/8/N7/8/8/4K3 w - - 0 1';
  const backwardCombined = setupRoom({ roomCode: 'PAC-NC-BOT-2', fen: backwardFen, activeRuleIds: ['pacman_style', 'no_cowards'] });

  const botPool = getBotMovePool(backwardCombined.room, 'w');
  const defaultMoves = getEffectiveLegalMoves(backwardCombined.room, 'w');
  const preRestrictionMoves = getEffectiveLegalMoves(backwardCombined.room, 'w', { syntheticMovesBeforeRestrictions: true });

  assert.equal(hasMove(botPool, 'a4', 'h2'), false);
  const botPairs = new Set(botPool.map((m) => `${m.from}-${m.to}`));
  const defaultPairs = new Set(defaultMoves.map((m) => `${m.from}-${m.to}`));
  const prePairs = new Set(preRestrictionMoves.map((m) => `${m.from}-${m.to}`));
  assert.deepEqual(botPairs, defaultPairs);
  assert.deepEqual(botPairs, prePairs);
});

test('checkMutatorDeadlock default effective caller does not see backward wrap filtered by no_cowards', () => {
  const fen = '4k3/8/8/8/N7/8/8/4K3 w - - 0 1';
  const combined = setupRoom({ roomCode: 'PAC-NC-DEAD-1', fen, activeRuleIds: ['pacman_style', 'no_cowards'] });

  assert.equal(hasMove(getEffectiveLegalMoves(combined.room, 'w'), 'a4', 'h2'), false);
  const ended = checkMutatorDeadlock(combined.room, combined.io, combined.gameManager);
  assert.equal(ended, false);
});
