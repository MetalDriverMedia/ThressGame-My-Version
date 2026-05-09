const test = require('node:test');
const assert = require('node:assert/strict');

const { GameManager, GameRoom } = require('../gameManager');
const { RULES } = require('../mutators/mutatorDefs');
const { createMutatorHandlers } = require('../handlers/mutatorHandler');
const { createIoRecorder, createRegisteredSocket } = require('./helpers/moveHandlerTestHelpers');

function setupRiskItRookRoom({ roomCode = 'RIRK1', fen = null, whiteIsBot = false, blackIsBot = false } = {}) {
  const gameManager = new GameManager();
  const room = new GameRoom(roomCode);
  room.addPlayer({ name: 'White', color: 'w', socketId: 'sock-w', isBot: whiteIsBot });
  room.addPlayer({ name: 'Black', color: 'b', socketId: 'sock-b', isBot: blackIsBot });
  room.startGame();
  if (fen) room.chess.load(fen);

  room.manualCoinFlip = true;
  room.mutatorState = room.mutatorState || {};

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

  return { gameManager, room, whiteSocket, blackSocket, io, roomEvents };
}

function getRule(id) {
  const rule = RULES.find((r) => r.id === id);
  assert.ok(rule, `expected rule ${id} to exist`);
  return rule;
}

function beginRiskItRookManualFlow(room, whiteSocket) {
  room.mutatorState.pendingChoice = { chooser: 'w', options: [getRule('risk_it_rook')] };
  whiteSocket.trigger('selectMutator', { ruleId: 'risk_it_rook' });
  assert.ok(room._riskItRookPending);
  assert.ok(whiteSocket.emitted.find((e) => e.name === 'riskItRookFlipPrompt'));
}

test('selectMutator risk_it_rook manual mode creates pending flow and chooser prompt', () => {
  const { room, whiteSocket } = setupRiskItRookRoom({ roomCode: 'RIRK-A' });

  room.mutatorState.pendingChoice = { chooser: 'w', options: [getRule('risk_it_rook')] };
  whiteSocket.trigger('selectMutator', { ruleId: 'risk_it_rook' });

  assert.ok(room._riskItRookPending);
  assert.equal(room._riskItRookPending.chooserColor, 'w');
  assert.equal(room._riskItRookPending.opponentColor, 'b');
  assert.equal(room._riskItRookPending.phase, 'chooser');
  assert.deepEqual(room._riskItRookPending.flips, {});

  const prompt = whiteSocket.emitted.find((e) => e.name === 'riskItRookFlipPrompt');
  assert.ok(prompt);
  assert.equal(prompt.payload.phase, 'chooser');
  assert.equal(prompt.payload.forPlayer, 'w');
});

test('invalid riskItRookFlipChoice payloads are ignored', () => {
  const { room, whiteSocket, roomEvents } = setupRiskItRookRoom({ roomCode: 'RIRK-B' });
  beginRiskItRookManualFlow(room, whiteSocket);

  whiteSocket.trigger('riskItRookFlipChoice', null);
  whiteSocket.trigger('riskItRookFlipChoice', {});
  whiteSocket.trigger('riskItRookFlipChoice', { choice: 'bad' });

  assert.equal(room._riskItRookPending.phase, 'chooser');
  assert.deepEqual(room._riskItRookPending.flips, {});
  assert.equal(roomEvents.some((e) => e.name === 'mutatorBoardUpdate'), false);
  assert.equal(room._riskItRookResult, undefined);
});

test('wrong player cannot answer chooser phase', () => {
  const { room, whiteSocket, blackSocket, roomEvents } = setupRiskItRookRoom({ roomCode: 'RIRK-C' });
  beginRiskItRookManualFlow(room, whiteSocket);

  blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });

  assert.equal(room._riskItRookPending.phase, 'chooser');
  assert.equal(room._riskItRookPending.flips.chooserFlip, undefined);
  assert.equal(roomEvents.some((e) => e.name === 'mutatorBoardUpdate'), false);
});

