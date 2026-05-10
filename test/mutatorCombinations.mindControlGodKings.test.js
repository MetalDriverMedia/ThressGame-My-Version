const test = require('node:test');
const assert = require('node:assert/strict');

const { Chess } = require('chess.js');
const { GameManager, GameRoom } = require('../gameManager');
const { RULES } = require('../mutators/mutatorDefs');
const { createMutatorHandlers } = require('../handlers/mutatorHandler');
const { getEffectiveLegalMoves } = require('../mutators/legalMoveEngine');
const { handleMove } = require('../handlers/moveHandler');
const { validateRoomIntegrity } = require('../utils/roomIntegrity');
const turnClock = require('../utils/turnClock');
const { createIoRecorder, createRegisteredSocket, createSocket } = require('./helpers/moveHandlerTestHelpers');

const roomsToCleanup = new Set();

function getRule(id) {
  const rule = RULES.find((r) => r.id === id);
  assert.ok(rule, `expected rule ${id} to exist`);
  return rule;
}

function setupRoom({ roomCode, fen }) {
  const gameManager = new GameManager();
  const room = new GameRoom(roomCode);
  room.addPlayer({ name: 'White', color: 'w', socketId: 'sock-w', isBot: false });
  room.addPlayer({ name: 'Black', color: 'b', socketId: 'sock-b', isBot: false });
  room.startGame();
  room.chess.load(fen);

  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);
  gameManager.setSocketRoom('sock-b', room.roomCode);

  const whiteSocket = createRegisteredSocket('sock-w');
  const blackSocket = createRegisteredSocket('sock-b');
  const moveSocketWhite = createSocket('sock-w');
  const moveSocketBlack = createSocket('sock-b');
  const { io, roomEvents } = createIoRecorder();

  io.sockets.sockets.set('sock-w', whiteSocket);
  io.sockets.sockets.set('sock-b', blackSocket);

  const handlers = createMutatorHandlers({ handleMove: async () => {}, scheduleBotMove: () => {}, generateBotTarget: () => null });
  handlers.registerSocketHandlers(whiteSocket, io, gameManager);
  handlers.registerSocketHandlers(blackSocket, io, gameManager);

  roomsToCleanup.add(room);
  return { room, gameManager, io, roomEvents, whiteSocket, blackSocket, moveSocketWhite, moveSocketBlack };
}

function setPendingAction(room, ruleId, forPlayer = 'w') {
  const rule = getRule(ruleId);
  room.mutatorState.pendingAction = { ruleId, actionType: rule.choiceType, forPlayer, rule };
}

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});

test('baseline: mind control converts enemy non-king and preserves king state/integrity', () => {
  const { room, whiteSocket, blackSocket } = setupRoom({ roomCode: 'MCGK-1', fen: '4k3/4n3/8/8/8/8/4B3/4K3 w - - 0 1' });
  setPendingAction(room, 'mind_control', 'w');

  whiteSocket.trigger('mutatorActionResponse', { targets: 'e7' });
  blackSocket.trigger('mutatorActionResponse', { targets: 'e2' });

  assert.deepEqual(room.chess.get('e7'), { type: 'n', color: 'w' });
  assert.deepEqual(room.chess.get('e2'), { type: 'b', color: 'b' });
  assert.deepEqual(room.chess.get('e1'), { type: 'k', color: 'w' });
  assert.deepEqual(room.chess.get('e8'), { type: 'k', color: 'b' });
  assert.equal(room.mutatorState.pendingAction, null);
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
  assert.equal(validateRoomIntegrity(room, 'mc-baseline'), true);
});

