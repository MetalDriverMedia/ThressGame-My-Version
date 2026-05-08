'use strict';

const VALID_SQUARE = /^[a-h][1-8]$/;

function isValidSquare(square) {
  return typeof square === 'string' && VALID_SQUARE.test(square);
}

function validateSquareCollection(collection, label, warnings) {
  if (!collection) return;
  if (!Array.isArray(collection)) {
    warnings.push(`${label} should be an array.`);
    return;
  }

  const visit = (value, path) => {
    if (value == null) return;
    if (typeof value === 'string') {
      if (!isValidSquare(value)) warnings.push(`${path} has invalid square "${value}".`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (['square', 'from', 'to', 'entry', 'exit', 'source', 'target', 'square1', 'square2'].includes(k)) {
          if (typeof v === 'string' && !isValidSquare(v)) {
            warnings.push(`${path}.${k} has invalid square "${v}".`);
          }
        }
        if (Array.isArray(v) || (v && typeof v === 'object')) {
          visit(v, `${path}.${k}`);
        }
      }
    }
  };

  collection.forEach((entry, idx) => visit(entry, `${label}[${idx}]`));
}

function validateRoomIntegrity(room, context = 'unknown') {
  try {
    const warnings = [];

    if (!room) {
      console.warn(`[roomIntegrity:${context}] room is missing.`);
      return false;
    }
    if (!room.chess || typeof room.chess.fen !== 'function') {
      console.warn(`[roomIntegrity:${context}] room.chess is missing or invalid.`);
      return false;
    }

    let fen = null;
    try {
      fen = room.chess.fen();
    } catch {
      warnings.push('Unable to read FEN from room.chess.');
    }

    const activeGame = room.status === 'active';
    if (fen) {
      const parts = fen.split(' ');
      const boardPart = parts[0] || '';
      const turn = parts[1];

      if (activeGame) {
        const whiteKings = (boardPart.match(/K/g) || []).length;
        const blackKings = (boardPart.match(/k/g) || []).length;
        if (whiteKings !== 1 || blackKings !== 1) {
          warnings.push(`Active room must have exactly one king each (white=${whiteKings}, black=${blackKings}).`);
        }
      }

      if (activeGame && turn !== 'w' && turn !== 'b') {
        warnings.push(`Active turn must be "w" or "b" but got "${turn}".`);
      }
    }

    const ms = room.mutatorState;
    if (ms && ms.boardModifiers) {
      const modifiers = ms.boardModifiers;
      const keys = [
        'lockedSquares', 'mines', 'bottomlessPits', 'deathSquares', 'treasureSquares',
        'frozenSquares', 'invulnerable', 'livingBombs', 'portals', 'blockedSquares',
      ];
      for (const key of keys) validateSquareCollection(modifiers[key], `boardModifiers.${key}`, warnings);
    }

    const pendingChecks = [
      ['pendingChoice', ms && ms.pendingChoice && ms.pendingChoice.chooser],
      ['pendingAction', ms && ms.pendingAction && ms.pendingAction.forPlayer],
      ['pendingSecondAction', ms && ms.pendingSecondAction && ms.pendingSecondAction.forPlayer],
      ['pendingRPS.attacker', ms && ms.pendingRPS && ms.pendingRPS.attacker],
      ['pendingRPS.defender', ms && ms.pendingRPS && ms.pendingRPS.defender],
      ['pendingCoinFlip', ms && ms.pendingCoinFlip && ms.pendingCoinFlip.forPlayer],
    ];

    for (const [label, color] of pendingChecks) {
      if (!color) continue;
      if (color !== 'w' && color !== 'b') {
        warnings.push(`${label} references invalid color "${color}".`);
        continue;
      }
      if (typeof room.getPlayer === 'function' && !room.getPlayer(color)) {
        warnings.push(`${label} references missing player color "${color}".`);
      }
    }

    if (warnings.length > 0) {
      console.warn(`[roomIntegrity:${context}] ${warnings.join(' | ')}`);
      return false;
    }

    return true;
  } catch (err) {
    console.warn(`[roomIntegrity:${context}] Integrity checker failed safely: ${err?.message || err}`);
    return false;
  }
}

module.exports = { validateRoomIntegrity };