test('chooser heads advances to opponent1 and prompts opponent', () => {
  const { room, whiteSocket, blackSocket, roomEvents } = setupRiskItRookRoom({ roomCode: 'RIRK-D' });
  beginRiskItRookManualFlow(room, whiteSocket);

  whiteSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });

  assert.equal(room._riskItRookPending.flips.chooserFlip, 'heads');
  assert.equal(room._riskItRookPending.phase, 'opponent1');
  assert.ok(blackSocket.emitted.find((e) => e.name === 'riskItRookFlipPrompt' && e.payload.phase === 'opponent1'));
  assert.equal(room._riskItRookResult, undefined);
  assert.equal(roomEvents.some((e) => e.name === 'mutatorBoardUpdate'), false);
});

test('opponent1 heads advances to opponent2 and prompts opponent again', () => {
  const { room, whiteSocket, blackSocket, roomEvents } = setupRiskItRookRoom({ roomCode: 'RIRK-E' });
  beginRiskItRookManualFlow(room, whiteSocket);

  whiteSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
  blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });

  assert.equal(room._riskItRookPending.flips.opponentFlip1, 'heads');
  assert.equal(room._riskItRookPending.phase, 'opponent2');
  const opponentPrompts = blackSocket.emitted.filter((e) => e.name === 'riskItRookFlipPrompt');
  assert.ok(opponentPrompts.some((e) => e.payload.phase === 'opponent1'));
  assert.ok(opponentPrompts.some((e) => e.payload.phase === 'opponent2'));
  assert.equal(roomEvents.some((e) => e.name === 'mutatorBoardUpdate'), false);
});

test('all heads completion places both rooks and emits stable final payload', () => {
  const { room, whiteSocket, blackSocket, roomEvents } = setupRiskItRookRoom({
    roomCode: 'RIRK-F',
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
  });
  beginRiskItRookManualFlow(room, whiteSocket);

  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    whiteSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
    blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
    blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(room._riskItRookPending, undefined);

  const update = roomEvents.find((e) => e.name === 'mutatorBoardUpdate');
  assert.ok(update);
  assert.ok(update.payload.mutatorState);
  assert.ok(update.payload.riskItRookFlip);
  assert.equal(update.payload.riskItRookFlip.chooserColor, 'w');
  assert.equal(update.payload.riskItRookFlip.opponentColor, 'b');
  assert.equal(update.payload.riskItRookFlip.chooserFlip, 'heads');
  assert.equal(update.payload.riskItRookFlip.opponentFlip1, 'heads');
  assert.equal(update.payload.riskItRookFlip.opponentFlip2, 'heads');
  assert.notEqual(update.payload.riskItRookFlip.chooserSquare, null);
  assert.notEqual(update.payload.riskItRookFlip.opponentSquare, null);

  const chooserPiece = room.chess.get(update.payload.riskItRookFlip.chooserSquare);
  const opponentPiece = room.chess.get(update.payload.riskItRookFlip.opponentSquare);
  assert.deepEqual(chooserPiece, { type: 'r', color: 'w' });
  assert.deepEqual(opponentPiece, { type: 'r', color: 'b' });

  assert.equal(room._riskItRookResult, undefined);
});

test('chooser tails still collects opponent flips and never places chooser rook', () => {
  const { room, whiteSocket, blackSocket, roomEvents } = setupRiskItRookRoom({
    roomCode: 'RIRK-G',
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
  });
  beginRiskItRookManualFlow(room, whiteSocket);

  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    whiteSocket.trigger('riskItRookFlipChoice', { choice: 'tails' });
    blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
    blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
  } finally {
    Math.random = originalRandom;
  }

  const update = roomEvents.find((e) => e.name === 'mutatorBoardUpdate');
  assert.ok(update);
  assert.equal(update.payload.riskItRookFlip.chooserFlip, 'tails');
  assert.equal(update.payload.riskItRookFlip.chooserSquare, null);
  assert.notEqual(update.payload.riskItRookFlip.opponentSquare, null);
});

