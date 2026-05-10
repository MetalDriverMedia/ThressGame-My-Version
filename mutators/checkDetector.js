/**
 * Custom check and checkmate detection for mutator-aware games.
 *
 * When movement-modifying rules are active, chess.js's in_check() is unreliable.
 * This module provides mutator-aware alternatives.
 */

const { fenToBoard, colIndex, rowIndex, COLUMNS, ROWS, offsetSquare } = require('./boardUtils');

/**
 * Generate all squares a piece can attack from a given position.
 * Takes active mutator rules into account.
 *
 * @param {string} square - The piece's current square
 * @param {{type: string, color: string}} piece - The piece
 * @param {Map} board - Current board state
 * @param {object} mutatorState - Active mutator state
 * @returns {string[]} - Array of squares this piece can attack
 */
function getAttackSquares(square, piece, board, mutatorState) {
  if (!mutatorState || !mutatorState.activeRules || mutatorState.activeRules.length === 0) {
    return getStandardAttackSquares(square, piece, board);
  }

  const activeIds = new Set(mutatorState.activeRules.map(ar => ar.rule.id));
  let attacks;

  // Proletariat: ALL pieces move/attack like Pawns
  if (activeIds.has('proletariat')) {
    attacks = getPawnAttacks(square, piece.color);
    return applyPostModifiers(attacks, square, board, activeIds);
  }

  // Trains Rights: Kings <-> Queens swap movement
  if (activeIds.has('trains_rights')) {
    if (piece.type === 'k') {
      attacks = getSlidingAttacks(square, board, [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]);
    } else if (piece.type === 'q') {
      attacks = getKingAttacks(square);
    } else {
      attacks = getStandardAttackSquaresForType(square, piece, board);
    }
  } else {
    attacks = getStandardAttackSquaresForType(square, piece, board);
  }

  // Estrogen: Kings can ALSO move like Queens (adds to existing)
  if (activeIds.has('estrogen') && piece.type === 'k') {
    const queenAttacks = getSlidingAttacks(square, board, [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]);
    attacks = [...new Set([...attacks, ...queenAttacks])];
  }

  // Knee Surgery: Kings can move 2 squares in every direction
  if (activeIds.has('knee_surgery') && piece.type === 'k') {
    for (let dc = -2; dc <= 2; dc++) {
      for (let dr = -2; dr <= 2; dr++) {
        if (dc === 0 && dr === 0) continue;
        const sq = offsetSquare(square, dc, dr);
        if (sq && !attacks.includes(sq)) attacks.push(sq);
      }
    }
  }

  // God Kings: Kings can move 2 squares in every direction
  if (activeIds.has('god_kings') && piece.type === 'k') {
    for (let dc = -2; dc <= 2; dc++) {
      for (let dr = -2; dr <= 2; dr++) {
        if (dc === 0 && dr === 0) continue;
        const sq = offsetSquare(square, dc, dr);
        if (sq && !attacks.includes(sq)) attacks.push(sq);
      }
    }
  }

  // Pawns with Viagra: Pawns can also attack left and right
  if (activeIds.has('pawns_with_viagra') && piece.type === 'p') {
    const left = offsetSquare(square, -1, 0);
    const right = offsetSquare(square, 1, 0);
    if (left && !attacks.includes(left)) attacks.push(left);
    if (right && !attacks.includes(right)) attacks.push(right);
  }

  // Short Stop: limit all attacks to distance 1; give knights orthogonal attacks
  if (activeIds.has('short_stop')) {
    if (piece.type === 'n') {
      // Replace L-shaped attacks with orthogonal 1-square attacks
      attacks = [];
      for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
        const sq = offsetSquare(square, dc, dr);
        if (sq) attacks.push(sq);
      }
    } else {
      const col = colIndex(square);
      const row = rowIndex(square);
      attacks = attacks.filter(sq => {
        const tc = colIndex(sq);
        const tr = rowIndex(sq);
        return Math.abs(tc - col) <= 1 && Math.abs(tr - row) <= 1;
      });
    }
  }

  return applyPostModifiers(attacks, square, board, activeIds);
}

/**
 * Standard attack squares for a piece (no mutators).
 */
function getStandardAttackSquares(square, piece, board) {
  switch (piece.type) {
    case 'p': return getPawnAttacks(square, piece.color);
    case 'n': return getKnightAttacks(square);
    case 'b': return getSlidingAttacks(square, board, [[-1,-1],[-1,1],[1,-1],[1,1]]);
    case 'r': return getSlidingAttacks(square, board, [[-1,0],[1,0],[0,-1],[0,1]]);
    case 'q': return getSlidingAttacks(square, board, [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]);
    case 'k': return getKingAttacks(square);
    default: return [];
  }
}

