const { GameRoom } = require('../../gameManager');

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

function createParryCaptureSetup(roomCode = 'MVT01') {
  const room = createActiveRoomWithPlayers(roomCode);
  room.black = { name: 'Black', color: 'b', socketId: 'sock-b', isBot: false };
  room.chess.load('4k3/8/8/8/8/8/3p4/3QK3 w - - 0 1');
  room.mutatorState.activeRules.push({ rule: { id: 'parry' } });
  return room;
}

module.exports = {
  createIoRecorder,
  createSocket,
  createRegisteredSocket,
  createActiveRoomWithPlayers,
  createParryCaptureSetup,
};
