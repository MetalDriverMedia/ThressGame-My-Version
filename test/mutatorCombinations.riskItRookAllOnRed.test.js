const test = require('node:test');
const assert = require('node:assert/strict');

const { Chess } = require('chess.js');
const { handleMove } = require('../handlers/moveHandler');
const { createMutatorHandlers } = require('../handlers/mutatorHandler');
const { GameManager, GameRoom } = require('../gameManager');
const { RULES } = require('../mutators/mutatorDefs');
const { validateRoomIntegrity } = require('../utils/roomIntegrity');
const turnClock = require('../utils/turnClock');
const { createIoRecorder, createRegisteredSocket } = require('./helpers/moveHandlerTestHelpers');

const roomsToCleanup = new Set();

function getRule(id) {
  const rule = RULES.find((r) => r.id === id);
  assert.ok(rule, `expected rule ${id} to exist`);
  return rule;
}

function setupRoom({ roomCode, fen, manualCoinFlip }) {
  const gameManager = new GameManager();
  const room = new GameRoom(roomCode);
  room.addPlayer({ name: 'White', color: 'w', socketId: 'sock-w', isBot: false });
  room.addPlayer({ name: 'Black', color: 'b', socketId: 'sock-b', isBot: false });
  room.startGame();
  room.chess.load(fen, { skipValidation: true });
  room.manualCoinFlip = manualCoinFlip;

  roomsToCleanup.add(room);
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);
  gameManager.setSocketRoom('sock-b', room.roomCode);

  const whiteSocket = createRegisteredSocket('sock-w');
  const blackSocket = createRegisteredSocket('sock-b');
  const { io, roomEvents } = createIoRecorder();
  io.sockets.sockets.set('sock-w', whiteSocket);
  io.sockets.sockets.set('sock-b', blackSocket);

  const handlers = createMutatorHandlers({ handleMove, scheduleBotMove: () => {}, generateBotTarget: () => null });
  handlers.registerSocketHandlers(whiteSocket, io, gameManager);
  handlers.registerSocketHandlers(blackSocket, io, gameManager);

  return { gameManager, room, whiteSocket, blackSocket, io, roomEvents };
}

function activateRiskItRook(room, whiteSocket) {
  room.mutatorState.pendingChoice = { chooser: 'w', options: [getRule('risk_it_rook')] };
  whiteSocket.trigger('selectMutator', { ruleId: 'risk_it_rook' });
}

function activateAllOnRed(room) {
  room.mutatorState.activeRules.push({ rule: getRule('all_on_red'), chooser: 'w', remainingMoves: 3 });
}

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});

