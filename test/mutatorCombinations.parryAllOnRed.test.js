const test = require('node:test');
const assert = require('node:assert/strict');

const { handleMove } = require('../handlers/moveHandler');
const { createMutatorHandlers } = require('../handlers/mutatorHandler');
const { GameManager, GameRoom } = require('../gameManager');
const turnClock = require('../utils/turnClock');
const { RULES } = require('../mutators/mutatorDefs');
const {
  createIoRecorder,
  createRegisteredSocket,
} = require('./helpers/moveHandlerTestHelpers');

const roomsToCleanup = new Set();

function getRule(id) {
  const rule = RULES.find((r) => r.id === id);
  assert.ok(rule, `expected rule ${id} to exist`);
  return rule;
}

async function triggerAndSettle(socket, eventName, payload) {
  socket.trigger(eventName, payload);
  await Promise.resolve();
  await Promise.resolve();
}

function setupRoom({ roomCode, fen, turn = 'w', manualCoinFlip = true }) {
  const gameManager = new GameManager();
  const room = new GameRoom(roomCode);
  room.manualCoinFlip = manualCoinFlip;
  room.addPlayer({ name: 'White', color: 'w', socketId: 'sock-w', isBot: false });
  room.addPlayer({ name: 'Black', color: 'b', socketId: 'sock-b', isBot: false });
  room.startGame();
  room.chess.load(fen, { skipValidation: true });
  if (turn !== room.chess.turn()) {
    const [pieces, , castling, ep, half, full] = room.chess.fen().split(' ');
    room.chess.load(`${pieces} ${turn} ${castling} ${ep} ${half} ${full}`, { skipValidation: true });
  }

  room.mutatorState.activeRules.push({ rule: getRule('parry') });
  room.mutatorState.activeRules.push({ rule: getRule('all_on_red'), chooser: 'w', remainingMoves: 3 });

  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);
  gameManager.setSocketRoom('sock-b', room.roomCode);

  const whiteSocket = createRegisteredSocket('sock-w');
  const blackSocket = createRegisteredSocket('sock-b');
  const { io, roomEvents } = createIoRecorder();
  io.sockets.sockets.set('sock-w', whiteSocket);
  io.sockets.sockets.set('sock-b', blackSocket);

  const handlers = createMutatorHandlers({
    handleMove,
    scheduleBotMove: () => {},
    generateBotTarget: () => null,
  });
  handlers.registerSocketHandlers(whiteSocket, io, gameManager);
  handlers.registerSocketHandlers(blackSocket, io, gameManager);

  roomsToCleanup.add(room);

  return { gameManager, room, whiteSocket, blackSocket, io, roomEvents };
}

test.afterEach(() => {
  for (const room of roomsToCleanup) turnClock.clearClock(room);
  roomsToCleanup.clear();
});

test('all_on_red heads allows non-king Parry capture attempt to create pendingRPS', async () => {
  const { gameManager, room, whiteSocket, io, roomEvents } = setupRoom({
    roomCode: 'PAR1A-1',
    fen: '4k3/8/8/8/8/8/3p4/3QK3 w - - 0 1',
  });
  const before = room.chess.fen();
  room.mutatorState.coinFlipResult = { result: 'heads', moveCount: room.mutatorState.moveCount };

  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });

  assert.ok(room.mutatorState.pendingRPS);
  assert.equal(roomEvents.filter((e) => e.name === 'rpsPrompt').length, 1);
  assert.equal(roomEvents.some((e) => e.name === 'moveApplied'), false);
  assert.equal(roomEvents.some((e) => e.name === 'coinFlipPrompt'), false);
  assert.equal(room.mutatorState.pendingCoinFlip, null);
  assert.equal(room.chess.fen(), before);
});

test('all_on_red tails blocks non-king capture before Parry can start', async () => {
  const { gameManager, room, whiteSocket, io, roomEvents } = setupRoom({
    roomCode: 'PAR1A-2',
    fen: '4k3/8/8/8/8/8/3p4/3QK3 w - - 0 1',
  });
  const before = room.chess.fen();
  room.mutatorState.coinFlipResult = { result: 'tails', moveCount: room.mutatorState.moveCount };

  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });

  const rejection = whiteSocket.emitted.find((e) => e.name === 'moveRejected');
  assert.ok(rejection);
  assert.equal(rejection.payload.error, 'Move blocked by active rule.');
  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(roomEvents.some((e) => e.name === 'rpsPrompt'), false);
  assert.equal(roomEvents.some((e) => e.name === 'moveApplied'), false);
  assert.equal(room.chess.fen(), before);
});

