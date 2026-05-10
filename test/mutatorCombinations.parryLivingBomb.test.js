const test = require('node:test');
const assert = require('node:assert/strict');

const { Chess } = require('chess.js');
const { GameManager, GameRoom } = require('../gameManager');
const { createMutatorHandlers } = require('../handlers/mutatorHandler');
const { handleMove } = require('../handlers/moveHandler');
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

function createRoom({ roomCode, fen }) {
  const gameManager = new GameManager();
  const room = new GameRoom(roomCode);
  room.addPlayer({ name: 'White', color: 'w', socketId: 'sock-w', isBot: false });
  room.addPlayer({ name: 'Black', color: 'b', socketId: 'sock-b', isBot: false });
  room.startGame();
  room.chess.load(fen);
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

  return { room, gameManager, io, roomEvents, whiteSocket, blackSocket };
}

function setPending(room, ruleId, forPlayer = 'w') {
  const rule = getRule(ruleId);
  room.mutatorState.pendingAction = { ruleId, actionType: rule.choiceType, forPlayer, rule };
}

function activateRuleById(room, ruleId, choiceData) {
  const rule = getRule(ruleId);
  room.mutatorState.activeRules.push({ rule, activatedBy: 'w', choiceData, expiresAtMove: room.mutatorState.moveCount + rule.duration });
}

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});

test('baseline parry capture creates pendingRPS and blocks moves until resolved', async () => {
  const { room, gameManager, io, whiteSocket, blackSocket } = createRoom({ roomCode: 'PLB-1', fen: '4k3/8/8/8/8/8/3p4/3QK3 w - - 0 1' });
  activateRuleById(room, 'parry');

  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });
  assert.ok(room.mutatorState.pendingRPS);
  assert.equal(room.chess.get('d1').type, 'q');

  await handleMove(io, blackSocket, gameManager, { from: 'e8', to: 'e7' });
  assert.equal(blackSocket.emitted.at(-1).name, 'moveRejected');
  assert.match(blackSocket.emitted.at(-1).payload.error || '', /not your turn|Illegal move/);
});

test('baseline living bomb placement tracks chosen square and board remains valid', () => {
  const { room, whiteSocket } = createRoom({ roomCode: 'PLB-2', fen: '4k3/8/8/8/8/8/3p4/3QK3 w - - 0 1' });
  setPending(room, 'living_bomb');

  whiteSocket.trigger('mutatorActionResponse', { targets: 'd2' });

  assert.equal(room.mutatorState.boardModifiers.livingBombs.length, 1);
  assert.deepEqual(room.mutatorState.boardModifiers.livingBombs[0].square, 'd2');
  assert.doesNotThrow(() => new Chess(room.chess.fen()));
  assert.equal(validateRoomIntegrity(room, 'test:parry-lb-baseline'), true);
});

test('parry defender win on bomb square blocks capture and keeps bomb marker coherent', async () => {
  const { room, gameManager, io, roomEvents, whiteSocket, blackSocket } = createRoom({ roomCode: 'PLB-3', fen: '4k3/8/8/8/8/8/3p4/3QK3 w - - 0 1' });
  activateRuleById(room, 'parry');
  setPending(room, 'living_bomb');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'd2' });

  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });
  whiteSocket.trigger('rpsChoice', { choice: 'rock' });
  blackSocket.trigger('rpsChoice', { choice: 'paper' });

  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.chess.get('d1').type, 'q');
  assert.equal(room.chess.get('d2').type, 'p');
  assert.equal(room.chess.turn(), 'b');
  assert.equal(room.mutatorState.boardModifiers.livingBombs[0].square, 'd2');
  assert.equal(roomEvents.filter((e) => e.name === 'moveApplied').length, 1);
  assert.equal(validateRoomIntegrity(room, 'test:parry-lb-defender-win'), true);
});

test('parry attacker win on bomb square proceeds capture while preserving consistent marker state without stale pendingRPS', async () => {
  const { room, gameManager, io, roomEvents, whiteSocket, blackSocket } = createRoom({ roomCode: 'PLB-4', fen: '4k3/8/8/8/8/8/3p4/3QK3 w - - 0 1' });
  activateRuleById(room, 'parry');
  setPending(room, 'living_bomb');
  whiteSocket.trigger('mutatorActionResponse', { targets: 'd2' });

  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });
  const livingBombCountBeforeResolution = room.mutatorState.boardModifiers.livingBombs.length;
  const rpsResultsBeforeResolution = roomEvents.filter((e) => e.name === 'rpsResult').length;
  const moveAppliedBeforeResolution = roomEvents.filter((e) => e.name === 'moveApplied').length;

  whiteSocket.trigger('rpsChoice', { choice: 'rock' });
  blackSocket.trigger('rpsChoice', { choice: 'scissors' });

  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.chess.get('d1'), undefined);
  assert.equal(room.chess.get('d2').type, 'q');
  assert.equal(room.mutatorState.boardModifiers.livingBombs.length, livingBombCountBeforeResolution);
  assert.equal(room.mutatorState.boardModifiers.livingBombs[0].square, 'd2');
  assert.equal(roomEvents.filter((e) => e.name === 'rpsResult').length, rpsResultsBeforeResolution + 1);
  assert.equal(roomEvents.filter((e) => e.name === 'moveApplied').length, moveAppliedBeforeResolution + 1);
  assert.equal(validateRoomIntegrity(room, 'test:parry-lb-attacker-win'), true);
});
