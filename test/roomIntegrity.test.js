const test = require('node:test');
const assert = require('node:assert/strict');
const { Chess } = require('chess.js');

const { validateRoomIntegrity } = require('../utils/roomIntegrity');

function makeRoom({ status = 'active', fen } = {}) {
  const chess = new Chess();
  if (fen) chess.load(fen, { skipValidation: true });
  return {
    status,
    chess,
    white: { color: 'w' },
    black: { color: 'b' },
    getPlayer(color) { return color === 'w' ? this.white : this.black; },
    mutatorState: { boardModifiers: {} },
  };
}

function withWarnSpy(fn) {
  const orig = console.warn;
  const calls = [];
  console.warn = (...args) => calls.push(args.join(' '));
  try {
    fn(calls);
  } finally {
    console.warn = orig;
  }
}

test('valid starting room does not warn', () => {
  withWarnSpy((calls) => {
    const ok = validateRoomIntegrity(makeRoom(), 'test:valid');
    assert.equal(ok, true);
    assert.equal(calls.length, 0);
  });
});

test('missing king warns', () => {
  withWarnSpy((calls) => {
    const room = makeRoom({ fen: '4k3/8/8/8/8/8/8/8 w - - 0 1' });
    const ok = validateRoomIntegrity(room, 'test:missing-king');
    assert.equal(ok, false);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /exactly one king each/);
  });
});

test('invalid square in boardModifiers warns', () => {
  withWarnSpy((calls) => {
    const room = makeRoom();
    room.mutatorState.boardModifiers.mines = [{ square: 'z9' }];
    const ok = validateRoomIntegrity(room, 'test:bad-square');
    assert.equal(ok, false);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /invalid square/);
  });
});

test('ended king-destroyed room does not warn as active corruption', () => {
  withWarnSpy((calls) => {
    const room = makeRoom({ status: 'ended', fen: '4k3/8/8/8/8/8/8/8 w - - 0 1' });
    const ok = validateRoomIntegrity(room, 'test:ended-room');
    assert.equal(ok, true);
    assert.equal(calls.length, 0);
  });
});