test('all_on_red tails allows legal king capture to create pendingRPS', async () => {
  const { gameManager, room, whiteSocket, io, roomEvents } = setupRoom({
    roomCode: 'PAR1A-3',
    fen: '4k3/8/8/8/8/8/3p4/3K4 w - - 0 1',
  });
  const before = room.chess.fen();
  room.mutatorState.coinFlipResult = { result: 'tails', moveCount: room.mutatorState.moveCount };

  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });

  assert.ok(room.mutatorState.pendingRPS);
  assert.equal(roomEvents.filter((e) => e.name === 'rpsPrompt').length, 1);
  assert.equal(roomEvents.some((e) => e.name === 'moveApplied'), false);
  assert.equal(room.chess.fen(), before);
});

test('pendingRPS blocks movement before pendingCoinFlip', async () => {
  const { gameManager, room, whiteSocket, io } = setupRoom({
    roomCode: 'PAR1A-4',
    fen: '4k3/8/8/8/8/8/3p4/3QK3 w - - 0 1',
  });
  const before = room.chess.fen();
  room.mutatorState.pendingRPS = {
    attacker: 'w', defender: 'b', attackerSocketId: 'sock-w', defenderSocketId: 'sock-b',
    move: { from: 'd1', to: 'd2', promotion: null }, attackerChoice: null, defenderChoice: null,
  };
  room.mutatorState.pendingCoinFlip = { forPlayer: 'w', moveCount: room.mutatorState.moveCount };

  await handleMove(io, whiteSocket, gameManager, { from: 'e1', to: 'e2' });

  const rejection = whiteSocket.emitted.find((e) => e.name === 'moveRejected');
  assert.ok(rejection);
  assert.equal(rejection.payload.message, 'Waiting for RPS resolution.');
  assert.ok(room.mutatorState.pendingRPS);
  assert.ok(room.mutatorState.pendingCoinFlip);
  assert.equal(room.chess.fen(), before);
});

test('pendingCoinFlip blocks affected player when no RPS is pending', async () => {
  const { gameManager, room, whiteSocket, io, roomEvents } = setupRoom({
    roomCode: 'PAR1A-5',
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
  });
  const before = room.chess.fen();
  room.mutatorState.pendingRPS = null;
  room.mutatorState.pendingCoinFlip = { forPlayer: 'w', moveCount: room.mutatorState.moveCount };

  await handleMove(io, whiteSocket, gameManager, { from: 'e1', to: 'd1' });

  const rejection = whiteSocket.emitted.find((e) => e.name === 'moveRejected');
  assert.ok(rejection);
  assert.equal(rejection.payload.message, 'Flip the coin first!');
  assert.equal(roomEvents.some((e) => e.name === 'rpsPrompt'), false);
  assert.equal(room.chess.fen(), before);
});

test('pendingCoinFlip does not block unaffected player when no RPS is pending', async () => {
  const { gameManager, room, blackSocket, io, roomEvents } = setupRoom({
    roomCode: 'PAR1A-6',
    fen: '4k3/8/8/8/8/8/8/4K3 b - - 0 1',
    turn: 'b',
  });
  room.mutatorState.pendingRPS = null;
  room.mutatorState.pendingCoinFlip = { forPlayer: 'w', moveCount: room.mutatorState.moveCount };

  await handleMove(io, blackSocket, gameManager, { from: 'e8', to: 'd8' });

  assert.ok(roomEvents.find((e) => e.name === 'moveApplied'));
  assert.equal(blackSocket.emitted.some((e) => e.name === 'moveRejected'), false);
  assert.deepEqual(room.mutatorState.pendingCoinFlip, { forPlayer: 'w', moveCount: room.mutatorState.moveCount });
  assert.equal(roomEvents.some((e) => e.name === 'rpsPrompt'), false);
});

test('Part 1B attacker-win RPS under all_on_red resolves capture exactly once', async () => {
  const { gameManager, room, whiteSocket, blackSocket, io, roomEvents } = setupRoom({
    roomCode: 'PAR1B-1',
    fen: '4k3/8/8/8/8/8/3p4/3QK3 w - - 0 1',
  });
  room.mutatorState.coinFlipResult = { result: 'heads', moveCount: room.mutatorState.moveCount };
  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });
  assert.ok(room.mutatorState.pendingRPS);

  await triggerAndSettle(whiteSocket, 'rpsChoice', { choice: 'rock' });
  await triggerAndSettle(blackSocket, 'rpsChoice', { choice: 'scissors' });

  assert.equal(room.mutatorState.pendingRPS, null);
  assert.notEqual(room.mutatorState.rpsResolved, true);
  assert.equal(room.chess.get('d1'), undefined);
  assert.equal(room.chess.get('d2').type, 'q');
  assert.equal(room.chess.turn(), 'b');
  assert.equal(roomEvents.filter((e) => e.name === 'rpsPrompt').length, 1);
  assert.equal(roomEvents.filter((e) => e.name === 'moveApplied').length, 1);
});

