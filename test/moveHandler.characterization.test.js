const test = require('node:test');
const assert = require('node:assert/strict');

const { handleMove } = require('../handlers/moveHandler');
const { createMutatorHandlers } = require('../handlers/mutatorHandler');
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


function createRegisteredSocket(id = 'sock-w') {
  const handlers = new Map();
  const emitted = [];
  return {
    id,
    emitted,
    on(name, fn) { handlers.set(name, fn); },
    emit(name, payload) { emitted.push({ name, payload }); },
    to() { return { emit() {} }; },
    trigger(name, payload) {
      const fn = handlers.get(name);
      if (fn) fn(payload);
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
  assert.equal(room.chess.get('e2'), undefined);
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
  assert.equal(room.chess.get('e5'), undefined);
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

test('handleMove honors explicit promotion piece and preserves moveApplied payload shape', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT17');
  room.chess.load('4k3/6P1/8/8/8/8/8/4K3 w - - 0 1');
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io, roomEvents } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'g7', to: 'g8', promotion: 'n' });

  const piece = room.chess.get('g8');
  assert.ok(piece);
  assert.equal(piece.type, 'n');
  assert.equal(piece.color, 'w');

  const moveApplied = roomEvents.find(e => e.name === 'moveApplied');
  assert.ok(moveApplied);
  assert.equal(moveApplied.payload.from, 'g7');
  assert.equal(moveApplied.payload.to, 'g8');
  assert.equal(moveApplied.payload.color, 'w');
  assert.equal(moveApplied.payload.piece, 'p');
  assert.equal(moveApplied.payload.promotion, 'n');
  assert.ok(typeof moveApplied.payload.san === 'string');
  assert.equal(Array.isArray(moveApplied.payload.moveHistory), true);
  assert.ok(moveApplied.payload.board);
  assert.ok(moveApplied.payload.capturedPieces);
});

test('handleMove keeps canonical moveApplied payload contract for a normal move', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT18');
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);

  const socket = createSocket('sock-w');
  const { io, roomEvents } = createIoRecorder();

  await handleMove(io, socket, gameManager, { from: 'e2', to: 'e4' });

  const moveApplied = roomEvents.find(e => e.name === 'moveApplied');
  assert.ok(moveApplied);
  assert.deepEqual(
    Object.keys(moveApplied.payload).sort(),
    ['black', 'board', 'captured', 'capturedPieces', 'checkState', 'color', 'flags', 'from', 'moveHistory', 'piece', 'promotion', 'san', 'to', 'white'].sort(),
  );
  assert.deepEqual(moveApplied.payload.moveHistory[0], {
    from: 'e2',
    to: 'e4',
    san: 'e4',
    color: 'w',
    captured: null,
    flags: 'b',
    piece: 'p',
    promotion: null,
  });
});


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


test('parry RPS resolution: attacker win proceeds capture via socket rpsChoice handlers', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT32');
  room.black = { name: 'Black', color: 'b', socketId: 'sock-b', isBot: false };
  room.chess.load('4k3/8/8/8/8/8/3p4/3QK3 w - - 0 1');
  room.mutatorState.activeRules.push({ rule: { id: 'parry' } });
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

  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });
  assert.ok(room.mutatorState.pendingRPS);

  whiteSocket.trigger('rpsChoice', { choice: 'rock' });
  assert.ok(room.mutatorState.pendingRPS);
  blackSocket.trigger('rpsChoice', { choice: 'scissors' });

  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.chess.get('d1'), undefined);
  assert.equal(room.chess.get('d2').type, 'q');
  assert.equal(room.chess.turn(), 'b');
  assert.equal(room.mutatorState.rpsResolved, false);

  const rpsResult = roomEvents.find(e => e.name === 'rpsResult');
  assert.ok(rpsResult);
  assert.equal(rpsResult.payload.captureProceeds, true);

  const moveApplied = roomEvents.filter(e => e.name === 'moveApplied');
  assert.equal(moveApplied.length, 1);
  assert.equal(moveApplied[0].payload.from, 'd1');
  assert.equal(moveApplied[0].payload.to, 'd2');
  assert.equal(moveApplied[0].payload.captured, 'p');
});