test('baseline: mind control rejects empty, own, and malformed targets without board changes', () => {
  const { room, whiteSocket } = setupRoom({ roomCode: 'MCGK-2', fen: '4k3/4n3/8/8/8/8/4B3/4K3 w - - 0 1' });
  const initialFen = room.chess.fen();
  setPendingAction(room, 'mind_control', 'w');

  whiteSocket.trigger('mutatorActionResponse', { targets: 'a3' });
  let lastPrompt = whiteSocket.emitted.filter((e) => e.name === 'mutatorAction').at(-1);
  assert.equal(lastPrompt.payload.prompt, 'You must select an enemy piece!');
  assert.equal(room.chess.fen(), initialFen);
  assert.ok(room.mutatorState.pendingAction);

  whiteSocket.trigger('mutatorActionResponse', { targets: 'e2' });
  lastPrompt = whiteSocket.emitted.filter((e) => e.name === 'mutatorAction').at(-1);
  assert.equal(lastPrompt.payload.prompt, 'You must select an enemy piece!');
  assert.equal(room.chess.fen(), initialFen);
  assert.ok(room.mutatorState.pendingAction);

  whiteSocket.trigger('mutatorActionResponse', { targets: 'z9' });
  assert.equal(room.chess.fen(), initialFen);
  assert.ok(room.mutatorState.pendingAction);
});

test('baseline: mind control rejects king targets', () => {
  const { room, whiteSocket } = setupRoom({ roomCode: 'MCGK-3', fen: '4k3/4n3/8/8/8/8/4B3/4K3 w - - 0 1' });
  const initialFen = room.chess.fen();
  setPendingAction(room, 'mind_control', 'w');

  whiteSocket.trigger('mutatorActionResponse', { targets: 'e8' });

  const prompt = whiteSocket.emitted.filter((e) => e.name === 'mutatorAction').at(-1);
  assert.equal(prompt.payload.prompt, 'You cannot target the King! Choose another piece.');
  assert.equal(room.chess.fen(), initialFen);
  assert.deepEqual(room.chess.get('e8'), { type: 'k', color: 'b' });
  assert.ok(room.mutatorState.pendingAction);
});

test('baseline: god kings alone removes king-capture moves while keeping legal generation and kings intact', () => {
  const { room } = setupRoom({ roomCode: 'MCGK-4', fen: '4k3/8/8/8/8/4q3/8/4K3 b - - 0 1' });
  room.mutatorState.activeRules.push({ rule: getRule('god_kings'), expiresAfterTurn: room.fullTurnCount + 2, chooser: 'b' });

  const noMutatorRoom = { ...room, mutatorState: { ...room.mutatorState, activeRules: [] } };
  const baselineMoves = getEffectiveLegalMoves(noMutatorRoom, 'b');
  const godKingsMoves = getEffectiveLegalMoves(room, 'b');

  assert.ok(baselineMoves.some((m) => m.from === 'e3' && m.to === 'e1'));
  assert.equal(godKingsMoves.some((m) => m.from === 'e3' && m.to === 'e1'), false);
  assert.ok(godKingsMoves.length > 0);
  assert.deepEqual(room.chess.get('e1'), { type: 'k', color: 'w' });
  assert.deepEqual(room.chess.get('e8'), { type: 'k', color: 'b' });
  assert.equal(validateRoomIntegrity(room, 'god-kings-alone'), true);
});

test('combination: mind control + god kings still rejects enemy king target', () => {
  const { room, whiteSocket } = setupRoom({ roomCode: 'MCGK-5', fen: '4k3/4n3/8/8/8/8/4B3/4K3 w - - 0 1' });
  room.mutatorState.activeRules.push({ rule: getRule('god_kings'), expiresAfterTurn: room.fullTurnCount + 2, chooser: 'w' });
  setPendingAction(room, 'mind_control', 'w');

  whiteSocket.trigger('mutatorActionResponse', { targets: 'e8' });

  assert.deepEqual(room.chess.get('e8'), { type: 'k', color: 'b' });
  assert.equal(Boolean(room.gameEnded), false);
  assert.equal(room.status, 'active');
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.ok(room.mutatorState.pendingAction);
  assert.equal(validateRoomIntegrity(room, 'combo-king-reject'), true);
});

