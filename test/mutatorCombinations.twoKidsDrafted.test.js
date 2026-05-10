const test = require('node:test');
const assert = require('node:assert/strict');

const { Chess } = require('chess.js');
const { GameManager, GameRoom } = require('../gameManager');
const { RULES } = require('../mutators/mutatorDefs');
const { createMutatorHandlers } = require('../handlers/mutatorHandler');
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

function createRoom({ roomCode, fen }) {
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

function setPending(room, ruleId, forPlayer = 'w') {
  const rule = getRule(ruleId);
  room.mutatorState.pendingAction = { ruleId, actionType: rule.choiceType, forPlayer, rule };
}

function applyTwoKids(room, whiteSocket, pawnA = 'a2', pawnB = 'b2', spawnSquare = 'c3') {
  setPending(room, 'two_kids_in_a_trenchcoat', 'w');
  whiteSocket.trigger('mutatorActionResponse', { targets: pawnA });
  whiteSocket.trigger('mutatorActionResponse', { targets: pawnB });
  whiteSocket.trigger('mutatorActionResponse', { targets: spawnSquare });
}

function applyDrafted(room, whiteSocket, blackSocket, whiteTarget = 'c3', blackTarget = 'g7') {
  setPending(room, 'drafted_for_battle');
  whiteSocket.trigger('mutatorActionResponse', { targets: whiteTarget });
  blackSocket.trigger('mutatorActionResponse', { targets: blackTarget });
}

function assertKings(room) {
  const pieces = room.chess.board().flat().filter(Boolean);
  assert.equal(pieces.filter((p) => p.type === 'k' && p.color === 'w').length, 1);
  assert.equal(pieces.filter((p) => p.type === 'k' && p.color === 'b').length, 1);
}

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});

test('baseline two kids creates bishop, sacrifices pawns, and records same-turn lock', () => {
  const { room, whiteSocket } = createRoom({ roomCode: 'TKD-1', fen: '4k3/6n1/8/8/8/8/PP6/4K1B1 w - - 0 1' });
  applyTwoKids(room, whiteSocket);

  assert.equal(room.chess.get('a2'), undefined);
  assert.equal(room.chess.get('b2'), undefined);
  assert.deepEqual(room.chess.get('c3'), { type: 'b', color: 'w' });
  assert.deepEqual(room.mutatorState.boardModifiers.lockedSquares.map((ls) => ls.square), ['c3']);
});

test('baseline drafted swaps selected bishop/knight with both kings', () => {
  const { room, whiteSocket, blackSocket } = createRoom({ roomCode: 'TKD-2', fen: '4k3/6n1/8/8/8/8/6B1/4K3 w - - 0 1' });
  applyDrafted(room, whiteSocket, blackSocket, 'g2', 'g7');

  assert.deepEqual(room.chess.get('g2'), { type: 'k', color: 'w' });
  assert.deepEqual(room.chess.get('e1'), { type: 'b', color: 'w' });
  assert.deepEqual(room.chess.get('g7'), { type: 'k', color: 'b' });
  assert.deepEqual(room.chess.get('e8'), { type: 'n', color: 'b' });
});

test('two kids first then drafted can select spawned bishop and keeps coherent pending/integrity state', () => {
  const { room, whiteSocket, blackSocket } = createRoom({ roomCode: 'TKD-3', fen: '4k3/6n1/8/8/8/8/PP6/4K1B1 w - - 0 1' });
  applyTwoKids(room, whiteSocket);
  applyDrafted(room, whiteSocket, blackSocket, 'c3', 'g7');

  assert.deepEqual(room.chess.get('c3'), { type: 'k', color: 'w' });
  assert.deepEqual(room.chess.get('e1'), { type: 'b', color: 'w' });
  assert.deepEqual(room.chess.get('g7'), { type: 'k', color: 'b' });
  assert.deepEqual(room.chess.get('e8'), { type: 'n', color: 'b' });
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.equal(validateRoomIntegrity(room, 'test:tkd-two-kids-then-drafted'), true);
});

