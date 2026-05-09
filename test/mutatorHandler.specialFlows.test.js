const test = require('node:test');
const assert = require('node:assert/strict');

const { GameManager, GameRoom } = require('../gameManager');
const { createMutatorHandlers } = require('../handlers/mutatorHandler');
const { RULES } = require('../mutators/mutatorDefs');
const { createIoRecorder, createRegisteredSocket } = require('./helpers/moveHandlerTestHelpers');

function setupSpecialFlowRoom({ roomCode = 'MSPF1', whiteIsBot = false, blackIsBot = false, fen = null, manualCoinFlip = false } = {}) {
  const gameManager = new GameManager();
  const room = new GameRoom(roomCode);
  room.addPlayer({ name: 'White', color: 'w', socketId: 'sock-w', isBot: whiteIsBot });
  room.addPlayer({ name: 'Black', color: 'b', socketId: 'sock-b', isBot: blackIsBot });
  room.startGame();
  if (fen) room.chess.load(fen);
  room.manualCoinFlip = manualCoinFlip;

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
  return { room, gameManager, whiteSocket, blackSocket, io, roomEvents };
}

function getRule(id) {
  const rule = RULES.find((r) => r.id === id);
  assert.ok(rule, `expected rule ${id} to exist`);
  return rule;
}

function setPendingAction(room, ruleId, forPlayer = 'w') {
  const rule = getRule(ruleId);
  room.mutatorState.pendingAction = {
    ruleId,
    actionType: rule.choiceType,
    forPlayer,
    rule,
  };
}

test('two_kids_in_a_trenchcoat performs sacrifice + bishop placement with real hook', () => {
  const { room, whiteSocket, roomEvents } = setupSpecialFlowRoom({
    roomCode: 'MSPF-A',
    fen: '4k3/8/8/8/8/8/PP6/4K3 w - - 0 1',
  });
  setPendingAction(room, 'two_kids_in_a_trenchcoat');

  whiteSocket.trigger('mutatorActionResponse', { targets: 'a2' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'b2' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'c3' });

  assert.equal(room.chess.get('a2'), undefined);
  assert.equal(room.chess.get('b2'), undefined);
  assert.deepEqual(room.chess.get('c3'), { type: 'b', color: 'w' });
  assert.equal(room.mutatorState.pendingAction, null);
  const activated = roomEvents.find((e) => e.name === 'mutatorActivated');
  assert.ok(activated);
  assert.equal(activated.payload.rule.id, 'two_kids_in_a_trenchcoat');
});

test('moving_up_the_corporate_ladder swaps same-column pieces with real hook', () => {
  const { room, whiteSocket, roomEvents } = setupSpecialFlowRoom({
    roomCode: 'MSPF-B',
    fen: '4k3/8/8/8/8/8/N7/R3K3 w - - 0 1',
  });
  setPendingAction(room, 'moving_up_the_corporate_ladder');

  whiteSocket.trigger('mutatorActionResponse', { targets: 'a1' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'a2' });

  assert.deepEqual(room.chess.get('a1'), { type: 'n', color: 'w' });
  assert.deepEqual(room.chess.get('a2'), { type: 'r', color: 'w' });
  assert.ok(roomEvents.find((e) => e.name === 'mutatorActivated' && e.payload.rule.id === 'moving_up_the_corporate_ladder'));
});

test('mind_control executes second-player flow and converts both selected targets', () => {
  const { room, whiteSocket, blackSocket, roomEvents } = setupSpecialFlowRoom({
    roomCode: 'MSPF-C',
    fen: '4k3/4n3/8/8/8/8/4B3/4K3 w - - 0 1',
  });
  setPendingAction(room, 'mind_control', 'w');

  whiteSocket.trigger('mutatorActionResponse', { targets: 'e7' });
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction.forPlayer, 'b');
  assert.equal(roomEvents.some((e) => e.name === 'mutatorActivated'), false);

  blackSocket.trigger('mutatorActionResponse', { targets: 'e2' });

  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.deepEqual(room.chess.get('e7'), { type: 'n', color: 'w' });
  assert.deepEqual(room.chess.get('e2'), { type: 'b', color: 'b' });
  assert.ok(roomEvents.find((e) => e.name === 'mutatorActivated' && e.payload.rule.id === 'mind_control'));
});

test('drafted_for_battle executes second-player flow and swaps both kings', () => {
  const { room, whiteSocket, blackSocket, roomEvents } = setupSpecialFlowRoom({
    roomCode: 'MSPF-D',
    fen: '4k3/6n1/8/8/8/8/6B1/4K3 w - - 0 1',
  });
  setPendingAction(room, 'drafted_for_battle', 'w');

  whiteSocket.trigger('mutatorActionResponse', { targets: 'g2' });
  blackSocket.trigger('mutatorActionResponse', { targets: 'g7' });

  assert.deepEqual(room.chess.get('e1'), { type: 'b', color: 'w' });
  assert.deepEqual(room.chess.get('g2'), { type: 'k', color: 'w' });
  assert.deepEqual(room.chess.get('e8'), { type: 'n', color: 'b' });
  assert.deepEqual(room.chess.get('g7'), { type: 'k', color: 'b' });
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.ok(roomEvents.find((e) => e.name === 'mutatorActivated' && e.payload.rule.id === 'drafted_for_battle'));
});

test('portal_3 stores deterministic portal pair through two-square flow', () => {
  const { room, whiteSocket, roomEvents } = setupSpecialFlowRoom({ roomCode: 'MSPF-E' });
  setPendingAction(room, 'portal_3', 'w');

  whiteSocket.trigger('mutatorActionResponse', { targets: 'a3' });
  whiteSocket.trigger('mutatorActionResponse', { targets: 'h6' });

  assert.ok(roomEvents.find((e) => e.name === 'mutatorActivated' && e.payload.rule.id === 'portal_3'));
  assert.ok(room.mutatorState.boardModifiers.portals.some((p) => p.square1 === 'a3' && p.square2 === 'h6'));
});

