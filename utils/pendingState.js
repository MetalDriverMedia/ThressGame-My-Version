'use strict';

function getMovePendingBlocker(room, playerColor) {
  const ms = room?.mutatorState;
  if (!ms) return null;

  if (ms.pendingChoice?.chooser === playerColor) {
    return { key: 'pendingChoice', message: 'Choose a rule before making your move.' };
  }

  if (ms.pendingAction || ms.pendingSecondAction) {
    return { key: ms.pendingSecondAction ? 'pendingSecondAction' : 'pendingAction', message: 'Complete the rule selection first.' };
  }

  if (ms.pendingRPS) {
    return { key: 'pendingRPS', message: 'Waiting for RPS resolution.' };
  }

  if (ms.pendingCoinFlip?.forPlayer === playerColor) {
    return { key: 'pendingCoinFlip', message: 'Flip the coin first!' };
  }

  return null;
}

function hasGlobalPendingBlocker(room) {
  const ms = room?.mutatorState;
  if (!ms) return false;
  return Boolean(ms.pendingAction || ms.pendingSecondAction || ms.pendingRPS);
}

module.exports = { getMovePendingBlocker, hasGlobalPendingBlocker };