test('drafted first then two kids still resolves correctly after king relocation', () => {
  const { room, whiteSocket, blackSocket } = createRoom({ roomCode: 'TKD-4', fen: '4k1n1/8/8/8/8/8/PP6/4K1B1 w - - 0 1' });
  applyDrafted(room, whiteSocket, blackSocket, 'g1', 'g8');
  applyTwoKids(room, whiteSocket, 'a2', 'b2', 'c3');

  assert.deepEqual(room.chess.get('g1'), { type: 'k', color: 'w' });
  assert.deepEqual(room.chess.get('e1'), { type: 'b', color: 'w' });
  assert.deepEqual(room.chess.get('g8'), { type: 'k', color: 'b' });
  assert.deepEqual(room.chess.get('e8'), { type: 'n', color: 'b' });
  assert.deepEqual(room.chess.get('c3'), { type: 'b', color: 'w' });
  assert.deepEqual(room.mutatorState.boardModifiers.lockedSquares.map((ls) => ls.square), ['c3']);
});

test('drafted swap of spawned bishop cleans stale lock on original square', async () => {
  const { room, gameManager, io, whiteSocket, blackSocket, moveSocketWhite } = createRoom({ roomCode: 'TKD-5', fen: '4k3/6n1/8/8/8/8/PP6/4K1B1 w - - 0 1' });
  applyTwoKids(room, whiteSocket);
  applyDrafted(room, whiteSocket, blackSocket, 'c3', 'g7');

  await handleMove(io, moveSocketWhite, gameManager, { from: 'c3', to: 'c4' });
  const reject = moveSocketWhite.emitted.find((e) => e.name === 'moveRejected' && e.payload?.message === "That piece can't move on the same turn it was placed.");
  assert.equal(reject, undefined);
  assert.deepEqual(room.mutatorState.boardModifiers.lockedSquares, []);
});

test('lockedSquares lifecycle clears after a later successful move, then previously locked square piece can move', async () => {
  const { room, gameManager, io, whiteSocket, blackSocket, moveSocketWhite, moveSocketBlack } = createRoom({ roomCode: 'TKD-6', fen: '4k3/6n1/8/8/8/8/PP6/4K1BR w - - 0 1' });
  applyTwoKids(room, whiteSocket);
  applyDrafted(room, whiteSocket, blackSocket, 'c3', 'g7');

  await handleMove(io, moveSocketWhite, gameManager, { from: 'h1', to: 'h2' });
  assert.deepEqual(room.mutatorState.boardModifiers.lockedSquares, []);
  await handleMove(io, moveSocketBlack, gameManager, { from: 'e8', to: 'f6' });
  await handleMove(io, moveSocketWhite, gameManager, { from: 'c3', to: 'c4' });
  const lastReject = moveSocketWhite.emitted.filter((e) => e.name === 'moveRejected').at(-1);
  assert.notEqual(lastReject?.payload?.message, "That piece can't move on the same turn it was placed.");
});

test('no false king destruction, valid fen, two kings, activeRules/boardModifiers coherent', () => {
  const { room, roomEvents, whiteSocket, blackSocket } = createRoom({ roomCode: 'TKD-7', fen: '4k3/6n1/8/8/8/8/PP6/4K1B1 w - - 0 1' });
  room.mutatorState.activeRules.push({ rule: getRule('drafted_for_battle'), turnsLeft: -1, placedBy: 'w' });
  applyTwoKids(room, whiteSocket);
  applyDrafted(room, whiteSocket, blackSocket, 'c3', 'g7');

  assert.equal(roomEvents.some((e) => e.name === 'gameEnded' && e.payload?.reason === 'king-destroyed'), false);
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
  assertKings(room);
  assert.equal(Array.isArray(room.mutatorState.activeRules), true);
  assert.equal(Array.isArray(room.mutatorState.boardModifiers.lockedSquares), true);
  assert.equal(validateRoomIntegrity(room, 'test:tkd-final-sanilty'), true);
});
