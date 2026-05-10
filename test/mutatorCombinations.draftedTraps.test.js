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

function applyDrafted(room, whiteSocket, blackSocket, whiteTarget = 'g2', blackTarget = 'g7') {
  setPending(room, 'drafted_for_battle');
  whiteSocket.trigger('mutatorActionResponse', { targets: whiteTarget });
  blackSocket.trigger('mutatorActionResponse', { targets: blackTarget });
}

function assertKingsPresent(room) {
  const pieces = room.chess.board().flat().filter(Boolean);
  assert.equal(pieces.filter((p) => p.type === 'k' && p.color === 'w').length, 1);
  assert.equal(pieces.filter((p) => p.type === 'k' && p.color === 'b').length, 1);
}

function assertFinalSanity(room, label) {
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
  assertKingsPresent(room);
  assert.equal(validateRoomIntegrity(room, label), true);
}

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});

test('baseline drafted for battle swap with bishop/knight targets', () => {
  const { room, whiteSocket, blackSocket } = createRoom({ roomCode: 'DT-1', fen: '4k3/6n1/8/8/8/8/6B1/4K3 w - - 0 1' });
  applyDrafted(room, whiteSocket, blackSocket);
  assert.deepEqual(room.chess.get('g2'), { type: 'k', color: 'w' });
  assert.deepEqual(room.chess.get('e1'), { type: 'b', color: 'w' });
  assert.deepEqual(room.chess.get('g7'), { type: 'k', color: 'b' });
  assert.deepEqual(room.chess.get('e8'), { type: 'n', color: 'b' });
  assertFinalSanity(room, 'test:drafted-baseline');
});

test('baseline bottomless pit destroys non-king and pit persists', async () => {
  const { room, gameManager, io, moveSocketWhite } = createRoom({ roomCode: 'DT-2', fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1' });
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'a2' }];
  await handleMove(io, moveSocketWhite, gameManager, { from: 'a1', to: 'a2' });
  assert.equal(room.chess.get('a2'), undefined);
  assert.deepEqual(room.mutatorState.boardModifiers.bottomlessPits, [{ square: 'a2' }]);
});

test('baseline minefield destroys non-king and mine is consumed', async () => {
  const { room, gameManager, io, moveSocketWhite } = createRoom({ roomCode: 'DT-3', fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1' });
  room.mutatorState.boardModifiers.mines = [{ square: 'a2' }];
  room.mutatorState.activeRules.push({ rule: getRule('minefield'), turnsLeft: -1, placedBy: 'w' });
  await handleMove(io, moveSocketWhite, gameManager, { from: 'a1', to: 'a2' });
  assert.equal(room.chess.get('a2'), undefined);
  assert.deepEqual(room.mutatorState.boardModifiers.mines, []);
});

test('drafted swap with selected piece starting on bottomless pit square', () => {
  const { room, roomEvents, whiteSocket, blackSocket } = createRoom({ roomCode: 'DT-4', fen: '4k3/6n1/8/8/8/8/6B1/4K3 w - - 0 1' });
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'g2' }];
  applyDrafted(room, whiteSocket, blackSocket);
  assert.equal(room.chess.get('g2'), undefined);
  assert.deepEqual(room.chess.get('e1'), { type: 'b', color: 'w' });
  assert.deepEqual(room.mutatorState.boardModifiers.bottomlessPits, [{ square: 'g2' }]);
  assert.equal(roomEvents.some((e) => e.name === 'gameEnded' && e.payload?.reason === 'king-destroyed'), true);
  assert.equal(room.status, 'ended');
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.equal(validateRoomIntegrity(room, 'test:drafted-pit-origin'), true);
});

test('drafted swap where selected piece lands on bottomless pit square', () => {
  const { room, whiteSocket, blackSocket } = createRoom({ roomCode: 'DT-5', fen: '4k3/6n1/8/8/8/8/6B1/4K3 w - - 0 1' });
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'e1' }];
  applyDrafted(room, whiteSocket, blackSocket);
  assert.equal(room.chess.get('e1'), undefined);
  assert.deepEqual(room.chess.get('g2'), { type: 'k', color: 'w' });
  assert.deepEqual(room.mutatorState.boardModifiers.bottomlessPits, [{ square: 'e1' }]);
  assertFinalSanity(room, 'test:drafted-pit-destination');
});

test('drafted swap with selected piece starting on minefield square', () => {
  const { room, whiteSocket, blackSocket } = createRoom({ roomCode: 'DT-6', fen: '4k3/6n1/8/8/8/8/6B1/4K3 w - - 0 1' });
  room.mutatorState.boardModifiers.mines = [{ square: 'g2' }];
  room.mutatorState.activeRules.push({ rule: getRule('minefield'), turnsLeft: -1, placedBy: 'w' });
  applyDrafted(room, whiteSocket, blackSocket);
  assert.deepEqual(room.chess.get('g2'), { type: 'k', color: 'w' });
  assert.deepEqual(room.chess.get('e1'), { type: 'b', color: 'w' });
  assert.deepEqual(room.mutatorState.boardModifiers.mines, []);
  assert.equal(room.mutatorState.activeRules.some((r) => r.rule.id === 'minefield'), false);
  assertFinalSanity(room, 'test:drafted-mine-origin');
});

test('drafted swap where selected piece lands on minefield square', () => {
  const { room, whiteSocket, blackSocket } = createRoom({ roomCode: 'DT-7', fen: '4k3/6n1/8/8/8/8/6B1/4K3 w - - 0 1' });
  room.mutatorState.boardModifiers.mines = [{ square: 'e1' }];
  room.mutatorState.activeRules.push({ rule: getRule('minefield'), turnsLeft: -1, placedBy: 'w' });
  applyDrafted(room, whiteSocket, blackSocket);
  assert.equal(room.chess.get('e1'), undefined);
  assert.deepEqual(room.chess.get('g2'), { type: 'k', color: 'w' });
  assert.deepEqual(room.mutatorState.boardModifiers.mines, []);
  assert.equal(room.mutatorState.activeRules.some((r) => r.rule.id === 'minefield'), false);
  assertFinalSanity(room, 'test:drafted-mine-destination');
});

