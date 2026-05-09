'use strict';

const { getHooks, getCustomMoves, getWrapMoves } = require('./ruleHooks');
const { isRuleActive } = require('./mutatorEngine');
const { isKingInCheck, getPseudoLegalDestinations, wouldLeaveKingInCheck } = require('./checkDetector');
const { fenToBoard } = require('./boardUtils');

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
      const filterFn = ruleHooks.getLegalMoveModifiers(room, currentTurn, options);
      if (filterFn) {
        legalMoves = filterFn(legalMoves);
      }
    }
  }

  if (ms) {
    const custom = getCustomMoves(room, currentTurn);
    for (const cm of custom) {
      if (!legalMoves.some(m => m.from === cm.from && m.to === cm.to)) {
        legalMoves.push({ from: cm.from, to: cm.to, flags: 'n', san: cm.to });
      }
    }

    if (isRuleActive(ms, 'pacman_style')) {
      const wraps = getWrapMoves(room, currentTurn);
      for (const wm of wraps) {
        if (!legalMoves.some(m => m.from === wm.from && m.to === wm.to)) {
          legalMoves.push({ from: wm.from, to: wm.to, flags: 'n', san: wm.to });
        }
      }
    }
  }

  return legalMoves;
}

module.exports = { getEffectiveLegalMoves };
