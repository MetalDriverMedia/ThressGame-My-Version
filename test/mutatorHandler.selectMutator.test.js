const test = require('node:test');
const assert = require('node:assert/strict');

const { GameManager, GameRoom } = require('../gameManager');
const { createMutatorHandlers } = require('../handlers/mutatorHandler');
const { RULES } = require('../mutators/mutatorDefs');
const turnClock = require('../utils/turnClock');
const {
  createIoRecorder,
  createRegisteredSocket,
} = require('./helpers/moveHandlerTestHelpers');

const roomsToCleanup = new Set();

function setupMutatorSelectionRoom({ roomCode = 'MSEL1', chooser = 'w', whiteIsBot = false, blackIsBot = false } = {}) {
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

  room.mutatorState.pendingChoice = { chooser, options: [] };

  return { gameManager, room, whiteSocket, blackSocket, io, roomEvents };
}

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});

function getRule(id) {
  const rule = RULES.find((r) => r.id === id);
  assert.ok(rule, `expected rule ${id} to exist`);
  return rule;
}

test('selectMutator ignores invalid payloads', () => {
  const { room, whiteSocket, roomEvents } = setupMutatorSelectionRoom({ roomCode: 'MSEL-A' });
  const originalPending = room.mutatorState.pendingChoice;

  whiteSocket.trigger('selectMutator', null);
  whiteSocket.trigger('selectMutator', {});
  whiteSocket.trigger('selectMutator', { ruleId: 12 });

  assert.equal(roomEvents.length, 0);
  assert.equal(room.mutatorState.pendingChoice, originalPending);
});

test('selectMutator ignores when socket is not mapped to a room', () => {
  const { gameManager, room, io, roomEvents } = setupMutatorSelectionRoom({ roomCode: 'MSEL-B' });
  room.mutatorState.pendingChoice.options = [getRule('going_woke')];

  const unmappedSocket = createRegisteredSocket('sock-z');
  const handlers = createMutatorHandlers({ handleMove: async () => {}, scheduleBotMove: () => {}, generateBotTarget: () => null });
  handlers.registerSocketHandlers(unmappedSocket, io, gameManager);

  unmappedSocket.trigger('selectMutator', { ruleId: 'going_woke' });

  assert.equal(roomEvents.length, 0);
  assert.ok(room.mutatorState.pendingChoice);
});

test('selectMutator ignores when room has no mutatorState', () => {
  const { room, whiteSocket, roomEvents } = setupMutatorSelectionRoom({ roomCode: 'MSEL-C' });
  room.mutatorState = null;
  whiteSocket.trigger('selectMutator', { ruleId: 'going_woke' });
  assert.equal(roomEvents.length, 0);
});

test('selectMutator ignores when pendingChoice is missing', () => {
  const { room, whiteSocket, roomEvents } = setupMutatorSelectionRoom({ roomCode: 'MSEL-D' });
  room.mutatorState.pendingChoice = null;
  whiteSocket.trigger('selectMutator', { ruleId: 'going_woke' });
  assert.equal(roomEvents.length, 0);
});

test('selectMutator ignores non-chooser player', () => {
  const { room, blackSocket, roomEvents } = setupMutatorSelectionRoom({ roomCode: 'MSEL-E', chooser: 'w' });
  room.mutatorState.pendingChoice.options = [getRule('going_woke')];

  blackSocket.trigger('selectMutator', { ruleId: 'going_woke' });

  assert.ok(room.mutatorState.pendingChoice);
  assert.equal(roomEvents.some((e) => ['mutatorSelected', 'mutatorChosen', 'mutatorActivated'].includes(e.name)), false);
});

test('selectMutator ignores ruleId not in options', () => {
  const { room, whiteSocket, roomEvents } = setupMutatorSelectionRoom({ roomCode: 'MSEL-F' });
  room.mutatorState.pendingChoice.options = [getRule('going_woke')];

  whiteSocket.trigger('selectMutator', { ruleId: 'minefield' });

  assert.ok(room.mutatorState.pendingChoice);
  assert.equal(roomEvents.length, 0);
});

test('selectMutator requiresChoice creates pendingAction and emits prompt', () => {
  const { room, whiteSocket, roomEvents } = setupMutatorSelectionRoom({ roomCode: 'MSEL-G' });
  const option = {
    id: 'test_requires_choice',
    name: 'Test Requires Choice',
    description: 'Test requires choice',
    duration: 3,
    requiresChoice: true,
    choiceType: 'empty_square',
  };
  room.mutatorState.pendingChoice.options = [option];

  whiteSocket.trigger('selectMutator', { ruleId: option.id });

  assert.equal(room.mutatorState.pendingChoice, null);
  assert.ok(room.mutatorState.pendingAction);
  assert.equal(room.mutatorState.pendingAction.ruleId, option.id);
  assert.equal(room.mutatorState.pendingAction.actionType, option.choiceType);
  assert.equal(room.mutatorState.pendingAction.forPlayer, 'w');

  const chosen = roomEvents.find((e) => e.name === 'mutatorChosen');
  assert.ok(chosen);
  assert.equal(chosen.payload.requiresAction, true);

  const directPrompt = whiteSocket.emitted.find((e) => e.name === 'mutatorAction');
  assert.ok(directPrompt);
  assert.equal(directPrompt.payload.ruleId, option.id);
  assert.equal(directPrompt.payload.actionType, option.choiceType);
  assert.equal(directPrompt.payload.forPlayer, 'w');
  assert.match(directPrompt.payload.prompt, /Select target/i);
  assert.equal(roomEvents.some((e) => e.name === 'mutatorActivated'), false);
});

