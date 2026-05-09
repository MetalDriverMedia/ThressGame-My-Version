const test = require('node:test');
const assert = require('node:assert/strict');

const { handleMove } = require('../handlers/moveHandler');
const { GameManager, GameRoom } = require('../gameManager');
const { RULES } = require('../mutators/mutatorDefs');
const {
  createIoRecorder,
  createRegisteredSocket,
} = require('./helpers/moveHandlerTestHelpers');

function getRule(id) {
  const rule = RULES.find((r) => r.id === id);
  assert.ok(rule, `expected rule ${id} to exist`);
  return rule;
}

function setupRoom({ roomCode, fen, turn = 'w' }) {
  const gameManager = new GameManager();
  const room = new GameRoom(roomCode);
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

  return { gameManager, room, whiteSocket, blackSocket, io, roomEvents };
}

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

test.skip('Parry + All on Red post-RPS resolution deferred to Part 1B async harness coverage', () => {});
