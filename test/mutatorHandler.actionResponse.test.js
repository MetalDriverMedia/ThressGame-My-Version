const test = require('node:test');
const assert = require('node:assert/strict');

const { GameManager, GameRoom } = require('../gameManager');
const { createMutatorHandlers } = require('../handlers/mutatorHandler');
const turnClock = require('../utils/turnClock');
const { createIoRecorder, createRegisteredSocket } = require('./helpers/moveHandlerTestHelpers');

const roomsToCleanup = new Set();

function setupMutatorActionRoom({ roomCode = 'MACT1', whiteIsBot = false, blackIsBot = false } = {}) {
  const gameManager = new GameManager();
  const room = new GameRoom(roomCode);
  room.addPlayer({ name: 'White', color: 'w', socketId: 'sock-w', isBot: whiteIsBot });
  room.addPlayer({ name: 'Black', color: 'b', socketId: 'sock-b', isBot: blackIsBot });
  room.startGame();
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

  room.mutatorState = room.mutatorState || {};
  return { gameManager, room, whiteSocket, blackSocket, io, roomEvents };
}

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});


test('mutatorActionResponse ignores invalid payloads', () => {
  const { room, whiteSocket, roomEvents } = setupMutatorActionRoom({ roomCode: 'MACT-A' });
  room.mutatorState.pendingAction = { ruleId: 'x', actionType: 'square', forPlayer: 'w', rule: { id: 'x', name: 'X', duration: 1 } };
  const original = room.mutatorState.pendingAction;

  whiteSocket.trigger('mutatorActionResponse', null);
  whiteSocket.trigger('mutatorActionResponse', {});
  whiteSocket.trigger('mutatorActionResponse', { foo: 'bar' });

  assert.equal(roomEvents.length, 0);
  assert.equal(room.mutatorState.pendingAction, original);
});

test('mutatorActionResponse ignores unmapped socket', () => {
  const { gameManager, room, io, roomEvents } = setupMutatorActionRoom({ roomCode: 'MACT-B' });
  room.mutatorState.pendingAction = { ruleId: 'x', actionType: 'square', forPlayer: 'w', rule: { id: 'x', name: 'X', duration: 1 } };
  const ghost = createRegisteredSocket('sock-z');
  createMutatorHandlers({ handleMove: async () => {}, scheduleBotMove: () => {}, generateBotTarget: () => null })
    .registerSocketHandlers(ghost, io, gameManager);

  ghost.trigger('mutatorActionResponse', { targets: 'e4' });
  assert.equal(roomEvents.length, 0);
});

test('mutatorActionResponse ignores when room has no mutatorState', () => {
  const { room, whiteSocket, roomEvents } = setupMutatorActionRoom({ roomCode: 'MACT-C' });
  room.mutatorState = null;
  whiteSocket.trigger('mutatorActionResponse', { targets: 'e4' });
  assert.equal(roomEvents.length, 0);
});

test('mutatorActionResponse ignores when pendingAction belongs to other player', () => {
  const { room, blackSocket, roomEvents } = setupMutatorActionRoom({ roomCode: 'MACT-D' });
  room.mutatorState.pendingAction = { ruleId: 'x', actionType: 'square', forPlayer: 'w', rule: { id: 'x', name: 'X', duration: 1 } };

  blackSocket.trigger('mutatorActionResponse', { targets: 'e4' });
  assert.ok(room.mutatorState.pendingAction);
  assert.equal(roomEvents.some((e) => e.name === 'mutatorActivated'), false);
});

test('mutatorActionResponse rejects invalid square notation', () => {
  const { room, whiteSocket, roomEvents } = setupMutatorActionRoom({ roomCode: 'MACT-E' });
  room.mutatorState.pendingAction = { ruleId: 'x', actionType: 'square', forPlayer: 'w', rule: { id: 'x', name: 'X', duration: 1 } };

  whiteSocket.trigger('mutatorActionResponse', { targets: 'z9' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'bad' });

  assert.ok(room.mutatorState.pendingAction);
  assert.equal(roomEvents.some((e) => e.name === 'mutatorActivated'), false);
});

