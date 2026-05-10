const test = require('node:test');
const assert = require('node:assert/strict');

const { Chess } = require('chess.js');
const { GameManager, GameRoom } = require('../gameManager');
const { RULES } = require('../mutators/mutatorDefs');
const { createMutatorHandlers } = require('../handlers/mutatorHandler');
const { validateRoomIntegrity } = require('../utils/roomIntegrity');
const turnClock = require('../utils/turnClock');
const { createIoRecorder, createRegisteredSocket } = require('./helpers/moveHandlerTestHelpers');

const roomsToCleanup = new Set();

function getRule(id) {
  const rule = RULES.find((r) => r.id === id);
  assert.ok(rule, `expected rule ${id} to exist`);
  return rule;
}

function countRooks(room) {
  const board = room.chess.board();
  const squares = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === 'r') squares.push({ color: p.color, square: String.fromCharCode(97 + c) + (8 - r) });
    }
  }
  return squares;
}

function setupRoom({ roomCode, fen, manualCoinFlip, pits = [] }) {
  const gameManager = new GameManager();
  const room = new GameRoom(roomCode);
  room.addPlayer({ name: 'White', color: 'w', socketId: 'sock-w', isBot: false });
  room.addPlayer({ name: 'Black', color: 'b', socketId: 'sock-b', isBot: false });
  room.startGame();
  room.chess.load(fen);
  room.manualCoinFlip = manualCoinFlip;
  room.mutatorState.boardModifiers.bottomlessPits = pits.map((square) => ({ square }));

  roomsToCleanup.add(room);
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

  return { room, whiteSocket, blackSocket, roomEvents };
}

function beginRiskItRook(room, whiteSocket) {
  room.mutatorState.pendingChoice = { chooser: 'w', options: [getRule('risk_it_rook')] };
  whiteSocket.trigger('selectMutator', { ruleId: 'risk_it_rook' });
}

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});

test('risk it rook baseline without pits places chooser and opponent rooks deterministically in manual flow', () => {
  const { room, whiteSocket, blackSocket, roomEvents } = setupRoom({
    roomCode: 'RBP-BASE-1',
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    manualCoinFlip: true,
  });
  beginRiskItRook(room, whiteSocket);

  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    whiteSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
    blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
    blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
  } finally {
    Math.random = originalRandom;
  }

  const update = roomEvents.find((e) => e.name === 'mutatorBoardUpdate');
  assert.ok(update);
  assert.equal(update.payload.riskItRookFlip.chooserFlip, 'heads');
  assert.equal(update.payload.riskItRookFlip.opponentFlip1, 'heads');
  assert.equal(update.payload.riskItRookFlip.opponentFlip2, 'heads');
  assert.equal(update.payload.riskItRookFlip.chooserSquare, 'a1');
  assert.equal(update.payload.riskItRookFlip.opponentSquare, 'a2');
  assert.deepEqual(room.chess.get('a1'), { type: 'r', color: 'w' });
  assert.deepEqual(room.chess.get('a2'), { type: 'r', color: 'b' });
  assert.equal(countRooks(room).length, 2);
  assert.equal(room._riskItRookPending, undefined);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
});

test('manual flow with bottomless pit destroys spawned rooks on pit squares and keeps pit persistent', () => {
  const { room, whiteSocket, blackSocket, roomEvents } = setupRoom({
    roomCode: 'RBP-MAN-1',
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    manualCoinFlip: true,
    pits: ['a1'],
  });
  beginRiskItRook(room, whiteSocket);

  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    whiteSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
    blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
    blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
  } finally {
    Math.random = originalRandom;
  }

  const update = roomEvents.find((e) => e.name === 'mutatorBoardUpdate');
  assert.ok(update);
  assert.equal(update.payload.riskItRookFlip.chooserSquare, 'a1');
  assert.equal(update.payload.riskItRookFlip.opponentSquare, 'a1');
  assert.equal(room.chess.get('a1'), undefined);
  assert.equal(countRooks(room).length, 0);
  assert.deepEqual(room.mutatorState.boardModifiers.bottomlessPits.map((p) => p.square), ['a1']);
  assert.equal(room._riskItRookPending, undefined);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.equal(room.status, 'active');
  assert.equal(roomEvents.some((e) => e.name === 'gameEnded'), false);

  const lateFen = room.chess.fen();
  const updatesBefore = roomEvents.filter((e) => e.name === 'mutatorBoardUpdate').length;
  blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
  assert.equal(room.chess.fen(), lateFen);
  assert.equal(roomEvents.filter((e) => e.name === 'mutatorBoardUpdate').length, updatesBefore);
});

test('auto flow with bottomless pit resolves immediately and does not create pending manual state', () => {
  const { room, whiteSocket, roomEvents } = setupRoom({
    roomCode: 'RBP-AUTO-1',
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    manualCoinFlip: false,
    pits: ['a1'],
  });

  room.mutatorState.pendingChoice = { chooser: 'w', options: [getRule('risk_it_rook')] };
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    whiteSocket.trigger('selectMutator', { ruleId: 'risk_it_rook' });
  } finally {
    Math.random = originalRandom;
  }

  const activated = roomEvents.find((e) => e.name === 'mutatorActivated' && e.payload.rule.id === 'risk_it_rook');
  assert.ok(activated);
  assert.equal(activated.payload.riskItRookFlip.chooserSquare, 'a1');
  assert.equal(activated.payload.riskItRookFlip.opponentSquare, 'a1');
  assert.equal(room.chess.get('a1'), undefined);
  assert.equal(room._riskItRookPending, undefined);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.equal(roomEvents.some((e) => e.name === 'riskItRookFlipPrompt'), false);
  assert.equal(room.status, 'active');
});

test('board integrity remains valid after risk it rook + bottomless pit resolution', () => {
  const { room, whiteSocket, blackSocket } = setupRoom({
    roomCode: 'RBP-INT-1',
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    manualCoinFlip: true,
    pits: ['a1'],
  });
  beginRiskItRook(room, whiteSocket);

  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    whiteSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
    blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
    blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
  } finally {
    Math.random = originalRandom;
  }

  assert.doesNotThrow(() => validateRoomIntegrity(room, 'test:risk-it-rook-bottomless-pit'));
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
  assert.deepEqual(room.chess.get('e1'), { type: 'k', color: 'w' });
  assert.deepEqual(room.chess.get('e8'), { type: 'k', color: 'b' });
  assert.equal(countRooks(room).length, 0);
  assert.deepEqual(room.mutatorState.boardModifiers.bottomlessPits.map((p) => p.square), ['a1']);
});
