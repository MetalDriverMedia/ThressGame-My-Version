'use strict';

const { getHooks, getCustomMoves, getWrapMoves } = require('./ruleHooks');
const { isRuleActive } = require('./mutatorEngine');
const { isKingInCheck, getPseudoLegalDestinations, wouldLeaveKingInCheck } = require('./checkDetector');
const { fenToBoard } = require('./boardUtils');

function appendSyntheticMoves(room, currentTurn, legalMoves) {
  const ms = room.mutatorState;
  if (!ms) return legalMoves;

  const mergedMoves = [...legalMoves];
  const custom = getCustomMoves(room, currentTurn);
  for (const cm of custom) {
    if (!mergedMoves.some(m => m.from === cm.from && m.to === cm.to)) {
      mergedMoves.push({ from: cm.from, to: cm.to, flags: 'n', san: cm.to });
    }
  }

  if (isRuleActive(ms, 'pacman_style')) {
    const wraps = getWrapMoves(room, currentTurn);
    for (const wm of wraps) {
      if (!mergedMoves.some(m => m.from === wm.from && m.to === wm.to)) {
        mergedMoves.push({ from: wm.from, to: wm.to, flags: 'n', san: wm.to });
      }
    }
  }

  return mergedMoves;
}

function getEffectiveLegalMoves(room, color, options = {}) {
  const ms = room.mutatorState;
  const currentTurn = color || room.chess.turn();

  let legalMoves = room.chess.moves({ verbose: true });

  if (ms && ms.activeRules.length > 0 && room.chess.inCheck()) {
    const board = fenToBoard(room.chess.fen());
    if (!isKingInCheck(board, currentTurn, ms)) {
      for (const [sq, piece] of board) {
        if (piece.color !== currentTurn) continue;
        const dests = getPseudoLegalDestinations(sq, piece, board, ms);
        for (const to of dests) {
          if (legalMoves.some(m => m.from === sq && m.to === to)) continue;
          if (wouldLeaveKingInCheck(board, sq, to, currentTurn, ms)) continue;
          legalMoves.push({ from: sq, to, flags: 'n', san: to, piece: piece.type });
        }
      }
    }
  }

  if (options.syntheticMovesBeforeRestrictions) {
    legalMoves = appendSyntheticMoves(room, currentTurn, legalMoves);
  }

  if (ms && ms.activeRules.length > 0) {
    const restrictionRules = ms.activeRules.filter(ar => {
      const ruleHooks = getHooks(ar.rule.id);
      return ruleHooks && ruleHooks.getLegalMoveModifiers;
    });

    const FORCED_MOVE_RULES = new Set(['tornado', 'bloodthirsty']);
    restrictionRules.sort((a, b) => {
      const aForced = FORCED_MOVE_RULES.has(a.rule.id) ? 1 : 0;
      const bForced = FORCED_MOVE_RULES.has(b.rule.id) ? 1 : 0;
      return aForced - bForced;
    });

    for (const ar of restrictionRules) {
      const ruleHooks = getHooks(ar.rule.id);
      const filterFn = ruleHooks.getLegalMoveModifiers(room, currentTurn);
      if (filterFn) {
        legalMoves = filterFn(legalMoves);
      }
    }
  }

  if (!options.syntheticMovesBeforeRestrictions) {
    legalMoves = appendSyntheticMoves(room, currentTurn, legalMoves);
  }

  return legalMoves;
}


function isMoveAllowed(room, color, from, to, promotion, options = {}) {
  const legalMoves = getEffectiveLegalMoves(room, color, options);

  const matchedMove = legalMoves.find((move) => {
    if (move.from !== from || move.to !== to) return false;

    if (move.promotion) {
      return promotion === move.promotion;
    }

    return true;
  });

  if (!matchedMove) {
    return {
      allowed: false,
      reason: 'not_in_effective_legal_moves',
    };
  }

  return {
    allowed: true,
    matchedMove,
  };
}

module.exports = { getEffectiveLegalMoves, isMoveAllowed };
