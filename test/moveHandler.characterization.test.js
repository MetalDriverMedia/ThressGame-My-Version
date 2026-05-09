const test = require('node:test');
const assert = require('node:assert/strict');

const { handleMove } = require('../handlers/moveHandler');
const { GameManager, GameRoom } = require('../gameManager');

function createIoRecorder() {
  const roomEvents = [];
  return {
    roomEvents,
    io: {
      to(roomCode) {
        return {
          emit(name, payload) {
            roomEvents.push({ roomCode, name, payload });
          },
        };
      },
      sockets: { sockets: new Map() },
    },
  };
}

function createSocket(id = 'sock-w') {
  const emitted = [];
  return {
    id,
    emitted,
    emit(name, payload) {
      emitted.push({ name, payload });
    },
  };
}

function createActiveRoomWithPlayers(roomCode = 'MVT01') {
  const room = new GameRoom(roomCode);
  room.addPlayer({ name: 'White', color: 'w', socketId: 'sock-w', isBot: false });
  room.addPlayer({ name: 'Black', color: 'b', socketId: 'sock-b', isBot: true });
  room.startGame();
  return room;
}

test('handleMove accepts a normal legal move and emits moveApplied', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT11');
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io, roomEvents } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'e2', to: 'e4' });

  assert.equal(socket.emitted.length, 0);
  assert.equal(room.chess.get('e4').type, 'p');
  assert.equal(room.chess.get('e2'), null);
  assert.equal(room.chess.turn(), 'b');

  const moveApplied = roomEvents.find(e => e.name === 'moveApplied');
  assert.ok(moveApplied);
  assert.equal(moveApplied.payload.from, 'e2');
  assert.equal(moveApplied.payload.to, 'e4');
  assert.equal(moveApplied.payload.color, 'w');
});

test('handleMove rejects illegal player moves', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT12');
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io, roomEvents } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'e2', to: 'e5' });

  assert.equal(room.chess.get('e2').type, 'p');
  assert.equal(room.chess.get('e5'), null);
  assert.deepEqual(socket.emitted[0], { name: 'moveRejected', payload: { error: 'Illegal move.' } });
  assert.equal(roomEvents.some(e => e.name === 'moveApplied'), false);
});

test('handleMove rejects wrong turn / wrong color moves', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT13');
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-b', room.roomCode);

  const socket = createSocket('sock-b');
  const { io } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'e7', to: 'e5' });

  assert.deepEqual(socket.emitted[0], { name: 'moveRejected', payload: { error: 'It is not your turn.' } });
});

test('handleMove rejects sockets that are not mapped to a room', async () => {
  const gameManager = new GameManager();
  const socket = createSocket('unknown-sock');
  const { io } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'e2', to: 'e4' });

  assert.deepEqual(socket.emitted[0], { name: 'moveRejected', payload: { error: 'You are not in a room.' } });
});

test('handleMove rejects move when room is inactive', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT14');
  room.status = 'ended';
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'e2', to: 'e4' });

  assert.deepEqual(socket.emitted[0], { name: 'moveRejected', payload: { error: 'Game is not active.' } });
});

test('handleMove respects mutator move restrictions (hobbit_battle)', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT15');
  room.chess.load('4k3/8/8/8/8/8/8/1N2K3 w - - 0 1');
  room.mutatorState.activeRules.push({ rule: { id: 'hobbit_battle' } });
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'b1', to: 'c3' });

  assert.deepEqual(socket.emitted[0], { name: 'moveRejected', payload: { error: 'Move blocked by active rule.' } });
});

test('handleMove uses default queen promotion when no promotion piece provided', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT16');
  room.chess.load('4k3/6P1/8/8/8/8/8/4K3 w - - 0 1');
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'g7', to: 'g8' });

  const piece = room.chess.get('g8');
  assert.ok(piece);
  assert.equal(piece.type, 'q');
  assert.equal(piece.color, 'w');
});