test('empty_square rejects occupied and hard-blocked squares with re-prompt', () => {
  const { room, whiteSocket, roomEvents } = setupMutatorActionRoom({ roomCode: 'MACT-F' });
  room.mutatorState.pendingAction = { ruleId: 'x', actionType: 'empty_square', forPlayer: 'w', rule: { id: 'x', name: 'X', duration: 1 } };

  whiteSocket.trigger('mutatorActionResponse', { targets: 'e1' });
  let prompt = whiteSocket.emitted.at(-1);
  assert.equal(prompt.name, 'mutatorAction');
  assert.match(prompt.payload.prompt, /not empty/i);

  room.mutatorState.boardModifiers = { blockedSquares: [{ square: 'd4' }] };
  whiteSocket.trigger('mutatorActionResponse', { targets: 'd4' });
  prompt = whiteSocket.emitted.at(-1);
  assert.equal(prompt.name, 'mutatorAction');
  assert.match(prompt.payload.prompt, /blocked/i);

  assert.ok(room.mutatorState.pendingAction);
  assert.equal(roomEvents.some((e) => e.name === 'mutatorActivated'), false);
});

test('piece/friendly_piece reject king and enemy_piece rejects invalid targets', () => {
  const { room, whiteSocket, roomEvents } = setupMutatorActionRoom({ roomCode: 'MACT-G' });

  room.mutatorState.pendingAction = { ruleId: 'x', actionType: 'piece', forPlayer: 'w', rule: { id: 'x', name: 'X', duration: 1 } };
  whiteSocket.trigger('mutatorActionResponse', { targets: 'e1' });
  assert.match(whiteSocket.emitted.at(-1).payload.prompt, /cannot select a King/i);

  room.mutatorState.pendingAction = { ruleId: 'x', actionType: 'enemy_piece', forPlayer: 'w', rule: { id: 'x', name: 'X', duration: 1 } };
  whiteSocket.trigger('mutatorActionResponse', { targets: 'e2' });
  assert.match(whiteSocket.emitted.at(-1).payload.prompt, /must select an enemy piece/i);

  room.chess.load('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  room.mutatorState.pendingAction = { ruleId: 'x', actionType: 'enemy_piece', forPlayer: 'w', rule: { id: 'x', name: 'X', duration: 1 } };
  whiteSocket.trigger('mutatorActionResponse', { targets: 'e8' });
  assert.match(whiteSocket.emitted.at(-1).payload.prompt, /cannot target the King/i);

  assert.equal(roomEvents.some((e) => e.name === 'mutatorActivated'), false);
});

test('valid square response activates and clears pending actions', () => {
  const { room, whiteSocket, roomEvents } = setupMutatorActionRoom({ roomCode: 'MACT-H' });
  const rule = { id: 'test_square_rule', name: 'Square Rule', description: 'd', duration: 2 };
  room.mutatorState.pendingAction = { ruleId: rule.id, actionType: 'square', forPlayer: 'w', rule };

  whiteSocket.trigger('mutatorActionResponse', { targets: 'd4' });

  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
  const activated = roomEvents.find((e) => e.name === 'mutatorActivated');
  assert.ok(activated);
  assert.equal(activated.payload.rule.id, rule.id);
  assert.equal(activated.payload.chooser, 'w');
  assert.ok(activated.payload.fen);
  assert.ok(activated.payload.mutatorState);
});

test('two_squares and two_pieces_same_column multi-step flows', () => {
  const { room, whiteSocket, roomEvents } = setupMutatorActionRoom({ roomCode: 'MACT-I' });

  room.mutatorState.pendingAction = { ruleId: 'two-sq', actionType: 'two_squares', forPlayer: 'w', rule: { id: 'two-sq', name: 'Two', description: '', duration: 1 } };
  whiteSocket.trigger('mutatorActionResponse', { targets: 'a3' });
  assert.deepEqual(room.mutatorState.pendingAction.partialData, { square1: 'a3' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'a4' });
  assert.ok(roomEvents.find((e) => e.name === 'mutatorActivated'));

  roomEvents.length = 0;
  room.mutatorState.pendingAction = { ruleId: 'two-col', actionType: 'two_pieces_same_column', forPlayer: 'w', rule: { id: 'two-col', name: 'Col', description: '', duration: 1 } };
  whiteSocket.trigger('mutatorActionResponse', { targets: 'a2' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'b2' });
  assert.match(whiteSocket.emitted.at(-1).payload.prompt, /same column/i);
  whiteSocket.trigger('mutatorActionResponse', { targets: 'a1' });
  assert.ok(roomEvents.find((e) => e.name === 'mutatorActivated'));
});

test('secondPlayerChoice creates pendingSecondAction then human response activates', () => {
  const { room, whiteSocket, blackSocket, roomEvents } = setupMutatorActionRoom({ roomCode: 'MACT-J' });
  const rule = { id: 'mindish', name: 'Mindish', description: '', duration: 2, secondPlayerChoice: true, secondChoiceType: 'square' };
  room.mutatorState.pendingAction = { ruleId: rule.id, actionType: 'square', forPlayer: 'w', rule };

  whiteSocket.trigger('mutatorActionResponse', { targets: 'c3' });
  assert.equal(room.mutatorState.pendingAction, null);
  assert.ok(room.mutatorState.pendingSecondAction);
  assert.equal(room.mutatorState.pendingSecondAction.forPlayer, 'b');
  assert.equal(room.mutatorState.pendingSecondAction.firstChoiceData, 'c3');
  assert.ok(blackSocket.emitted.find((e) => e.name === 'mutatorAction'));
  assert.equal(roomEvents.some((e) => e.name === 'mutatorActivated'), false);

  blackSocket.trigger('mutatorActionResponse', { targets: 'c4' });
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.ok(roomEvents.find((e) => e.name === 'mutatorActivated'));
});

test('two_friendly_pawns 3-step flow validates and activates deterministically', () => {
  const { room, whiteSocket, roomEvents } = setupMutatorActionRoom({ roomCode: 'MACT-K' });
  room.chess.load('4k3/8/8/8/8/8/PP6/4K3 w - - 0 1');
  room.mutatorState.pendingAction = {
    ruleId: 'kids',
    actionType: 'two_friendly_pawns',
    forPlayer: 'w',
    rule: { id: 'kids', name: 'Kids', description: '', duration: 1 },
  };

  whiteSocket.trigger('mutatorActionResponse', { targets: 'e1' });
  assert.match(whiteSocket.emitted.at(-1).payload.prompt, /YOUR pawns/i);

  whiteSocket.trigger('mutatorActionResponse', { targets: 'a2' });
  assert.deepEqual(room.mutatorState.pendingAction.partialData, { pawns: ['a2'] });

  whiteSocket.trigger('mutatorActionResponse', { targets: 'a2' });
  assert.match(whiteSocket.emitted.at(-1).payload.prompt, /DIFFERENT pawn/i);

  whiteSocket.trigger('mutatorActionResponse', { targets: 'b2' });
  assert.match(whiteSocket.emitted.at(-1).payload.prompt, /new Bishop/i);

  whiteSocket.trigger('mutatorActionResponse', { targets: 'e1' });
  assert.match(whiteSocket.emitted.at(-1).payload.prompt, /occupied/i);

  whiteSocket.trigger('mutatorActionResponse', { targets: 'c3' });
  assert.equal(room.mutatorState.pendingAction, null);
  const activated = roomEvents.find((e) => e.name === 'mutatorActivated');
  assert.ok(activated);
});