test('parry RPS resolution: tie also proceeds capture', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT36');
  room.black = { name: 'Black', color: 'b', socketId: 'sock-b', isBot: false };
  room.chess.load('4k3/8/8/8/8/8/3p4/3QK3 w - - 0 1');
  room.mutatorState.activeRules.push({ rule: { id: 'parry' } });
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

  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });
  whiteSocket.trigger('rpsChoice', { choice: 'paper' });
  blackSocket.trigger('rpsChoice', { choice: 'paper' });

  const rpsResult = roomEvents.find(e => e.name === 'rpsResult');
  assert.ok(rpsResult);
  assert.equal(rpsResult.payload.outcome, 'tie');
  assert.equal(rpsResult.payload.captureProceeds, true);
  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.chess.get('d2').type, 'q');
});
test('parry RPS resolution: defender win blocks capture and skips attacker turn', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT33');
  room.black = { name: 'Black', color: 'b', socketId: 'sock-b', isBot: false };
  room.chess.load('4k3/8/8/8/8/8/3p4/3QK3 w - - 0 1');
  room.mutatorState.activeRules.push({ rule: { id: 'parry' } });
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);
  gameManager.setSocketRoom('sock-b', room.roomCode);

  const whiteSocket = createRegisteredSocket('sock-w');
  const blackSocket = createRegisteredSocket('sock-b');
  const { io, roomEvents } = createIoRecorder();

  const handlers = createMutatorHandlers({ handleMove, scheduleBotMove: () => {}, generateBotTarget: () => null });
  handlers.registerSocketHandlers(whiteSocket, io, gameManager);
  handlers.registerSocketHandlers(blackSocket, io, gameManager);

  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });
  blackSocket.trigger('rpsChoice', { choice: 'paper' });
  whiteSocket.trigger('rpsChoice', { choice: 'rock' });

  assert.equal(room.mutatorState.pendingRPS, null);
  assert.equal(room.chess.get('d1').type, 'q');
  assert.equal(room.chess.get('d2').type, 'p');
  assert.equal(room.chess.turn(), 'b');

  const rpsResult = roomEvents.find(e => e.name === 'rpsResult');
  assert.ok(rpsResult);
  assert.equal(rpsResult.payload.captureProceeds, false);

  const blocked = roomEvents.filter(e => e.name === 'moveApplied').at(-1);
  assert.equal(blocked.payload.from, null);
  assert.equal(blocked.payload.to, null);
  assert.equal(blocked.payload.san, '(blocked)');
  assert.equal(blocked.payload.skipTurn, true);
  assert.equal(blocked.payload.skipMessage, 'Parry! Capture was blocked -- turn lost!');
});

test('parry RPS resolution: single valid choice does not resolve', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT34');
  room.black = { name: 'Black', color: 'b', socketId: 'sock-b', isBot: false };
  room.chess.load('4k3/8/8/8/8/8/3p4/3QK3 w - - 0 1');
  room.mutatorState.activeRules.push({ rule: { id: 'parry' } });
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);
  gameManager.setSocketRoom('sock-b', room.roomCode);

  const whiteSocket = createRegisteredSocket('sock-w');
  const blackSocket = createRegisteredSocket('sock-b');
  const { io, roomEvents } = createIoRecorder();

  const handlers = createMutatorHandlers({ handleMove, scheduleBotMove: () => {}, generateBotTarget: () => null });
  handlers.registerSocketHandlers(whiteSocket, io, gameManager);
  handlers.registerSocketHandlers(blackSocket, io, gameManager);

  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });
  whiteSocket.trigger('rpsChoice', { choice: 'rock' });

  assert.ok(room.mutatorState.pendingRPS);
  assert.equal(roomEvents.some(e => e.name === 'rpsResult'), false);
  assert.equal(roomEvents.some(e => e.name === 'moveApplied'), false);
});

test('parry RPS resolution: invalid or unrelated rpsChoice is ignored', async () => {
  const gameManager = new GameManager();
  const room = createActiveRoomWithPlayers('MVT35');
  room.black = { name: 'Black', color: 'b', socketId: 'sock-b', isBot: false };
  room.chess.load('4k3/8/8/8/8/8/3p4/3QK3 w - - 0 1');
  room.mutatorState.activeRules.push({ rule: { id: 'parry' } });
  gameManager.rooms.set(room.roomCode, room);
  gameManager.setSocketRoom('sock-w', room.roomCode);
  gameManager.setSocketRoom('sock-b', room.roomCode);
  gameManager.setSocketRoom('sock-x', room.roomCode);

  const whiteSocket = createRegisteredSocket('sock-w');
  const blackSocket = createRegisteredSocket('sock-b');
  const outsiderSocket = createRegisteredSocket('sock-x');
  const { io, roomEvents } = createIoRecorder();

  const handlers = createMutatorHandlers({ handleMove, scheduleBotMove: () => {}, generateBotTarget: () => null });
  handlers.registerSocketHandlers(whiteSocket, io, gameManager);
  handlers.registerSocketHandlers(blackSocket, io, gameManager);
  handlers.registerSocketHandlers(outsiderSocket, io, gameManager);

  await handleMove(io, whiteSocket, gameManager, { from: 'd1', to: 'd2' });
  whiteSocket.trigger('rpsChoice', { choice: 'lizard' });
  outsiderSocket.trigger('rpsChoice', { choice: 'paper' });

  assert.ok(room.mutatorState.pendingRPS);
  assert.equal(room.mutatorState.pendingRPS.attackerChoice, null);
  assert.equal(room.mutatorState.pendingRPS.defenderChoice, null);
  assert.equal(roomEvents.some(e => e.name === 'rpsResult'), false);
});
