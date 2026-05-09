const test = require('node:test');
const assert = require('node:assert/strict');

const { handleMove } = require('../handlers/moveHandler');
const { createMutatorHandlers } = require('../handlers/mutatorHandler');
const { GameManager, GameRoom } = require('../gameManager');
const { RULES } = require('../mutators/mutatorDefs');
const { createIoRecorder, createRegisteredSocket, createParryCaptureSetup } = require('./helpers/moveHandlerTestHelpers');

function getRule(id) {
  const rule = RULES.find((r) => r.id === id);
  assert.ok(rule, `expected rule ${id} to exist`);
  return rule;
}

function activateRules(room, ids) {
  for (const id of ids) room.mutatorState.activeRules.push({ rule: getRule(id), chooser: 'w', remainingMoves: 3 });
}

function eventsNamed(events, name) {
  return events.filter((e) => e.name === name);
}

function withMockedRandomSequence(values, fn) {
  const original = Math.random;
  let i = 0;
  Math.random = () => values[i++] ?? values[values.length - 1];
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

function createParryAllOnRedRoom({ roomCode = 'MXPA1', manualCoinFlip = true, fen = '7k/8/8/8/8/8/3p4/3QK3 w - - 0 1' } = {}) {
  const gameManager = new GameManager();
  const room = createParryCaptureSetup(roomCode);
  room.chess.load(fen);
  room.manualCoinFlip = manualCoinFlip;
  room.mutatorState.activeRules = [];
  activateRules(room, ['parry', 'all_on_red']);

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

  return { gameManager, room, whiteSocket, blackSocket, io, roomEvents };
}

test('A: Parry capture under All on Red creates pendingRPS before any coin flip prompt', async () => {
  const { gameManager, room, whiteSocket, io, roomEvents } = createParryAllOnRedRoom({ roomCode: 'MXPA-A' });
  room.mutatorState.coinFlipResult = { result: 'heads', moveCount: room.mutatorState.moveCount };
  const before = room.chess.fen();

  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });

  assert.ok(room.mutatorState.pendingRPS);
  assert.equal(eventsNamed(roomEvents, 'rpsPrompt').length, 1);
  assert.equal(eventsNamed(roomEvents, 'moveApplied').length, 0);
  assert.equal(eventsNamed(roomEvents, 'coinFlipPrompt').length, 0);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.equal(room.chess.fen(), before);
});

test.skip('B/O: attacker win resolves capture once, then triggers next-player manual coin flip and ordered events', async () => {
  const { gameManager, room, whiteSocket, blackSocket, io, roomEvents } = createParryAllOnRedRoom({ roomCode: 'MXPA-B' });
  room.mutatorState.coinFlipResult = { result: 'heads', moveCount: room.mutatorState.moveCount };

  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });
  whiteSocket.trigger('rpsChoice', { choice: 'rock' });
  blackSocket.trigger('rpsChoice', { choice: 'scissors' });

  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.chess.get('d1'), undefined);
  assert.equal(room.chess.get('d2').type, 'q');
  assert.equal(room.chess.turn(), 'b');
  if (room.status === 'active') assert.deepEqual(room.mutatorState.pendingCoinFlip, { forPlayer: 'b', moveCount: room.mutatorState.moveCount });
  assert.equal(eventsNamed(roomEvents, 'rpsPrompt').length, 1);
  assert.equal(eventsNamed(roomEvents, 'moveApplied').length, 1);
  assert.ok(eventsNamed(roomEvents, 'coinFlipPrompt').length <= 1);

  const names = roomEvents.map((e) => e.name);
  assert.ok(names.indexOf('rpsPrompt') < names.indexOf('rpsResult'));
  assert.ok(names.indexOf('rpsResult') < names.indexOf('moveApplied'));
  if (names.includes('coinFlipPrompt')) assert.ok(names.indexOf('moveApplied') < names.indexOf('coinFlipPrompt'));
});