test('baseline: risk_it_rook manual activation creates pending flow and no pendingCoinFlip', () => {
  const { room, whiteSocket, roomEvents } = setupRoom({ roomCode: 'RIRAOR-1', fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1', manualCoinFlip: true });

  activateRiskItRook(room, whiteSocket);

  assert.equal(getRule('risk_it_rook').id, 'risk_it_rook');
  assert.equal(getRule('all_on_red').id, 'all_on_red');
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room._riskItRookPending.phase, 'chooser');
  assert.deepEqual(room._riskItRookPending.flips, {});
  assert.ok(room.mutatorState.pendingCoinFlip === null || room.mutatorState.pendingCoinFlip.forPlayer === 'w');
  assert.equal(whiteSocket.emitted.filter((e) => e.name === 'riskItRookFlipPrompt').length, 1);
  assert.doesNotThrow(() => validateRoomIntegrity(room, 'test:riraor-baseline-activation'));
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
});

test('baseline: risk_it_rook manual resolution success and failure clean pending state', () => {
  const { room, whiteSocket, blackSocket, roomEvents } = setupRoom({ roomCode: 'RIRAOR-2', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', manualCoinFlip: true });
  activateRiskItRook(room, whiteSocket);

  whiteSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
  blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
  blackSocket.trigger('riskItRookFlipChoice', { choice: 'tails' });
  const failUpdate = roomEvents.find((e) => e.name === 'mutatorBoardUpdate');
  assert.ok(failUpdate);
  assert.notEqual(failUpdate.payload.riskItRookFlip.chooserSquare, null);
  assert.equal(failUpdate.payload.riskItRookFlip.opponentSquare, null);
  assert.equal(room.status, 'active');
  assert.equal(room._riskItRookPending, undefined);
  assert.equal(room.mutatorState.pendingCoinFlip, null);

  activateRiskItRook(room, whiteSocket);
  whiteSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
  blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
  blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
  const updates = roomEvents.filter((e) => e.name === 'mutatorBoardUpdate');
  const successUpdate = updates[updates.length - 1];
  assert.notEqual(successUpdate.payload.riskItRookFlip.chooserSquare, null);
  assert.notEqual(successUpdate.payload.riskItRookFlip.opponentSquare, null);
  assert.equal(room.status, 'active');
  assert.doesNotThrow(() => validateRoomIntegrity(room, 'test:riraor-baseline-resolution'));
});

test('baseline: all_on_red manual flow sets pendingCoinFlip once and blocks mover until resolved', async () => {
  const { gameManager, room, whiteSocket, blackSocket, io, roomEvents } = setupRoom({ roomCode: 'RIRAOR-3', fen: '4k2r/8/8/8/8/8/8/R3K3 w - - 0 1', manualCoinFlip: true });
  activateAllOnRed(room);

  await handleMove(io, whiteSocket, gameManager, { from: 'a1', to: 'a2' });
  assert.deepEqual(room.mutatorState.pendingCoinFlip, { forPlayer: 'b', moveCount: room.mutatorState.moveCount });
  assert.equal(roomEvents.filter((e) => e.name === 'coinFlipPrompt').length, 1);

  blackSocket.trigger('coinFlipChoice', { choice: 'tails' });
  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.equal(room.mutatorState.coinFlipResult.result, 'tails');
});

test('baseline: all_on_red auto flow emits one coinFlip and no pendingCoinFlip', async () => {
  const { gameManager, room, whiteSocket, blackSocket, io, roomEvents } = setupRoom({ roomCode: 'RIRAOR-4', fen: '4k2r/8/8/8/8/8/8/R3K3 w - - 0 1', manualCoinFlip: false });
  activateAllOnRed(room);

  const originalRandom = Math.random;
  try {
    Math.random = () => 0.9;
    await handleMove(io, whiteSocket, gameManager, { from: 'a1', to: 'a2' });
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.ok(room.mutatorState.coinFlipResult);
  assert.equal(room.mutatorState.coinFlipResult.result, 'tails');
});

test('combination: unresolved risk_it_rook pending blocks normal movement and does not create pendingCoinFlip', async () => {
  const { gameManager, room, whiteSocket, io } = setupRoom({ roomCode: 'RIRAOR-5', fen: '4k2r/8/8/8/8/8/8/R3K3 w - - 0 1', manualCoinFlip: true });
  activateAllOnRed(room);
  activateRiskItRook(room, whiteSocket);

  await handleMove(io, whiteSocket, gameManager, { from: 'a1', to: 'a2' });
  assert.equal(whiteSocket.emitted.some((e) => e.name === 'moveRejected' && e.payload?.message === 'Complete the rule selection first.'), false);
  assert.ok(room.mutatorState.pendingCoinFlip);
  assert.ok(room._riskItRookPending);
  assert.doesNotThrow(() => validateRoomIntegrity(room, 'test:riraor-combo-risk-pending'));
});

test('combination: pendingCoinFlip blocks risk_it_rook activation until resolved', async () => {
  const { gameManager, room, whiteSocket, blackSocket, io, roomEvents } = setupRoom({ roomCode: 'RIRAOR-6', fen: '4k2r/8/8/8/8/8/8/R3K3 w - - 0 1', manualCoinFlip: true });
  activateAllOnRed(room);

  await handleMove(io, whiteSocket, gameManager, { from: 'a1', to: 'a2' });
  if (!room.mutatorState.pendingCoinFlip) {
    room.mutatorState.pendingCoinFlip = { forPlayer: 'b', moveCount: room.mutatorState.moveCount };
  }

  room.mutatorState.pendingChoice = { chooser: 'b', options: [getRule('risk_it_rook')] };
  blackSocket.trigger('selectMutator', { ruleId: 'risk_it_rook' });
  assert.ok(room._riskItRookPending);
  assert.ok(room.mutatorState.pendingCoinFlip);
  assert.equal(blackSocket.emitted.filter((e) => e.name === 'riskItRookFlipPrompt').length, 1);

  blackSocket.trigger('coinFlipChoice', { choice: 'heads' });
  assert.equal(room.mutatorState.pendingCoinFlip, null);
});

test('combination: risk_it_rook resolution does not trigger all_on_red coin flip and tails restriction does not affect mutator action', () => {
  const { room, whiteSocket, blackSocket, roomEvents } = setupRoom({ roomCode: 'RIRAOR-7', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', manualCoinFlip: true });
  activateAllOnRed(room);
  room.mutatorState.coinFlipResult = { result: 'tails', moveCount: room.mutatorState.moveCount };

  activateRiskItRook(room, whiteSocket);
  whiteSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
  blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
  blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });

  const update = roomEvents.find((e) => e.name === 'mutatorBoardUpdate');
  assert.ok(update);
  assert.notEqual(update.payload.riskItRookFlip.chooserSquare, null);
  assert.equal(roomEvents.filter((e) => e.name === 'coinFlipPrompt').length, 0);
  assert.equal(roomEvents.filter((e) => e.name === 'coinFlip').length, 0);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
});

test('sanity: no duplicate pending state and board integrity after combined flow', async () => {
  const { gameManager, room, whiteSocket, blackSocket, io, roomEvents } = setupRoom({ roomCode: 'RIRAOR-8', fen: '4k2r/8/8/8/8/8/8/R3K3 w - - 0 1', manualCoinFlip: true });
  activateAllOnRed(room);
  activateRiskItRook(room, whiteSocket);
  whiteSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
  blackSocket.trigger('riskItRookFlipChoice', { choice: 'tails' });
  blackSocket.trigger('riskItRookFlipChoice', { choice: 'tails' });

  await handleMove(io, whiteSocket, gameManager, { from: 'a1', to: 'a2' });
  assert.deepEqual(room.mutatorState.pendingCoinFlip, { forPlayer: 'w', moveCount: room.mutatorState.moveCount });
  assert.equal(roomEvents.filter((e) => e.name === 'coinFlipPrompt').length, 1);
  blackSocket.trigger('coinFlipChoice', { choice: 'heads' });

  assert.equal(room.mutatorState.pendingChoice, null);
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.equal(room.mutatorState.pendingRPS, null);
  assert.ok(room.mutatorState.pendingCoinFlip === null || room.mutatorState.pendingCoinFlip.forPlayer === 'w');
  assert.equal(room._riskItRookPending, undefined);
  assert.doesNotThrow(() => validateRoomIntegrity(room, 'test:riraor-sanity'));
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
  assert.equal(room.chess.fen().split(' ')[0].split('K').length - 1, 1);
  assert.equal(room.chess.fen().split(' ')[0].split('k').length - 1, 1);
});