test('trap lifecycle in drafted interactions: pit persists, mine consumes on destination trigger', () => {
  const { room, whiteSocket, blackSocket } = createRoom({ roomCode: 'DT-8', fen: '4k3/6n1/8/8/8/8/6B1/4K3 w - - 0 1' });
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'e1' }];
  room.mutatorState.boardModifiers.mines = [{ square: 'g7' }, { square: 'e8' }];
  room.mutatorState.activeRules.push({ rule: getRule('minefield'), turnsLeft: -1, placedBy: 'w' });

  applyDrafted(room, whiteSocket, blackSocket);

  assert.deepEqual(room.mutatorState.boardModifiers.bottomlessPits, [{ square: 'e1' }]);
  assert.deepEqual(room.mutatorState.boardModifiers.mines, []);
  assert.equal(room.mutatorState.activeRules.some((r) => r.rule.id === 'minefield'), false);
  assertFinalSanity(room, 'test:drafted-trap-lifecycle');
});

test('post-drafted state remains coherent for pending/active/locked/modifiers and room integrity', () => {
  const { room, whiteSocket, blackSocket } = createRoom({ roomCode: 'DT-9', fen: '4k3/6n1/8/8/8/8/6B1/4K3 w - - 0 1' });
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'e1' }, { square: 'h4' }];
  room.mutatorState.boardModifiers.lockedSquares = [{ square: 'a4' }];
  room.mutatorState.activeRules.push({ rule: getRule('bottomless_pit'), turnsLeft: -1, placedBy: 'b' });
  applyDrafted(room, whiteSocket, blackSocket);

  assert.equal(room.mutatorState.pendingChoice, null);
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.deepEqual(room.mutatorState.boardModifiers.lockedSquares, []);
  assert.equal(room.mutatorState.activeRules.some((r) => r.rule.id === 'bottomless_pit'), true);
  assertFinalSanity(room, 'test:drafted-traps-coherent');
});

test('living bomb marker survives drafted swap when opposite swapped piece is trap-destroyed during safeSwapSquares cleanup', () => {
  const { room, whiteSocket, blackSocket } = createRoom({ roomCode: 'DT-10', fen: '4k3/6n1/8/8/8/8/6B1/4K3 w - - 0 1' });
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'g7' }];

  setPending(room, 'living_bomb');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'g2' });

  applyDrafted(room, whiteSocket, blackSocket);

  assert.deepEqual(room.chess.get('e1'), { type: 'b', color: 'w' });
  assert.equal(room.chess.get('g7'), undefined);
  assert.equal(room.mutatorState.boardModifiers.livingBombs.length, 1);
  assert.deepEqual(room.mutatorState.boardModifiers.livingBombs[0], {
    square: 'e1',
    piece: 'b',
    color: 'w',
    expiresAtMove: room.mutatorState.activeRules.find((ar) => ar.rule.id === 'living_bomb').expiresAtMove,
  });
  assert.equal(room.status, 'ended');
  assert.equal(validateRoomIntegrity(room, 'test:drafted-living-bomb-cleanup-current-board'), true);
});

test('drafted swap resolves both trap endpoints deterministically when both landing squares are trapped', () => {
  const { room, roomEvents, whiteSocket, blackSocket } = createRoom({ roomCode: 'DT-11', fen: '4k3/6n1/8/8/8/8/6B1/4K3 w - - 0 1' });
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'e1' }];
  room.mutatorState.boardModifiers.mines = [{ square: 'g2' }];
  room.mutatorState.activeRules.push({ rule: getRule('minefield'), turnsLeft: -1, placedBy: 'w' });

  applyDrafted(room, whiteSocket, blackSocket);

  // white king lands on mine (survives, mine consumed), white bishop lands on pit (destroyed)
  assert.deepEqual(room.chess.get('g2'), { type: 'k', color: 'w' });
  assert.equal(room.chess.get('e1'), undefined);
  assert.deepEqual(room.mutatorState.boardModifiers.bottomlessPits, [{ square: 'e1' }]);
  assert.deepEqual(room.mutatorState.boardModifiers.mines, []);
  assert.equal(room.mutatorState.activeRules.some((r) => r.rule.id === 'minefield'), false);

  // black side still resolves after white side and remains coherent
  assert.deepEqual(room.chess.get('g7'), { type: 'k', color: 'b' });
  assert.deepEqual(room.chess.get('e8'), { type: 'n', color: 'b' });
  assert.equal(roomEvents.some((e) => e.name === 'gameEnded' && e.payload?.reason === 'king-destroyed'), false);
  assertFinalSanity(room, 'test:drafted-both-endpoints-trapped');
});

test('mitosis targets are culled if drafted trap cleanup destroys a targeted piece', () => {
  const { room, whiteSocket, blackSocket } = createRoom({ roomCode: 'DT-12', fen: '4k3/6n1/8/8/8/8/6B1/4K3 w - - 0 1' });
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'e1' }];

  setPending(room, 'mitosis');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'g2' });

  applyDrafted(room, whiteSocket, blackSocket);

  assert.equal(room.chess.get('e1'), undefined);
  assert.deepEqual(room.mutatorState.boardModifiers.mitosisTargets || [], []);
  assert.equal(validateRoomIntegrity(room, 'test:drafted-mitosis-cleanup'), true);
});