test('combination: mind control + god kings converts non-king and converted piece is movable by new owner on their turn', async () => {
  const { room, whiteSocket, blackSocket, io, gameManager, moveSocketWhite, moveSocketBlack } = setupRoom({ roomCode: 'MCGK-6', fen: '4k3/4n3/8/8/8/8/4B3/4K2R w - - 0 1' });
  room.mutatorState.activeRules.push({ rule: getRule('god_kings'), expiresAfterTurn: room.fullTurnCount + 2, chooser: 'w' });
  setPendingAction(room, 'mind_control', 'w');

  whiteSocket.trigger('mutatorActionResponse', { targets: 'e7' });
  blackSocket.trigger('mutatorActionResponse', { targets: 'e2' });

  assert.deepEqual(room.chess.get('e7'), { type: 'n', color: 'w' });
  assert.equal(room.mutatorState.activeRules.some((ar) => ar.rule.id === 'god_kings'), true);

  await handleMove(io, moveSocketBlack, gameManager, { from: 'e8', to: 'f8' });
  await handleMove(io, moveSocketWhite, gameManager, { from: 'e7', to: 'f5' });

  assert.deepEqual(room.chess.get('f5'), { type: 'n', color: 'w' });
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.equal(room.mutatorState.pendingChoice, null);
  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
});

test('combination: converted piece near king does not corrupt check/game state or fen validity', () => {
  const { room, whiteSocket, blackSocket } = setupRoom({ roomCode: 'MCGK-7', fen: '4k3/8/8/8/8/4r3/4N3/4K3 w - - 0 1' });
  room.mutatorState.activeRules.push({ rule: getRule('god_kings'), expiresAfterTurn: room.fullTurnCount + 2, chooser: 'w' });
  setPendingAction(room, 'mind_control', 'w');

  whiteSocket.trigger('mutatorActionResponse', { targets: 'e3' });
  blackSocket.trigger('mutatorActionResponse', { targets: 'e2' });

  assert.deepEqual(room.chess.get('e3'), { type: 'r', color: 'w' });
  assert.equal(Boolean(room.gameEnded), false);
  assert.equal(room.status, 'active');
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
  assert.equal(validateRoomIntegrity(room, 'combo-check-sanity'), true);
});

test('combination: legal moves include converted piece for new owner and old owner cannot move it through handleMove', async () => {
  const { room, whiteSocket, blackSocket, io, gameManager, moveSocketBlack } = setupRoom({ roomCode: 'MCGK-8', fen: '4k3/4n3/8/8/8/8/4B3/4K3 w - - 0 1' });
  room.mutatorState.activeRules.push({ rule: getRule('god_kings'), expiresAfterTurn: room.fullTurnCount + 2, chooser: 'w' });
  setPendingAction(room, 'mind_control', 'w');

  whiteSocket.trigger('mutatorActionResponse', { targets: 'e7' });
  blackSocket.trigger('mutatorActionResponse', { targets: 'e2' });

  const whiteMoves = getEffectiveLegalMoves(room, 'w');
  assert.ok(whiteMoves.some((m) => m.from === 'e7'));

  await handleMove(io, moveSocketBlack, gameManager, { from: 'e7', to: 'f5' });
  const rejection = moveSocketBlack.emitted.find((e) => e.name === 'moveRejected');
  assert.ok(rejection);
});

test('combination: post-resolution integrity includes two kings, stable colors, and cleared pending state', () => {
  const { room, whiteSocket, blackSocket } = setupRoom({ roomCode: 'MCGK-9', fen: '4k3/4n3/8/8/8/8/4B3/4K3 w - - 0 1' });
  room.mutatorState.activeRules.push({ rule: getRule('god_kings'), expiresAfterTurn: room.fullTurnCount + 2, chooser: 'w' });
  setPendingAction(room, 'mind_control', 'w');

  whiteSocket.trigger('mutatorActionResponse', { targets: 'e7' });
  blackSocket.trigger('mutatorActionResponse', { targets: 'e2' });

  const board = room.chess.fen().split(' ')[0];
  assert.equal((board.match(/K/g) || []).length, 1);
  assert.equal((board.match(/k/g) || []).length, 1);
  assert.deepEqual(room.chess.get('e1'), { type: 'k', color: 'w' });
  assert.deepEqual(room.chess.get('e8'), { type: 'k', color: 'b' });
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.equal(room.mutatorState.pendingChoice, null);
  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
  assert.equal(validateRoomIntegrity(room, 'combo-final-sanity'), true);
});
