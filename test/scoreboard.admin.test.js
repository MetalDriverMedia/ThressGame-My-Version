const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadScoreboardWithPath(scoreboardPath) {
  process.env.SCOREBOARD_PATH = scoreboardPath;
  const modulePath = require.resolve('../utils/scoreboard');
  delete require.cache[modulePath];
  return require('../utils/scoreboard');
}

test('malformed scoreboard data remains safe', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thress-scoreboard-'));
  const scoreboardPath = path.join(tmpDir, 'scoreboard.json');
  fs.writeFileSync(scoreboardPath, JSON.stringify({
    validHash: { name: 'Valid', score: 3, wins: 3, losses: 0, draws: 0, lastPlayed: Date.now() },
    invalidHash1: null,
    invalidHash2: { name: '', score: -10 },
    invalidHash3: { name: 'BadNums', score: 'zzz', wins: -5 },
  }, null, 2));

  const scoreboard = loadScoreboardWithPath(scoreboardPath);
  const top = scoreboard.getTop(25);

  assert.equal(top.length, 2);
  assert.equal(top[0].name, 'Valid');
  assert.equal(top[1].name, 'BadNums');
  assert.equal(top[1].score, 0);
  assert.equal(top[1].wins, 0);
});

test('export returns sane data and excludes raw ids', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thress-scoreboard-'));
  const scoreboardPath = path.join(tmpDir, 'scoreboard.json');
  const scoreboard = loadScoreboardWithPath(scoreboardPath);

  scoreboard.recordWin('hashA', 'Alice');
  scoreboard.flushSaves();

  const exported = scoreboard.exportScoreboard();
  assert.equal(typeof exported.exportedAt, 'string');
  assert.equal(exported.entryCount, 1);
  assert.equal(exported.players[0].hash, 'hashA');
  assert.equal(exported.players[0].name, 'Alice');
  assert.equal('browserId' in exported.players[0], false);
  assert.equal('ip' in exported.players[0], false);
});

test('reset clears scoreboard and persists empty state', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thress-scoreboard-'));
  const scoreboardPath = path.join(tmpDir, 'scoreboard.json');
  const scoreboard = loadScoreboardWithPath(scoreboardPath);

  scoreboard.recordWin('hashA', 'Alice');
  scoreboard.flushSaves();
  assert.equal(scoreboard.getTop(25).length, 1);

  scoreboard.resetScoreboard({ backupFirst: false });
  assert.deepEqual(scoreboard.getTop(25), []);

  const raw = JSON.parse(fs.readFileSync(scoreboardPath, 'utf8'));
  assert.deepEqual(raw, {});
});

test('reset with backup creates backup file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thress-scoreboard-'));
  const scoreboardPath = path.join(tmpDir, 'scoreboard.json');
  const scoreboard = loadScoreboardWithPath(scoreboardPath);

  scoreboard.recordWin('hashA', 'Alice');
  scoreboard.flushSaves();

  const result = scoreboard.resetScoreboard({ backupFirst: true });
  assert.equal(typeof result.backupPath, 'string');
  assert.equal(fs.existsSync(result.backupPath), true);

  const backup = JSON.parse(fs.readFileSync(result.backupPath, 'utf8'));
  assert.equal(backup.entryCount, 1);
});
