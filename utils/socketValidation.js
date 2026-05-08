function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateMovePayload(data) {
  if (!isObject(data)) return { ok: false, error: 'Invalid move payload.' };
  const { from, to, promotion } = data;
  if (typeof from !== 'string' || typeof to !== 'string') {
    return { ok: false, error: 'Invalid move payload.' };
  }
  if (promotion !== undefined && typeof promotion !== 'string') {
    return { ok: false, error: 'Invalid move payload.' };
  }
  return { ok: true };
}

function validateResumePayload(data) {
  if (!isObject(data)) return { ok: false, error: 'Invalid resume payload.' };
  if (typeof data.token !== 'string' || data.token.trim().length === 0) {
    return { ok: false, error: 'Invalid resume payload.' };
  }
  return { ok: true };
}

module.exports = {
  validateMovePayload,
  validateResumePayload,
};