test('bottomless_pit marks selected empty square in board modifiers', () => {
  const { room, whiteSocket, roomEvents } = setupSpecialFlowRoom({ roomCode: 'MSPF-F' });
  setPendingAction(room, 'bottomless_pit', 'w');

  whiteSocket.trigger('mutatorActionResponse', { targets: 'd4' });

  assert.ok(roomEvents.find((e) => e.name === 'mutatorActivated' && e.payload.rule.id === 'bottomless_pit'));
  assert.ok(room.mutatorState.boardModifiers.bottomlessPits.some((p) => p.square === 'd4'));
});

test('living_bomb records selected friendly piece marker', () => {
  const { room, whiteSocket, roomEvents } = setupSpecialFlowRoom({ roomCode: 'MSPF-G' });
  setPendingAction(room, 'living_bomb', 'w');

  whiteSocket.trigger('mutatorActionResponse', { targets: 'd2' });

  assert.ok(roomEvents.find((e) => e.name === 'mutatorActivated' && e.payload.rule.id === 'living_bomb'));
  assert.ok(room.mutatorState.boardModifiers.livingBombs.some((b) => b.square === 'd2' && b.piece === 'p'));
});

test('mitosis activates on selected non-king piece and tracks frozen choiceData', () => {
  const { room, whiteSocket, roomEvents } = setupSpecialFlowRoom({ roomCode: 'MSPF-H' });
  setPendingAction(room, 'mitosis', 'w');

  whiteSocket.trigger('mutatorActionResponse', { targets: 'd2' });

  assert.ok(roomEvents.find((e) => e.name === 'mutatorActivated' && e.payload.rule.id === 'mitosis'));
  const mitosisRule = room.mutatorState.activeRules.find((ar) => ar.rule.id === 'mitosis');
  assert.ok(mitosisRule);
  assert.equal(mitosisRule.choiceData, 'd2');
});

test('risk_it_rook manual mode defers with pending flip state and prompt event', () => {
  const { room, whiteSocket, roomEvents } = setupSpecialFlowRoom({ roomCode: 'MSPF-I', manualCoinFlip: true });
  room.mutatorState.pendingChoice = { chooser: 'w', options: [getRule('risk_it_rook')] };

  whiteSocket.trigger('selectMutator', { ruleId: 'risk_it_rook' });

  assert.ok(room._riskItRookPending);
  assert.equal(room._riskItRookPending.phase, 'chooser');
  assert.equal(room._riskItRookPending.chooserColor, 'w');
  assert.equal(room._riskItRookPending.opponentColor, 'b');
  assert.ok(whiteSocket.emitted.find((e) => e.name === 'riskItRookFlipPrompt'));
});

test('sophies_choice selectMutator generates deterministic options and removes chosen pieces', () => {
  const { room, whiteSocket, blackSocket, roomEvents } = setupSpecialFlowRoom({
    roomCode: 'MSPF-J',
    fen: '4k3/8/8/3p4/3P4/2N5/3B4/4K3 w - - 0 1',
  });
  room.mutatorState.pendingChoice = { chooser: 'w', options: [getRule('sophies_choice')] };

  const originalRandom = Math.random;
  try {
    const seq = [0, 0, 0, 0];
    Math.random = () => seq.shift() ?? 0;

    whiteSocket.trigger('selectMutator', { ruleId: 'sophies_choice' });
    const whitePrompt = whiteSocket.emitted.find((e) => e.name === 'mutatorAction' && e.payload.actionType === 'sophie');
    assert.ok(whitePrompt);
    assert.deepEqual(whitePrompt.payload.sophieOptions, ['d4', 'c3']);

    whiteSocket.trigger('mutatorActionResponse', { targets: 'd4' });
    assert.equal(room.mutatorState.pendingSecondAction.forPlayer, 'b');

    const blackPrompt = blackSocket.emitted.find((e) => e.name === 'mutatorAction' && e.payload.actionType === 'sophie');
    assert.ok(blackPrompt);
    assert.equal(blackPrompt.payload.sophieOptions, null);

    blackSocket.trigger('mutatorActionResponse', { targets: 'd5' });
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(room.chess.get('d4'), undefined);
  assert.equal(room.chess.get('d5'), undefined);
  assert.ok(roomEvents.find((e) => e.name === 'mutatorActivated' && e.payload.rule.id === 'sophies_choice'));
});

test('risk_it_rook auto mode emits deterministic flip payload with no placements on tails', () => {
  const { room, whiteSocket, roomEvents } = setupSpecialFlowRoom({ roomCode: 'MSPF-K', manualCoinFlip: false });
  room.mutatorState.pendingChoice = { chooser: 'w', options: [getRule('risk_it_rook')] };

  const originalRandom = Math.random;
  try {
    Math.random = () => 0.9;
    whiteSocket.trigger('selectMutator', { ruleId: 'risk_it_rook' });
  } finally {
    Math.random = originalRandom;
  }

  const activated = roomEvents.find((e) => e.name === 'mutatorActivated' && e.payload.rule.id === 'risk_it_rook');
  assert.ok(activated);
  assert.deepEqual(activated.payload.riskItRookFlip, {
    chooserColor: 'w',
    opponentColor: 'b',
    chooserFlip: 'tails',
    opponentFlip1: 'tails',
    opponentFlip2: 'tails',
    chooserSquare: null,
    opponentSquare: null,
  });
  assert.equal(room._riskItRookResult, undefined);
});
