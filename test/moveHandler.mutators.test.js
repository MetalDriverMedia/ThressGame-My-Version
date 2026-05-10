const test = require('node:test');
const assert = require('node:assert/strict');

const { handleMove } = require('../handlers/moveHandler');
const { safeMovePiece } = require('../mutators/ruleHooks');
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

test('bottomless pit still destroys non-king pieces on entry', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT32');
  room.chess.load('4k3/8/8/8/8/8/3P4/4K3 w - - 0 1');
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'd3' }];
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io, roomEvents } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'd2', to: 'd3' });

  assert.equal(room.chess.get('d3'), undefined);
  const endedEvents = roomEvents.filter(e => e.name === 'gameEnded');
  if (endedEvents.length > 0) {
    assert.equal(endedEvents[0].payload.reason, 'insufficient-material');
  }
});

test('bottomless pit destroys a king that enters and ends the game once', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT33');
  room.chess.load('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'e2' }];
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io, roomEvents } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'e1', to: 'e2' });

  assert.equal(room.chess.get('e2'), undefined);
  assert.equal(room.status, 'ended');
  const endedEvents = roomEvents.filter(e => e.name === 'gameEnded');
  assert.equal(endedEvents.length, 1);
  assert.equal(endedEvents[0].payload.reason, 'king-destroyed');
  assert.equal(endedEvents[0].payload.winner, 'b');
  assert.equal(endedEvents[0].payload.loser, 'w');
  assert.ok(room._turnExpireTimer == null);
});

test('king can move from check onto a bottomless pit and is destroyed', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT34');
  room.chess.load('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1');
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'd1' }];
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io, roomEvents } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'e1', to: 'd1' });

  assert.equal(room.chess.get('d1'), undefined);
  assert.equal(room.status, 'ended');
  const ended = roomEvents.filter(e => e.name === 'gameEnded');
  assert.equal(ended.length, 1);
  assert.equal(ended[0].payload.reason, 'king-destroyed');
  assert.equal(ended[0].payload.winner, 'b');
});

test('safeMovePiece path destroys king on bottomless pit (shared soft-restriction path)', () => {
  const room = createActiveRoomWithPlayers('MVT35');
  room.chess.load('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  room.mutatorState.boardModifiers.bottomlessPits = [{ square: 'e2' }];

  const board = new Map([['e1', { type: 'k', color: 'w' }], ['e8', { type: 'k', color: 'b' }]]);
  const finalSquare = safeMovePiece(room, board, 'e1', 'e2');

  assert.equal(finalSquare, 'e2');
  assert.equal(board.get('e2'), undefined);
});
