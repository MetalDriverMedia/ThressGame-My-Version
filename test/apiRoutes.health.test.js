const test = require('node:test');
const assert = require('node:assert/strict');

const { setupApiRoutes } = require('../routes/apiRoutes');

function invokeGet(router, path) {
  const layer = router.stack.find((entry) => entry.route && entry.route.path === path);
  assert.ok(layer, `route not found: ${path}`);

  let statusCode = 200;
  let payload;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      payload = data;
      return this;
    },
  };

  layer.route.stack[0].handle({}, res);
  return { statusCode, payload };
}

test('health endpoint returns deployment metadata without secrets', () => {
  const router = setupApiRoutes({
    version: '1.2.3',
    startupTime: Date.now() - 5_000,
    basePath: '/thress',
    socketPath: '/thress/socket.io',
  });

  const { statusCode, payload } = invokeGet(router, '/health');
  assert.equal(statusCode, 200);
  assert.equal(payload.status, 'ok');
  assert.equal(payload.version, '1.2.3');
  assert.equal(payload.basePath, '/thress');
  assert.equal(payload.socketPath, '/thress/socket.io');
  assert.equal(typeof payload.uptimeSeconds, 'number');
  assert.match(payload.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(!Object.prototype.hasOwnProperty.call(payload, 'token'));
  assert.ok(!Object.prototype.hasOwnProperty.call(payload, 'ip'));
});

test('readiness endpoint reports ready when scoreboard directory is writable', () => {
  const router = setupApiRoutes();
  const { statusCode, payload } = invokeGet(router, '/readiness');

  assert.equal(statusCode, 200);
  assert.equal(payload.status, 'ready');
  assert.equal(payload.checks.scoreboardPersistence.configured, true);
  assert.equal(typeof payload.checks.scoreboardPersistence.isDirectoryWritable, 'boolean');
});
