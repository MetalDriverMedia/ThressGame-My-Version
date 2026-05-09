const test = require('node:test');
const assert = require('node:assert/strict');

const { handleMove } = require('../handlers/moveHandler');
const { GameManager } = require('../gameManager');
const {
  createIoRecorder,
  createSocket,
  createActiveRoomWithPlayers,
} = require('./helpers/moveHandlerTestHelpers');

test('handleMove rejects sockets mapped to room but not present as room player', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT19');
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-ghost', room.roomCode);

  const socket = createSocket('sock-ghost');
  const { io } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'e2', to: 'e4' });

  assert.deepEqual(socket.emitted[0], { name: 'moveRejected', payload: { error: 'Player not found in room.' } });
});

test('handleMove rejects moving from an empty square', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT20');
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'e3', to: 'e4' });

  assert.deepEqual(socket.emitted[0], { name: 'moveRejected', payload: { error: 'No piece on that square.' } });
});

test('handleMove rejects moving an opponent piece on your turn', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT21');
  room.chess.load('4k3/8/8/8/8/8/8/r3K3 w - - 0 1');
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'a1', to: 'a2' });

  assert.deepEqual(socket.emitted[0], { name: 'moveRejected', payload: { error: 'That piece does not belong to you.' } });
});

test('handleMove rejects invalid square notation', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT22');
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'e9', to: 'e4' });

  assert.deepEqual(socket.emitted[0], { name: 'moveRejected', payload: { error: 'Invalid square notation.' } });
});

test('handleMove blocks pending mutator choice for chooser', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT23');
  room.mutatorState.pendingChoice = { chooser: 'w', options: [] };
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'e2', to: 'e4' });

  assert.deepEqual(socket.emitted[0], { name: 'moveRejected', payload: { message: 'Choose a rule before making your move.' } });
});

test('handleMove blocks moves while pending mutator action exists', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT24');
  room.mutatorState.pendingAction = { type: 'select' };
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'e2', to: 'e4' });

  assert.deepEqual(socket.emitted[0], { name: 'moveRejected', payload: { message: 'Complete the rule selection first.' } });
});

test('handleMove blocks moves while pending second mutator action exists', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT28');
  room.mutatorState.pendingSecondAction = { type: 'followup' };
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'e2', to: 'e4' });

  assert.deepEqual(socket.emitted[0], { name: 'moveRejected', payload: { message: 'Complete the rule selection first.' } });
});

test('handleMove blocks moves while pending RPS exists', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT25');
  room.mutatorState.pendingRPS = { attacker: 'w', defender: 'b' };
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'e2', to: 'e4' });

  assert.deepEqual(socket.emitted[0], { name: 'moveRejected', payload: { message: 'Waiting for RPS resolution.' } });
});

test('handleMove blocks pending coin flip for affected player only', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT26');
  room.mutatorState.pendingCoinFlip = { forPlayer: 'w' };
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'e2', to: 'e4' });

  assert.deepEqual(socket.emitted[0], { name: 'moveRejected', payload: { message: 'Flip the coin first!' } });
});

test('handleMove allows unaffected player to move when coin flip is pending for opponent', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT29');
  room.mutatorState.pendingCoinFlip = { forPlayer: 'b' };
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io, roomEvents } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'e2', to: 'e4' });

  assert.equal(socket.emitted.length, 0);
  assert.equal(room.chess.get('e4').type, 'p');
  assert.equal(room.chess.get('e2'), undefined);
  assert.equal(roomEvents.some(e => e.name === 'moveApplied'), true);
});

test('handleMove blocks movement from locked square in board modifiers', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT27');
  room.mutatorState.boardModifiers = { lockedSquares: [{ square: 'e2' }] };
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'e2', to: 'e4' });

  assert.deepEqual(socket.emitted[0], {
    name: 'moveRejected',
    payload: { message: "That piece can't move on the same turn it was placed." },
  });
});
