const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');

test('server startup smoke: boots and logs startup banner', async (t) => {
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`server did not start in time. stdout=${stdout}\nstderr=${stderr}`));
    }, 4000);

    child.once('error', reject);

    child.stdout.on('data', () => {
      if (stdout.includes('[startup] Thress')) {
        clearTimeout(timeout);
        child.kill('SIGTERM');
        resolve();
      }
    });

    child.once('exit', (code, signal) => {
      if (stdout.includes('[startup] Thress')) return;
      clearTimeout(timeout);
      if (stderr.includes("Cannot find module 'express'")) {
        clearTimeout(timeout);
        t.skip('startup smoke skipped: dependencies not installed in this environment');
        resolve();
        return;
      }
      reject(new Error(`server exited before startup banner. code=${code} signal=${signal}\nstdout=${stdout}\nstderr=${stderr}`));
    });
  });

  assert.match(stdout, /\[startup\] Thress/);
  assert.equal(stderr.includes('ReferenceError: APP_VERSION is not defined'), false);
});
