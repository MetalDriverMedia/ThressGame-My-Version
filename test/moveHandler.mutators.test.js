const test = require('node:test');
const assert = require('node:assert/strict');

const { handleMove } = require('../handlers/moveHandler');
const { GameManager } = require('../gameManager');
const {
  createIoRecorder,
  createSocket,
  createActiveRoomWithPlayers,
} = require('./helpers/moveHandlerTestHelpers');

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

test('handleMove triggers Parry RPS flow on legal capture and defers move application', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT27');
  room.chess.load('4k3/8/8/8/8/8/3p4/3QK3 w - - 0 1');
  room.mutatorState.activeRules.push({ rule: { id: 'parry' } });
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io, roomEvents } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'd1', to: 'd2' });

  assert.equal(socket.emitted.length, 0);
  assert.ok(room.mutatorState.pendingRPS);
  assert.deepEqual(room.mutatorState.pendingRPS.move, { from: 'd1', to: 'd2', promotion: null });
  assert.equal(room.chess.get('d1').type, 'q');
  assert.equal(room.chess.get('d2').type, 'p');
  assert.equal(roomEvents.some(e => e.name === 'moveApplied'), false);

  const rpsPrompt = roomEvents.find(e => e.name === 'rpsPrompt');
  assert.ok(rpsPrompt);
  assert.deepEqual(rpsPrompt.payload, { attacker: 'w', defender: 'b' });
});

test('handleMove accepts a Pacman wrap move via board-move path and emits moveApplied', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT28');
  room.chess.load('4k3/8/7n/P7/8/8/8/4K3 w - - 0 1');
  room.mutatorState.activeRules.push({ rule: { id: 'pacman_style' } });
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io, roomEvents } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'a5', to: 'h6' });

  assert.equal(socket.emitted.length, 0);
  assert.equal(room.chess.get('a5'), undefined);
  assert.equal(room.chess.get('h6').type, 'p');
  assert.equal(room.chess.get('h6').color, 'w');
  assert.equal(room.chess.turn(), 'b');

  const moveApplied = roomEvents.find(e => e.name === 'moveApplied');
  assert.ok(moveApplied);
  assert.equal(moveApplied.payload.from, 'a5');
  assert.equal(moveApplied.payload.to, 'h6');
  assert.equal(moveApplied.payload.color, 'w');
});

test('handleMove accepts a custom synthetic move from short_stop after isMoveAllowed migration', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT29');
  room.chess.load('7k/8/8/8/8/8/8/1N2K3 w - - 0 1');
  room.mutatorState.activeRules.push({ rule: { id: 'short_stop' } });
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io, roomEvents } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'b1', to: 'b2' });

  assert.equal(socket.emitted.length, 0);
  assert.equal(room.chess.get('b1'), undefined);
  assert.equal(room.chess.get('b2').type, 'n');
  assert.equal(room.chess.get('b2').color, 'w');
  assert.equal(room.chess.turn(), 'b');

  const moveApplied = roomEvents.find(e => e.name === 'moveApplied');
  assert.ok(moveApplied);
  assert.equal(moveApplied.payload.from, 'b1');
  assert.equal(moveApplied.payload.to, 'b2');
});

test('handleMove rejects a chess.js-legal move that leaves king in mutator-aware self-check', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT30');
  room.chess.load('7k/8/8/8/8/8/4n3/R3K3 w - - 0 1');
  room.mutatorState.activeRules.push({ rule: { id: 'short_stop' } });
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io, roomEvents } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'a1', to: 'a2' });

  assert.deepEqual(socket.emitted[0], { name: 'moveRejected', payload: { error: 'That move would leave your king in check.' } });
  assert.equal(room.chess.get('a1').type, 'r');
  assert.equal(room.chess.get('a2'), undefined);
  assert.equal(roomEvents.some(e => e.name === 'moveApplied'), false);
});

test('handleMove applies pseudo-legal board move through fake-check fallback when mutator-aware check is clear', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT31');
  room.chess.load('7k/8/8/8/8/8/8/R3K3 w - - 0 1');
  room.mutatorState.activeRules.push({ rule: { id: 'short_stop' } });
  const originalInCheck = room.chess.inCheck.bind(room.chess);
  room.chess.inCheck = () => true;
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io, roomEvents } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'a1', to: 'a2' });

  room.chess.inCheck = originalInCheck;

  assert.equal(socket.emitted.length, 0);
  assert.equal(room.chess.get('a1'), undefined);
  assert.equal(room.chess.get('a2').type, 'r');
  assert.equal(room.chess.turn(), 'b');

  const moveApplied = roomEvents.find(e => e.name === 'moveApplied');
  assert.ok(moveApplied);
  assert.equal(moveApplied.payload.from, 'a1');
  assert.equal(moveApplied.payload.to, 'a2');
});