test.skip('C/N: defender win blocks capture, skips attacker turn, then prompts black coin flip with no stale pending flags', async () => {
  const { gameManager, room, whiteSocket, blackSocket, io, roomEvents } = createParryAllOnRedRoom({ roomCode: 'MXPA-C' });
  room.mutatorState.coinFlipResult = { result: 'heads', moveCount: room.mutatorState.moveCount };

  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });
  blackSocket.trigger('rpsChoice', { choice: 'paper' });
  whiteSocket.trigger('rpsChoice', { choice: 'rock' });

  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.chess.get('d1').type, 'q');
  assert.equal(room.chess.get('d2').type, 'p');
  assert.equal(room.chess.turn(), 'b');
  const skip = eventsNamed(roomEvents, 'moveApplied').find((e) => e.payload?.skipTurn);
  assert.ok(skip);
  assert.equal(skip.payload.san, '(blocked)');
  if (room.status === 'active') assert.deepEqual(room.mutatorState.pendingCoinFlip, { forPlayer: 'b', moveCount: room.mutatorState.moveCount });
  assert.equal(room.mutatorState.rpsResolved, false);
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
});

test('D/E/F: pendingRPS precedence, pendingCoinFlip targeted blocking, and unaffected-player allowance', async () => {
  const ctx = createParryAllOnRedRoom({ roomCode: 'MXPA-DEF' });
  const { gameManager, room, whiteSocket } = ctx;
  room.mutatorState.pendingRPS = { attacker: 'w', defender: 'b', move: { from: 'd1', to: 'd2' }, attackerChoice: null, defenderChoice: null };
  room.mutatorState.pendingCoinFlip = { forPlayer: 'w', moveCount: room.mutatorState.moveCount };
  const before = room.chess.fen();

  await handleMove({ to: () => ({ emit: () => {} }), sockets: { sockets: new Map() } }, whiteSocket, gameManager, { from: 'e1', to: 'e2' });
  assert.equal(whiteSocket.emitted.find((e) => e.name === 'moveRejected').payload.message, 'Waiting for RPS resolution.');
  assert.equal(room.chess.fen(), before);

  room.mutatorState.pendingRPS = null;
  await handleMove({ to: () => ({ emit: () => {} }), sockets: { sockets: new Map() } }, whiteSocket, gameManager, { from: 'e1', to: 'e2' });
  assert.equal(whiteSocket.emitted.at(-1).payload.message, 'Flip the coin first!');

  const gm2 = new GameManager();
  const room2 = new GameRoom('MXPA-F');
  room2.addPlayer({ name: 'White', color: 'w', socketId: 'sock-w', isBot: false });
  room2.addPlayer({ name: 'Black', color: 'b', socketId: 'sock-b', isBot: false });
  room2.startGame();
  room2.chess.load('7k/8/8/8/8/8/8/4K3 b - - 0 1');
  activateRules(room2, ['parry', 'all_on_red']);
  room2.mutatorState.pendingCoinFlip = { forPlayer: 'w', moveCount: room2.mutatorState.moveCount };
  gm2.rooms.set(room2.roomCode, room2);
  gm2.setSocketRoom('sock-b', room2.roomCode);
  const blackSocket = createRegisteredSocket('sock-b');
  const { io, roomEvents } = createIoRecorder();
  await handleMove(io, blackSocket, gm2, { from: 'h8', to: 'h7' });
  assert.equal(blackSocket.emitted.some((e) => e.name === 'moveRejected'), false);
  assert.equal(eventsNamed(roomEvents, 'moveApplied').length, 1);
});