test('opponent failed second flip yields no opponent rook', () => {
  const { room, whiteSocket, blackSocket, roomEvents } = setupRiskItRookRoom({
    roomCode: 'RIRK-H',
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
  });
  beginRiskItRookManualFlow(room, whiteSocket);

  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    whiteSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
    blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
    blackSocket.trigger('riskItRookFlipChoice', { choice: 'tails' });
  } finally {
    Math.random = originalRandom;
  }

  const update = roomEvents.find((e) => e.name === 'mutatorBoardUpdate');
  assert.ok(update);
  assert.notEqual(update.payload.riskItRookFlip.chooserSquare, null);
  assert.equal(update.payload.riskItRookFlip.opponentSquare, null);
});

test('late duplicate flip choices after completion are ignored', () => {
  const { room, whiteSocket, blackSocket, roomEvents } = setupRiskItRookRoom({ roomCode: 'RIRK-I', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' });
  beginRiskItRookManualFlow(room, whiteSocket);

  whiteSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
  blackSocket.trigger('riskItRookFlipChoice', { choice: 'tails' });
  blackSocket.trigger('riskItRookFlipChoice', { choice: 'tails' });

  const beforeFen = room.chess.fen();
  const updatesBefore = roomEvents.filter((e) => e.name === 'mutatorBoardUpdate').length;
  whiteSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
  blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });

  assert.equal(room.chess.fen(), beforeFen);
  assert.equal(roomEvents.filter((e) => e.name === 'mutatorBoardUpdate').length, updatesBefore);
  assert.equal(room._riskItRookPending, undefined);
});

test('unmapped socket is ignored for riskItRookFlipChoice', () => {
  const { room, gameManager, whiteSocket, io, roomEvents } = setupRiskItRookRoom({ roomCode: 'RIRK-J' });
  beginRiskItRookManualFlow(room, whiteSocket);

  const rogueSocket = createRegisteredSocket('sock-rogue');
  io.sockets.sockets.set('sock-rogue', rogueSocket);
  const handlers = createMutatorHandlers({
    handleMove: async () => {},
    scheduleBotMove: () => {},
    generateBotTarget: () => null,
  });
  handlers.registerSocketHandlers(rogueSocket, io, gameManager);

  rogueSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });

  assert.equal(room._riskItRookPending.phase, 'chooser');
  assert.deepEqual(room._riskItRookPending.flips, {});
  assert.equal(roomEvents.some((e) => e.name === 'riskItRookFlipResult'), false);
});

test('no pending risk it rook flow ignores riskItRookFlipChoice', () => {
  const { room, whiteSocket, roomEvents } = setupRiskItRookRoom({ roomCode: 'RIRK-K' });

  whiteSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });

  assert.equal(room._riskItRookPending, undefined);
  assert.equal(roomEvents.length, 0);
});


test('riskItRookFlipResult emits deterministic phase sequence during manual flow', () => {
  const { room, whiteSocket, blackSocket, roomEvents } = setupRiskItRookRoom({ roomCode: 'RIRK-L' });
  beginRiskItRookManualFlow(room, whiteSocket);

  whiteSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });
  blackSocket.trigger('riskItRookFlipChoice', { choice: 'tails' });
  blackSocket.trigger('riskItRookFlipChoice', { choice: 'heads' });

  const flipResults = roomEvents.filter((e) => e.name === 'riskItRookFlipResult');
  assert.equal(flipResults.length, 3);
  assert.deepEqual(flipResults.map((e) => e.payload), [
    { phase: 'chooser', result: 'heads', forPlayer: 'w', manual: true },
    { phase: 'opponent1', result: 'tails', forPlayer: 'b', manual: true },
    { phase: 'opponent2', result: 'heads', forPlayer: 'b', manual: true },
  ]);
});
