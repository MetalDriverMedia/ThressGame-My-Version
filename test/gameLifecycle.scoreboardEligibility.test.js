const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadRuntime(scoreboardPath) {
  process.env.SCOREBOARD_PATH = scoreboardPath;
  const modules = [
    '../utils/scoreboard',
    '../utils/gameLifecycle',
    '../gameManager',
    '../gameController',
  ];
  for (const mod of modules) {
    delete require.cache[require.resolve(mod)];
  }

  const scoreboard = require('../utils/scoreboard');
  const { emitGameEnded } = require('../utils/gameLifecycle');
  const { GameManager } = require('../gameManager');
  const { createPlayer } = require('../gameController');
  return { scoreboard, emitGameEnded, GameManager, createPlayer };
}

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
    },
  };
}

function setupRoom(rt, opts = {}) {
  const manager = new rt.GameManager();
  const room = manager.createRoom(false);
  const white = rt.createPlayer('sw', 'White', 'hash-white', 'w', !!opts.whiteIsBot);
  const black = rt.createPlayer('sb', 'Black', 'hash-black', 'b', !!opts.blackIsBot);
  room.addPlayer(white);
  room.addPlayer(black);
  room.startGame();
  room.disabledMutators = new Set(opts.disabledMutators || []);
  room.manualCoinFlip = !!opts.manualCoinFlip;
  return { room };
}

test('scoreboard eligibility matrix basics via emitGameEnded are deterministic', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thress-h3a-score-'));
  const scoreboardPath = path.join(tmpDir, 'scoreboard.json');

  // default human-vs-human should count
  {
    const rt = loadRuntime(scoreboardPath);
    const { io } = createIoRecorder();
    const { room } = setupRoom(rt);
    rt.emitGameEnded(io, room, 'checkmate', 'w');
    rt.scoreboard.flushSaves();
    const top = rt.scoreboard.getTop(25);
    assert.equal(top.length, 2);
    assert.deepEqual(top.map((p) => p.name).sort(), ['Black', 'White']);
  }

  // bot game should not count
  {
    const rt = loadRuntime(scoreboardPath);
    rt.scoreboard.resetScoreboard({ backupFirst: false });
    const { io } = createIoRecorder();
    const { room } = setupRoom(rt, { blackIsBot: true });
    rt.emitGameEnded(io, room, 'checkmate', 'w');
    rt.scoreboard.flushSaves();
    assert.deepEqual(rt.scoreboard.getTop(25), []);
  }

  // custom/disabled mutator game should not count
  {
    const rt = loadRuntime(scoreboardPath);
    rt.scoreboard.resetScoreboard({ backupFirst: false });
    const { io } = createIoRecorder();
    const { room } = setupRoom(rt, { disabledMutators: ['parry'] });
    rt.emitGameEnded(io, room, 'checkmate', 'w');
    rt.scoreboard.flushSaves();
    assert.deepEqual(rt.scoreboard.getTop(25), []);
  }

  // manual coin flip game should not count
  {
    const rt = loadRuntime(scoreboardPath);
    rt.scoreboard.resetScoreboard({ backupFirst: false });
    const { io } = createIoRecorder();
    const { room } = setupRoom(rt, { manualCoinFlip: true });
    rt.emitGameEnded(io, room, 'checkmate', 'w');
    rt.scoreboard.flushSaves();
    assert.deepEqual(rt.scoreboard.getTop(25), []);
  }

  // quiet resign should not count
  {
    const rt = loadRuntime(scoreboardPath);
    rt.scoreboard.resetScoreboard({ backupFirst: false });
    const { io } = createIoRecorder();
    const { room } = setupRoom(rt);
    rt.emitGameEnded(io, room, 'quiet-resign', null);
    rt.scoreboard.flushSaves();
    assert.deepEqual(rt.scoreboard.getTop(25), []);
  }
});
