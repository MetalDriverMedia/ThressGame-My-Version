'use strict';

const TURN_DURATION_MS = 3 * 60 * 1000;
const STRIKE_THRESHOLD_MS = TURN_DURATION_MS - 30 * 1000; // 2:30 elapsed = <30s left
const STRIKES_FOR_QUIET_RESIGN = 3;

function ensureClockState(room) {
  if (!room.lowTimeStrikes) room.lowTimeStrikes = { w: 0, b: 0 };
  if (!room.quietResignFor) room.quietResignFor = null;
}

function clearClock(room) {
  if (!room) return;
  if (room._turnExpireTimer) {
    clearTimeout(room._turnExpireTimer);
    room._turnExpireTimer = null;
  }
  room.turnStartTime = null;
}

function shouldRunClock(room) {
  if (!room || room.status !== 'active') return false;
  // Skip bot games entirely
  if (room.white?.isBot || room.black?.isBot) return false;
  return true;
}

// Optional dependency injected by gameLifecycle to avoid circular import on auto-resign
let _onTimeoutResign = null;
function setTimeoutResignHandler(fn) { _onTimeoutResign = fn; }

function startClock(room, io) {
  ensureClockState(room);
  clearClock(room);
  if (!shouldRunClock(room)) return;

  room.turnStartTime = Date.now();
  io.to(room.roomCode).emit('turnClockUpdate', {
    turnStartTime: room.turnStartTime,
    durationMs: TURN_DURATION_MS,
  });

  // If the timer expires without a move, the staller is auto-resigned (full
  // scoreboard penalty). The slow-play "quiet resign" relief is a separate
  // mechanism triggered by 3 consecutive completed-but-slow moves.
  room._turnExpireTimer = setTimeout(() => _onTurnExpired(room, io), TURN_DURATION_MS);
}

function _onTurnExpired(room, io) {
  if (room.status !== 'active') return;
  const stallingColor = room.chess.turn();
  clearClock(room);
  if (typeof _onTimeoutResign === 'function') {
    _onTimeoutResign(room, io, stallingColor);
  }
}

/**
 * Called when a player submits a move. Records elapsed time relative to when
 * the turn started and updates strike state. Always clears the clock so the
 * expiry timer can't double-count alongside RPS / mutator interactions that
 * may delay actual move resolution.
 */
function consumeMoveAttempt(room, io, color) {
  ensureClockState(room);
  if (!shouldRunClock(room) || !room.turnStartTime) return;

  const elapsed = Date.now() - room.turnStartTime;
  const opponent = color === 'w' ? 'b' : 'w';

  if (elapsed >= STRIKE_THRESHOLD_MS) {
    room.lowTimeStrikes[color] = (room.lowTimeStrikes[color] || 0) + 1;
    if (room.lowTimeStrikes[color] >= STRIKES_FOR_QUIET_RESIGN) {
      offerQuietResign(room, io, color);
    }
  } else {
    // Fast move -- reset strikes and revoke any standing quiet-resign offer
    if (room.lowTimeStrikes[color]) {
      room.lowTimeStrikes[color] = 0;
    }
    if (room.quietResignFor && room.quietResignFor === opponent) {
      room.quietResignFor = null;
      io.to(room.roomCode).emit('quietResignRevoked', { forColor: opponent });
    }
  }

  // Prevent the expire timer from also charging for this turn.
  clearClock(room);
}

function offerQuietResign(room, io, stallingColor) {
  const opponent = stallingColor === 'w' ? 'b' : 'w';
  if (room.quietResignFor === opponent) return; // already offered
  room.quietResignFor = opponent;
  io.to(room.roomCode).emit('quietResignAvailable', { forColor: opponent });
}

function clearQuietResign(room) {
  if (!room) return;
  room.quietResignFor = null;
  room.lowTimeStrikes = { w: 0, b: 0 };
}

module.exports = {
  TURN_DURATION_MS,
  startClock,
  clearClock,
  consumeMoveAttempt,
  clearQuietResign,
  shouldRunClock,
  setTimeoutResignHandler,
};
