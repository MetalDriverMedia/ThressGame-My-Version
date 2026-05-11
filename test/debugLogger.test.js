'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { debugLog } = require('../utils/debugLogger');

const envBackup = { ...process.env };

test.afterEach(() => {
  process.env = { ...envBackup };
});

test('debugLog no-ops when disabled', () => {
  delete process.env.DEBUG_LOG;
  const logs = [];
  const orig = console.log;
  console.log = (v) => logs.push(v);
  debugLog('eventA', { a: 1 });
  console.log = orig;
  assert.equal(logs.length, 0);
});

test('debugLog writes structured log when enabled', () => {
  process.env.DEBUG_LOG = 'true';
  const logs = [];
  const orig = console.log;
  console.log = (v) => logs.push(v);
  debugLog('eventB', { roomCode: 'ABCD', payload: { x: 2 } });
  console.log = orig;
  assert.equal(logs.length, 1);
  assert.match(logs[0], /"event":"eventB"/);
  assert.match(logs[0], /"roomCode":"ABCD"/);
});

test('debugLog handles circular payloads', () => {
  process.env.DEBUG_LOG = '1';
  const obj = {}; obj.self = obj;
  assert.doesNotThrow(() => debugLog('eventC', obj));
});

test('debugLog optionally writes to file', () => {
  process.env.DEBUG_LOG = 'true';
  const tmp = path.join(os.tmpdir(), `debug-log-${Date.now()}.log`);
  process.env.DEBUG_LOG_FILE = tmp;
  debugLog('eventD', { roomCode: 'ROOM1' });
  const content = fs.readFileSync(tmp, 'utf8');
  assert.match(content, /eventD/);
  fs.unlinkSync(tmp);
});