test('selectMutator instant option emits selected and activated', () => {
  const { room, whiteSocket, roomEvents } = setupMutatorSelectionRoom({ roomCode: 'MSEL-H' });
  const option = getRule('going_woke');
  room.mutatorState.pendingChoice.options = [option];

  whiteSocket.trigger('selectMutator', { ruleId: option.id });

  assert.equal(room.mutatorState.pendingChoice, null);
  assert.ok(roomEvents.find((e) => e.name === 'mutatorSelected'));
  const activated = roomEvents.find((e) => e.name === 'mutatorActivated');
  assert.ok(activated);
  assert.equal(activated.payload.rule.id, option.id);
  assert.equal(activated.payload.chooser, 'w');
  assert.ok(activated.payload.fen);
  assert.ok(activated.payload.mutatorState);
  assert.ok(activated.payload.checkState);
  assert.equal(whiteSocket.emitted.some((e) => e.name === 'mutatorAction'), false);
});

test('selectMutator skips two_kids_in_a_trenchcoat when chooser has fewer than 2 pawns', () => {
  const { room, whiteSocket, roomEvents } = setupMutatorSelectionRoom({ roomCode: 'MSEL-I' });
  const option = getRule('two_kids_in_a_trenchcoat');
  room.chess.load('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  room.mutatorState.pendingChoice.options = [option];

  whiteSocket.trigger('selectMutator', { ruleId: option.id });

  assert.equal(room.mutatorState.pendingChoice, null);
  assert.equal(room.mutatorState.pendingAction, null);
  const selected = roomEvents.find((e) => e.name === 'mutatorSelected');
  const activated = roomEvents.find((e) => e.name === 'mutatorActivated');
  assert.ok(selected);
  assert.ok(activated);
  assert.equal(activated.payload.skipped, true);
  assert.match(activated.payload.rule.description, /not enough pawns/i);
});

test('selectMutator skips drafted_for_battle when a player lacks bishop/knight', () => {
  const { room, whiteSocket, roomEvents } = setupMutatorSelectionRoom({ roomCode: 'MSEL-J' });
  const option = getRule('drafted_for_battle');
  room.chess.load('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  room.mutatorState.pendingChoice.options = [option];

  whiteSocket.trigger('selectMutator', { ruleId: option.id });

  assert.equal(room.mutatorState.pendingChoice, null);
  assert.equal(room.mutatorState.pendingAction, null);
  const selected = roomEvents.find((e) => e.name === 'mutatorSelected');
  const activated = roomEvents.find((e) => e.name === 'mutatorActivated');
  assert.ok(selected);
  assert.ok(activated);
  assert.equal(activated.payload.skipped, true);
  assert.match(activated.payload.rule.description, /no Bishops or Knights/i);
});



test('selectMutator all_on_red auto mode triggers immediate coin flip result', () => {
  const { room, whiteSocket, roomEvents } = setupMutatorSelectionRoom({ roomCode: 'MSEL-K1' });
  const option = getRule('all_on_red');
  room.manualCoinFlip = false;
  room.chess.load('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  room.mutatorState.pendingChoice = { chooser: 'w', options: [option] };

  const originalRandom = Math.random;
  try {
    Math.random = () => 0.1;
    whiteSocket.trigger('selectMutator', { ruleId: option.id });
  } finally {
    Math.random = originalRandom;
  }

  assert.ok(roomEvents.find((e) => e.name === 'mutatorActivated'));
  const coinFlipEvent = roomEvents.find((e) => e.name === 'coinFlip');
  assert.ok(coinFlipEvent);
  assert.equal(coinFlipEvent.payload.forPlayer, 'w');
  assert.equal(coinFlipEvent.payload.result, 'heads');
  assert.deepEqual(room.mutatorState.coinFlipResult, { result: 'heads', moveCount: room.mutatorState.moveCount });
  assert.equal(room.mutatorState.pendingCoinFlip, null);
});

test('selectMutator all_on_red manual mode creates pendingCoinFlip and emits prompt', () => {
  const { room, whiteSocket, roomEvents } = setupMutatorSelectionRoom({ roomCode: 'MSEL-K2' });
  const option = getRule('all_on_red');
  room.manualCoinFlip = true;
  room.chess.load('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  room.mutatorState.pendingChoice = { chooser: 'w', options: [option] };

  whiteSocket.trigger('selectMutator', { ruleId: option.id });

  assert.ok(roomEvents.find((e) => e.name === 'mutatorActivated'));
  const prompt = roomEvents.find((e) => e.name === 'coinFlipPrompt');
  assert.ok(prompt);
  assert.equal(prompt.payload.forPlayer, 'w');
  assert.deepEqual(room.mutatorState.pendingCoinFlip, { forPlayer: 'w', moveCount: room.mutatorState.moveCount });
  assert.equal(room.mutatorState.coinFlipResult, null);
});

test('selectMutator schedules bot auto response for bot chooser requiresChoice without real timer', () => {
  const { room, whiteSocket } = setupMutatorSelectionRoom({ roomCode: 'MSEL-L', chooser: 'w', whiteIsBot: true });
  const option = {
    id: 'test_requires_choice_bot',
    name: 'Test Requires Choice Bot',
    description: 'Test requires choice bot',
    duration: 3,
    requiresChoice: true,
    choiceType: 'empty_square',
  };
  room.mutatorState.pendingChoice.options = [option];

  const originalSetTimeout = global.setTimeout;
  const calls = [];
  try {
    global.setTimeout = (fn, delay) => {
      calls.push({ fn, delay });
      return 1;
    };

    whiteSocket.trigger('selectMutator', { ruleId: option.id });
    assert.ok(room.mutatorState.pendingAction);
    assert.equal(calls.length, 1);
    assert.equal(typeof calls[0].fn, 'function');
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});
