'use strict';

const fs = require('fs');

function isEnabled() {
  const v = process.env.DEBUG_LOG;
  return v === 'true' || v === '1';
}

function isVerbose() {
  const v = process.env.DEBUG_LOG_VERBOSE;
  return v === 'true' || v === '1';
}

function safeSerialize(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (key, val) => {
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
    }
    return val;
  });
}

function pickPayload(payload = {}, options = {}) {
  if (isVerbose() || options.verbose) return payload;
  const { mutatorState, headers, authorization, token, ip, ...rest } = payload || {};
  return rest;
}

function debugLog(event, payload = {}, options = {}) {
  if (!isEnabled()) return;
  try {
    const entry = {
      ts: new Date().toISOString(),
      event,
      ...pickPayload(payload, options),
      payload: pickPayload(payload.payload || {}, options),
    };

    const line = safeSerialize(entry);
    console.log(line);

    if (process.env.DEBUG_LOG_FILE) {
      fs.appendFileSync(process.env.DEBUG_LOG_FILE, `${line}\n`, 'utf8');
    }
  } catch (_err) {
    // Never crash gameplay because of debug logging.
  }
}

module.exports = { debugLog };
