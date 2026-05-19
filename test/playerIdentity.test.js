const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { generatePlayerHash } = require('../utils/playerIdentity');

function makeSocket({ forwardedFor, address } = {}) {
  return {
    handshake: {
      headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
      address: address || '127.0.0.1',
    },
  };
}

test('same browserId produces same hash', () => {
  const socket = makeSocket({ address: '10.0.0.1' });
  const browserId = 'browser-identity-123';

  const a = generatePlayerHash(socket, browserId);
  const b = generatePlayerHash(socket, browserId);

  assert.equal(a, b);
  assert.equal(a.length, 16);
});

test('different browserIds produce different hashes', () => {
  const socket = makeSocket({ address: '10.0.0.1' });

  const a = generatePlayerHash(socket, 'browser-identity-AAA');
  const b = generatePlayerHash(socket, 'browser-identity-BBB');

  assert.notEqual(a, b);
});

test('hash does not expose raw browserId', () => {
  const socket = makeSocket({ address: '10.0.0.1' });
  const browserId = 'browser-identity-raw-visible-check';

  const hash = generatePlayerHash(socket, browserId);

  assert.equal(hash.includes(browserId), false);
  assert.match(hash, /^[a-f0-9]{16}$/);
});

test('falls back to IP hash when browserId is absent', () => {
  const socket = makeSocket({ forwardedFor: '203.0.113.5, 10.0.0.9', address: '10.0.0.1' });
  const expected = crypto.createHash('sha256').update('203.0.113.5').digest('hex').substring(0, 16);

  const hash = generatePlayerHash(socket, undefined);

  assert.equal(hash, expected);
});

test('short/invalid browserId falls back safely to normalized IP hash', () => {
  const socket = makeSocket({ address: '::ffff:203.0.113.7' });
  const expected = crypto.createHash('sha256').update('203.0.113.7').digest('hex').substring(0, 16);

  const hash = generatePlayerHash(socket, 'short');

  assert.equal(hash, expected);
});