test('Part 1B defender-win RPS under all_on_red blocks capture exactly once', async () => {
  const { gameManager, room, whiteSocket, blackSocket, io, roomEvents } = setupRoom({ roomCode:'PAR1B-2', fen:'4k3/8/8/8/8/8/3p4/3QK3 w - - 0 1' });
  room.mutatorState.coinFlipResult = { result: 'heads', moveCount: room.mutatorState.moveCount };
  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });
  assert.ok(room.mutatorState.pendingRPS);
  await triggerAndSettle(blackSocket, 'rpsChoice', { choice: 'paper' });
  await triggerAndSettle(whiteSocket, 'rpsChoice', { choice: 'rock' });
  assert.equal(room.mutatorState.pendingRPS, null);
  assert.notEqual(room.mutatorState.rpsResolved, true);
  assert.equal(room.chess.get('d1').type, 'q');
  assert.equal(room.chess.get('d2').type, 'p');
  assert.equal(room.chess.turn(), 'b');
  const moveApplied = roomEvents.filter((e) => e.name === 'moveApplied');
  assert.equal(moveApplied.length, 1);
  assert.equal(moveApplied[0].payload.san, '(blocked)');
  assert.equal(moveApplied[0].payload.skipTurn, true);
  assert.equal(room.mutatorState.pendingAction, null);
  assert.equal(room.mutatorState.pendingSecondAction, null);
  assert.equal(room.mutatorState.pendingChoice, null);
});

test('Part 1B manual all_on_red after attacker-win RPS creates pending coin flip for next player', async () => {
  const { gameManager, room, whiteSocket, blackSocket, io, roomEvents } = setupRoom({ roomCode:'PAR1B-3', fen:'4k3/8/8/8/8/8/3p4/3QK3 w - - 0 1', manualCoinFlip:true });
  room.mutatorState.coinFlipResult = { result: 'heads', moveCount: room.mutatorState.moveCount };
  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });
  await triggerAndSettle(whiteSocket, 'rpsChoice', { choice: 'rock' });
  await triggerAndSettle(blackSocket, 'rpsChoice', { choice: 'scissors' });
  assert.deepEqual(room.mutatorState.pendingCoinFlip, { forPlayer: 'b', moveCount: room.mutatorState.moveCount });
  assert.equal(roomEvents.filter((e) => e.name === 'coinFlipPrompt').length, 1);
});

test('Part 1B auto all_on_red after attacker-win RPS creates exactly one new coinFlip result', async () => {
  const origRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const { gameManager, room, whiteSocket, blackSocket, io, roomEvents } = setupRoom({ roomCode:'PAR1B-4', fen:'4k3/8/8/8/8/8/3p4/3QK3 w - - 0 1', manualCoinFlip:false });
    room.mutatorState.coinFlipResult = { result: 'heads', moveCount: room.mutatorState.moveCount };
    const before = room.mutatorState.coinFlipResult;
    await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });
    await triggerAndSettle(whiteSocket, 'rpsChoice', { choice: 'rock' });
    await triggerAndSettle(blackSocket, 'rpsChoice', { choice: 'scissors' });
    assert.notDeepEqual(room.mutatorState.coinFlipResult, before);
    assert.deepEqual(room.mutatorState.coinFlipResult, { result: 'tails', moveCount: 1 });
    assert.equal(roomEvents.filter((e) => e.name === 'coinFlip').length, 1);
    assert.equal(roomEvents.filter((e) => e.name === 'coinFlipResult').length, 0);
  } finally {
    Math.random = origRandom;
  }
});

test('Part 1B attacker-win event ordering: rpsPrompt before rpsResult before moveApplied', async () => {
  const { gameManager, room, whiteSocket, blackSocket, io, roomEvents } = setupRoom({ roomCode:'PAR1B-5', fen:'4k3/8/8/8/8/8/3p4/3QK3 w - - 0 1' });
  room.mutatorState.coinFlipResult = { result: 'heads', moveCount: room.mutatorState.moveCount };
  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });
  await triggerAndSettle(whiteSocket, 'rpsChoice', { choice: 'rock' });
  await triggerAndSettle(blackSocket, 'rpsChoice', { choice: 'scissors' });

  const promptIndex = roomEvents.findIndex((e) => e.name === 'rpsPrompt');
  const resultIndex = roomEvents.findIndex((e) => e.name === 'rpsResult');
  const moveIndex = roomEvents.findIndex((e) => e.name === 'moveApplied');
  assert.ok(promptIndex > -1 && resultIndex > -1 && moveIndex > -1);
  assert.ok(promptIndex < resultIndex);
  assert.ok(resultIndex < moveIndex);

  const coinFlipPromptIndex = roomEvents.findIndex((e) => e.name === 'coinFlipPrompt');
  const coinFlipIndex = roomEvents.findIndex((e) => e.name === 'coinFlip');
  if (coinFlipPromptIndex !== -1) assert.ok(moveIndex < coinFlipPromptIndex);
  if (coinFlipIndex !== -1) assert.ok(moveIndex < coinFlipIndex);
});

test.skip('Parry + All on Red game-end overlap deferred: no compact deterministic fixture yet', () => {});
