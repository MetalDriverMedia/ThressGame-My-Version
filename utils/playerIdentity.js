const crypto = require('crypto');

/**
 * Generate an opaque player hash. Prefers a client-provided browser token
 * (so two players on the same network with different browsers are treated
 * as distinct), falling back to an IP-derived hash when no token is sent.
 * The raw browser token / IP is never stored -- only the hash is kept.
 */
function generatePlayerHash(socket, browserId) {
  if (browserId && typeof browserId === 'string' && browserId.length >= 8) {
    return crypto.createHash('sha256').update(browserId).digest('hex').substring(0, 16);
  }
  const raw = socket.handshake.headers['x-forwarded-for']
    || socket.handshake.address
    || 'unknown';
  const ip = raw.split(',')[0].trim().toLowerCase().replace(/^::ffff:/, '');
  return crypto.createHash('sha256').update(ip).digest('hex').substring(0, 16);
}

module.exports = { generatePlayerHash };