function getPawnAttacks(square, color) {
  const dir = color === 'w' ? 1 : -1;
  const attacks = [];
  const left = offsetSquare(square, -1, dir);
  const right = offsetSquare(square, 1, dir);
  if (left) attacks.push(left);
  if (right) attacks.push(right);
  return attacks;
}

function getKnightAttacks(square) {
  const offsets = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  const attacks = [];
  for (const [dc, dr] of offsets) {
    const sq = offsetSquare(square, dc, dr);
    if (sq) attacks.push(sq);
  }
  return attacks;
}

function getSlidingAttacks(square, board, directions) {
  const attacks = [];
  for (const [dc, dr] of directions) {
    let current = square;
    while (true) {
      current = offsetSquare(current, dc, dr);
      if (!current) break;
      attacks.push(current);
      if (board.has(current)) break; // blocked by piece
    }
  }
  return attacks;
}

function getKingAttacks(square) {
  const attacks = [];
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (dc === 0 && dr === 0) continue;
      const sq = offsetSquare(square, dc, dr);
      if (sq) attacks.push(sq);
    }
  }
  return attacks;
}

/**
 * Get standard attack squares for a specific piece type (without full piece object lookup).
 */
function getStandardAttackSquaresForType(square, piece, board) {
  switch (piece.type) {
    case 'p': return getPawnAttacks(square, piece.color);
    case 'n': return getKnightAttacks(square);
    case 'b': return getSlidingAttacks(square, board, [[-1,-1],[-1,1],[1,-1],[1,1]]);
    case 'r': return getSlidingAttacks(square, board, [[-1,0],[1,0],[0,-1],[0,1]]);
    case 'q': return getSlidingAttacks(square, board, [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]);
    case 'k': return getKingAttacks(square);
    default: return [];
  }
}

/**
 * Apply post-processing modifiers (Pacman wrapping, etc.).
 */
function applyPostModifiers(attacks, square, board, activeIds) {
  let result = attacks;

  // Pacman Style: add wrap-around squares
  if (activeIds.has('pacman_style')) {
    const col = colIndex(square);
    const row = rowIndex(square);
    // For pieces on column a (0) or h (7), add wrapping attacks
    if (col === 0) {
      // Can wrap to column h
      const wrapSquare = COLUMNS[7] + ROWS[row];
      if (!result.includes(wrapSquare)) result.push(wrapSquare);
    }
    if (col === 7) {
      // Can wrap to column a
      const wrapSquare = COLUMNS[0] + ROWS[row];
      if (!result.includes(wrapSquare)) result.push(wrapSquare);
    }
  }

  return result;
}

/**
 * Returns true if any active mutator fully prevents this piece from moving.
 * Such a piece can't deliver check because it can't move to capture.
 */
function canPieceMove(square, piece, mutatorState) {
  if (!mutatorState || !mutatorState.activeRules || mutatorState.activeRules.length === 0) return true;
  const activeRules = mutatorState.activeRules;
  const activeIds = new Set(activeRules.map(ar => ar.rule.id));

  // Hobbit Battle: only pawns can move
  if (activeIds.has('hobbit_battle') && piece.type !== 'p') return false;

  // Severe Constipation: bishops and knights can't move
  if (activeIds.has('severe_constipation') && (piece.type === 'b' || piece.type === 'n')) return false;

  // All on Red (tails): only the king can move
  if (activeIds.has('all_on_red')) {
    const flip = mutatorState.coinFlipResult;
    if (flip && flip.result === 'tails' && piece.type !== 'k') return false;
  }

  // Ice Age: pieces in files A and H can't move
  if (activeIds.has('ice_age') && (square[0] === 'a' || square[0] === 'h')) return false;

  // Mr. Freeze: pieces in frozen columns can't move
  const ms = mutatorState;
  if (ms.boardModifiers?.frozenColumns?.length) {
    const frozen = ms.boardModifiers.frozenColumns.filter(
      fc => !fc.expiresAtMove || ms.moveCount < fc.expiresAtMove
    );
    if (frozen.some(fc => fc.column === square[0])) return false;
  }

  // Mitosis: the chosen square can't move while the rule is active
  for (const ar of activeRules) {
    if (ar.rule.id !== 'mitosis') continue;
    const targetSquare = typeof ar.choiceData === 'string' ? ar.choiceData : ar.choiceData?.square;
    if (targetSquare === square) return false;
  }

  // Proletariat is NOT a full immobilization -- non-pawn pieces still move (as pawns)
  return true;
}

/**
 * Returns true if the king of the given color is invulnerable to capture
 * under the active rules. Such a king is never in check.
 */
