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

function setupRoom({ roomCode, fen, manualCoinFlip, mines = [] }) {
  const gameManager = new GameManager();
  const room = new GameRoom(roomCode);
  room.addPlayer({ name: 'White', color: 'w', socketId: 'sock-w', isBot: false });
  room.addPlayer({ name: 'Black', color: 'b', socketId: 'sock-b', isBot: false });
  room.startGame();
  room.chess.load(fen);
  room.manualCoinFlip = manualCoinFlip;
  room.mutatorState.boardModifiers.mines = mines.map((square) => ({ square }));
  if (mines.length > 0) {
    room.mutatorState.activeRules.push({ rule: getRule('minefield'), turnsLeft: -1, placedBy: 'w' });
  }

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

function getMineSquares(room) {
  return (room.mutatorState.boardModifiers.mines || []).map((m) => m.square);
}

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});

test('baseline manual risk it rook without mines places rooks on a1/a2 and clears pending state', () => {
  const { room, whiteSocket, blackSocket, roomEvents } = setupRoom({
    roomCode: 'RIM-BASE-1',
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
  assert.equal(update.payload.riskItRookFlip.chooserSquare, 'a1');
  assert.equal(update.payload.riskItRookFlip.opponentSquare, 'a2');
  assert.deepEqual(room.chess.get('a1'), { type: 'r', color: 'w' });
  assert.deepEqual(room.chess.get('a2'), { type: 'r', color: 'b' });
  assert.equal(countRooks(room).length, 2);
  assert.deepEqual(getMineSquares(room), []);
  assert.equal(room._riskItRookPending, undefined);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
});

test('manual risk it rook + minefield consumes chooser mine and allows opponent reuse of a1', () => {
  const { room, whiteSocket, blackSocket, roomEvents } = setupRoom({
    roomCode: 'RIM-MAN-1',
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    manualCoinFlip: true,
    mines: ['a1'],
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
  assert.equal(room.chess.get('a2'), undefined);
  assert.deepEqual(room.chess.get('a1'), { type: 'r', color: 'b' });
  assert.deepEqual(countRooks(room), [{ color: 'b', square: 'a1' }]);
  assert.deepEqual(getMineSquares(room), []);
  assert.equal(room.status, 'active');
  assert.equal(roomEvents.some((e) => e.name === 'gameEnded'), false);
  assert.equal(room._riskItRookPending, undefined);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.equal(room.mutatorState.activeRules.some((r) => r.rule.id === 'minefield'), false);
});

test('manual risk it rook + minefield consumes opponent mine while chooser rook survives', () => {
  const { room, whiteSocket, blackSocket, roomEvents } = setupRoom({
    roomCode: 'RIM-MAN-2',
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    manualCoinFlip: true,
    mines: ['a2'],
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
  assert.equal(update.payload.riskItRookFlip.opponentSquare, 'a2');
  assert.deepEqual(room.chess.get('a1'), { type: 'r', color: 'w' });
  assert.equal(room.chess.get('a2'), undefined);
  assert.deepEqual(countRooks(room), [{ color: 'w', square: 'a1' }]);
  assert.deepEqual(getMineSquares(room), []);
  assert.equal(roomEvents.some((e) => e.name === 'gameEnded'), false);
  assert.equal(room.status, 'active');
  assert.equal(room._riskItRookPending, undefined);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
});

test('auto risk it rook + minefield resolves immediately with no manual prompts and no pending state', () => {
  const { room, whiteSocket, roomEvents } = setupRoom({
    roomCode: 'RIM-AUTO-1',
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    manualCoinFlip: false,
    mines: ['a1'],
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
  assert.deepEqual(room.chess.get('a1'), { type: 'r', color: 'b' });
  assert.equal(roomEvents.some((e) => e.name === 'riskItRookFlipPrompt'), false);
  assert.deepEqual(getMineSquares(room), []);
  assert.equal(room.mutatorState.activeRules.some((r) => r.rule.id === 'minefield'), false);
  assert.equal(room._riskItRookPending, undefined);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.equal(room.status, 'active');
  assert.equal(roomEvents.some((e) => e.name === 'gameEnded'), false);
});

test('risk it rook + minefield keeps kings alive, board loadable, and ignores late duplicate choices', () => {
  const { room, whiteSocket, blackSocket, roomEvents } = setupRoom({
    roomCode: 'RIM-INT-1',
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    manualCoinFlip: true,
    mines: ['a1'],
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

  assert.doesNotThrow(() => validateRoomIntegrity(room, 'test:risk-it-rook-minefield'));
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
  assert.deepEqual(room.chess.get('e1'), { type: 'k', color: 'w' });
  assert.deepEqual(room.chess.get('e8'), { type: 'k', color: 'b' });
  assert.equal(roomEvents.some((e) => e.name === 'gameEnded' && e.payload?.reason === 'king-destroyed'), false);
  assert.deepEqual(countRooks(room), [{ color: 'b', square: 'a1' }]);
  assert.deepEqual(getMineSquares(room), []);

  const lateFen = room.chess.fen();
  const updatesBefore = roomEvents.filter((e) => e.name === 'mutatorBoardUpdate').length;
  blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
  assert.equal(room.chess.fen(), lateFen);
  assert.equal(roomEvents.filter((e) => e.name === 'mutatorBoardUpdate').length, updatesBefore);
  assert.equal(room._riskItRookPending, undefined);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
});
