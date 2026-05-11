const test = require('node:test');
const assert = require('node:assert/strict');

const { GameManager, GameRoom } = require('../gameManager');
const { RULES } = require('../mutators/mutatorDefs');
const { createMutatorHandlers } = require('../handlers/mutatorHandler');
const { triggerCoinFlip } = require('../utils/gameLifecycle');
const { createIoRecorder, createRegisteredSocket } = require('./helpers/moveHandlerTestHelpers');

function getRule(id) {
  const rule = RULES.find((r) => r.id === id);
  assert.ok(rule, `expected rule ${id} to exist`);
  return rule;
}

function setupRoom({ roomCode, manualCoinFlip }) {
  const gameManager = new GameManager();
  const room = new GameRoom(roomCode);
  room.addPlayer({ name: 'White', color: 'w', socketId: 'sock-w', isBot: false });
  room.addPlayer({ name: 'Black', color: 'b', socketId: 'sock-b', isBot: false });
  room.startGame();
  // Keep the standard opening position to avoid deadlock side-effects during
  // Risk It Rook + All On Red lifecycle assertions.
  room.manualCoinFlip = manualCoinFlip;

  room.mutatorState.activeRules.push({ rule: getRule('all_on_red'), chooser: 'w', remainingMoves: 3 });
  room.mutatorState.pendingChoice = { chooser: 'w', options: [getRule('risk_it_rook')] };

  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);
  gameManager.setSocketRoom('sock-b', room.roomCode);

  const whiteSocket = createRegisteredSocket('sock-w');
  const blackSocket = createRegisteredSocket('sock-b');
  const { io, roomEvents } = createIoRecorder();
  io.sockets.sockets.set('sock-w', whiteSocket);
  io.sockets.sockets.set('sock-b', blackSocket);

  const handlers = createMutatorHandlers({
    handleMove: async () => {},
    scheduleBotMove: () => {},
    generateBotTarget: () => null,
  });
  handlers.registerSocketHandlers(whiteSocket, io, gameManager);
  handlers.registerSocketHandlers(blackSocket, io, gameManager);

  return { room, whiteSocket, blackSocket, roomEvents, io };
}

test('manual Risk It Rook completion keeps All On Red prompt deterministic after finalization', () => {
  const { room, whiteSocket, blackSocket, roomEvents, io } = setupRoom({ roomCode: 'RIR-AOR-1', manualCoinFlip: true });

  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    whiteSocket.trigger('selectMutator', { ruleId: 'risk_it_rook' });
    whiteSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
    blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
    blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
  } finally {
    Math.random = originalRandom;
  }

  // Risk It Rook prompts are separate from All On Red prompt lifecycle.
  assert.equal(roomEvents.filter((e) => e.name === 'coinFlipPrompt').length, 0);
  assert.equal(roomEvents.filter((e) => e.name === 'coinFlip').length, 0);

  const expectedForPlayer = room.chess.turn();
  room.mutatorState.coinFlipResult = null;
  room.mutatorState.pendingCoinFlip = null;
  triggerCoinFlip(room, io, expectedForPlayer);
  assert.deepEqual(room.mutatorState.pendingCoinFlip, { forPlayer: expectedForPlayer, moveCount: room.mutatorState.moveCount });
  assert.equal(roomEvents.filter((e) => e.name === 'coinFlipPrompt').length, 1);

  // Same moveCount duplicate trigger attempt must not create a second prompt.
  triggerCoinFlip(room, io, expectedForPlayer);
  assert.equal(roomEvents.filter((e) => e.name === 'coinFlipPrompt').length, 1);
});

test('manual All On Red direct triggerCoinFlip emits prompt and stores no result', () => {
  const { room, roomEvents, io } = setupRoom({ roomCode: 'RIR-AOR-2', manualCoinFlip: true });

  room.mutatorState.pendingCoinFlip = null;
  room.mutatorState.coinFlipResult = null;

  triggerCoinFlip(room, io, 'w');

  assert.deepEqual(room.mutatorState.pendingCoinFlip, { forPlayer: 'w', moveCount: room.mutatorState.moveCount });
  assert.equal(room.mutatorState.coinFlipResult, null);
  assert.equal(roomEvents.filter((e) => e.name === 'coinFlipPrompt').length, 1);
});

test('auto All On Red direct triggerCoinFlip emits deterministic result once', () => {
  const { room, roomEvents, io } = setupRoom({ roomCode: 'RIR-AOR-3', manualCoinFlip: false });

  const originalRandom = Math.random;
  try {
    Math.random = () => 0.9;
    triggerCoinFlip(room, io, 'w');
    triggerCoinFlip(room, io, 'w');
  } finally {
    Math.random = originalRandom;
  }

  assert.deepEqual(room.mutatorState.coinFlipResult, { result: 'tails', moveCount: room.mutatorState.moveCount });
  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.equal(roomEvents.filter((e) => e.name === 'coinFlip').length, 1);
  assert.equal(roomEvents.filter((e) => e.name === 'coinFlipResult').length, 0);
});

test('All On Red triggerCoinFlip is suppressed while Risk It Rook flip phase is unresolved', () => {
  const { room, whiteSocket, roomEvents, io } = setupRoom({ roomCode: 'RIR-AOR-4', manualCoinFlip: true });
  whiteSocket.trigger('selectMutator', { ruleId: 'risk_it_rook' });
  assert.ok(room._riskItRookPending);
  triggerCoinFlip(room, io, 'w');
  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.equal(roomEvents.filter((e) => e.name === 'coinFlipPrompt').length, 0);
});