function isKingInvulnerable(kingSquare, mutatorState) {
  if (!mutatorState || !mutatorState.activeRules) return false;
  const activeIds = new Set(mutatorState.activeRules.map(ar => ar.rule.id));

  // Christmas Truce: no pieces can die
  if (activeIds.has('christmas_truce')) return true;
  // Hobbit Slaughter: only pawns can die -- king is non-pawn
  if (activeIds.has('hobbit_slaughter')) return true;
  // God Kings: kings can't be captured
  if (activeIds.has('god_kings')) return true;

  const ms = mutatorState;
  // Invulnerability Potion: protected pieces can't die
  const invul = (ms.boardModifiers?.invulnerable || [])
    .filter(iv => !iv.expiresAtMove || ms.moveCount < iv.expiresAtMove);
  if (invul.some(iv => iv.square === kingSquare)) return true;

  // Mr. Freeze: pieces in frozen columns are immune to destruction
  const frozen = (ms.boardModifiers?.frozenColumns || [])
    .filter(fc => !fc.expiresAtMove || ms.moveCount < fc.expiresAtMove);
  if (frozen.some(fc => fc.immune && fc.column === kingSquare[0])) return true;

  return false;
}

/**
 * Check if a king of the given color is in check.
 * Honors mutator-aware attack patterns AND ignores attackers that are
 * fully immobilized by an active rule (their threat can't be delivered).
 * Also returns false if the king is invulnerable under active rules.
 *
 * @param {Map} board - Board state
 * @param {string} kingColor - 'w' or 'b'
 * @param {object} mutatorState - Active mutator state
 * @returns {boolean}
 */
function isKingInCheck(board, kingColor, mutatorState) {
  // Find the king
  let kingSquare = null;
  for (const [sq, piece] of board) {
    if (piece.type === 'k' && piece.color === kingColor) {
      kingSquare = sq;
      break;
    }
  }
  if (!kingSquare) return false; // no king found (shouldn't happen)

  // Rules that make the king invulnerable -> never in check
  if (isKingInvulnerable(kingSquare, mutatorState)) return false;

  // Check if any enemy piece can attack the king's square
  const enemyColor = kingColor === 'w' ? 'b' : 'w';
  for (const [sq, piece] of board) {
    if (piece.color !== enemyColor) continue;
    if (!canPieceMove(sq, piece, mutatorState)) continue;
    const attacks = getAttackSquares(sq, piece, board, mutatorState);
    if (attacks.includes(kingSquare)) return true;
  }

  return false;
}

/**
 * Get all destinations a piece can move to, ignoring whose turn it is and
 * whether the move resolves a check. Used to validate moves when chess.js's
 * check filter disagrees with mutator-aware check detection.
 *
 * @returns {string[]} valid destination squares
 */
function getPseudoLegalDestinations(square, piece, board, mutatorState) {
  const dests = [];
  const attacks = getAttackSquares(square, piece, board, mutatorState);

  for (const to of attacks) {
    const target = board.get(to);
    if (target && target.color === piece.color) continue; // can't capture own
    // Pawns only reach attack squares if capturing an enemy piece
    if (piece.type === 'p' && !target) continue;
    dests.push(to);
  }

  // Pawn forward pushes (non-capturing)
  if (piece.type === 'p') {
    const dir = piece.color === 'w' ? 1 : -1;
    const forward1 = offsetSquare(square, 0, dir);
    if (forward1 && !board.has(forward1)) {
      dests.push(forward1);
      const startRank = piece.color === 'w' ? '2' : '7';
      if (square[1] === startRank) {
        const forward2 = offsetSquare(square, 0, dir * 2);
        if (forward2 && !board.has(forward2)) dests.push(forward2);
      }
    }
  }

  return dests;
}

/**
 * Check if a move would leave the player's own king in check.
 *
 * @param {Map} board - Board state (will be cloned)
 * @param {string} from - Source square
 * @param {string} to - Target square
 * @param {string} playerColor - Moving player's color
 * @param {object} mutatorState - Active mutator state
 * @returns {boolean} true if the move is illegal (leaves king in check)
 */
function wouldLeaveKingInCheck(board, from, to, playerColor, mutatorState) {
  // Clone the board
  const testBoard = new Map(board);
  // Apply the move
  testBoard.delete(from);
  const targetPiece = testBoard.get(to);
  testBoard.set(to, board.get(from));

  return isKingInCheck(testBoard, playerColor, mutatorState);
}

module.exports = {
  getAttackSquares,
  getStandardAttackSquares,
  getStandardAttackSquaresForType,
  applyPostModifiers,
  isKingInCheck,
  wouldLeaveKingInCheck,
  canPieceMove,
  getPseudoLegalDestinations,
  // Export helpers for rule implementations to override
  getPawnAttacks,
  getKnightAttacks,
  getSlidingAttacks,
  getKingAttacks,
};