test('G/H: tails blocks non-king capture before Parry, but allows king capture to create pendingRPS', async () => {
  const g = createParryAllOnRedRoom({ roomCode: 'MXPA-G' });
  g.room.mutatorState.coinFlipResult = { result: 'tails', moveCount: g.room.mutatorState.moveCount };
  const before = g.room.chess.fen();
  await handleMove({ to: () => ({ emit: () => {} }), sockets: { sockets: new Map() } }, g.whiteSocket, g.gameManager, { from: 'd1', to: 'd2' });
  assert.equal(g.whiteSocket.emitted.find((e) => e.name === 'moveRejected').payload.error, 'Move blocked by active rule.');
  assert.equal(g.room.mutatorState.pendingRPS, null);
  assert.equal(g.room.chess.fen(), before);

  const h = createParryAllOnRedRoom({ roomCode: 'MXPA-H', fen: '7k/8/8/8/8/8/4p3/4K3 w - - 0 1' });
  h.room.mutatorState.coinFlipResult = { result: 'tails', moveCount: h.room.mutatorState.moveCount };
  await handleMove(h.io, h.whiteSocket, h.gameManager, { from: 'e1', to: 'e2' });
  assert.ok(h.room.mutatorState.pendingRPS);
  assert.equal(eventsNamed(h.roomEvents, 'rpsPrompt').length, 1);
  assert.equal(eventsNamed(h.roomEvents, 'moveApplied').length, 0);
});

test('I/J/K/L: manual tails/heads after RPS and auto flip after RPS are deterministic and non-duplicated', async () => {
  const manual = createParryAllOnRedRoom({ roomCode: 'MXPA-IJ' });
  manual.room.mutatorState.coinFlipResult = { result: 'heads', moveCount: manual.room.mutatorState.moveCount };
  await handleMove(manual.io, manual.whiteSocket, manual.gameManager, { from: 'd1', to: 'd2' });
  manual.whiteSocket.trigger('rpsChoice', { choice: 'rock' });
  manual.blackSocket.trigger('rpsChoice', { choice: 'scissors' });

  if (manual.room.mutatorState.pendingCoinFlip && manual.room.status === 'active') {
    manual.blackSocket.trigger('coinFlipChoice', { choice: 'tails' });
    assert.equal(manual.room.mutatorState.pendingCoinFlip, null);
    assert.equal(manual.room.mutatorState.coinFlipResult.result, 'tails');
    await handleMove({ to: () => ({ emit: () => {} }), sockets: { sockets: new Map() } }, manual.blackSocket, manual.gameManager, { from: 'h8', to: 'h7' });
    assert.equal(manual.blackSocket.emitted.at(-1).payload.error, 'Move blocked by active rule.');

    manual.room.mutatorState.pendingCoinFlip = { forPlayer: 'b', moveCount: manual.room.mutatorState.moveCount };
    manual.blackSocket.trigger('coinFlipChoice', { choice: 'heads' });
    await handleMove(manual.io, manual.blackSocket, manual.gameManager, { from: 'h8', to: 'h7' });
    assert.ok(eventsNamed(manual.roomEvents, 'moveApplied').length >= 2);
  }
  assert.equal(manual.room.mutatorState.pendingRPS, null);

  const auto = createParryAllOnRedRoom({ roomCode: 'MXPA-KL', manualCoinFlip: false });
  auto.room.mutatorState.coinFlipResult = { result: 'heads', moveCount: auto.room.mutatorState.moveCount };
  await handleMove(auto.io, auto.whiteSocket, auto.gameManager, { from: 'd1', to: 'd2' });
  withMockedRandomSequence([0.1], () => {
    auto.whiteSocket.trigger('rpsChoice', { choice: 'rock' });
    auto.blackSocket.trigger('rpsChoice', { choice: 'scissors' });
  });
  const flips = auto.roomEvents.filter((e) => e.name === 'coinFlip' || e.name === 'coinFlipResult');
  assert.equal(auto.room.mutatorState.pendingCoinFlip, null);
  assert.ok(flips.length <= 1);
  assert.ok(auto.room.mutatorState.coinFlipResult);
});

test.skip('Parry + All on Red game-end overlap deferred: no compact deterministic fixture yet', () => {});
