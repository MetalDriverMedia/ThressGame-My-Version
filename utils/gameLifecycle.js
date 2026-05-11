'use strict';

const { serializeBoardForClient, getPublicPlayer } = require('../gameController');
const { isKingInCheck } = require('../mutators/checkDetector');
const { getEffectiveLegalMoves: getEffectiveLegalMovesFromEngine } = require('../mutators/legalMoveEngine');
const { fenToBoard } = require('../mutators/boardUtils');
const { recordWin, recordLoss, recordDraw, getTop } = require('./scoreboard');
const turnClock = require('./turnClock');
const { hasGlobalPendingBlocker } = require('./pendingState');

const ROOM_CLEANUP_DELAY_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Schedule room deletion after a delay.
 * @param {Object} gameManager - GameManager instance
 * @param {string} roomCode - Room code to delete
 * @param {number} [delayMs] - Delay before deletion (default: 5 minutes)
 */
function scheduleRoomDeletion(gameManager, roomCode, delayMs = ROOM_CLEANUP_DELAY_MS) {
  if (!gameManager || typeof gameManager.getRoom !== 'function' || typeof gameManager.deleteRoom !== 'function') {
    return;
  }
  const room = gameManager.getRoom(roomCode);
  if (!room) return;

  const scheduledRoom = room;
  const scheduledEndedAt = room.endedAt;
  if (scheduledRoom.cleanupTimer) {
    clearTimeout(scheduledRoom.cleanupTimer);
  }

  const timer = setTimeout(() => {
    const currentRoom = gameManager.getRoom(roomCode);
    if (!currentRoom) return;

    if (currentRoom !== scheduledRoom) {
      console.log(`[gameLifecycle] Skipped cleanup for ${roomCode}: room instance changed`);
      return;
    }
    currentRoom.cleanupTimer = null;

    if (currentRoom.status !== 'ended') {
      console.log(`[gameLifecycle] Skipped cleanup for ${roomCode}: status is ${currentRoom.status}`);
      return;
    }

    if (scheduledEndedAt && currentRoom.endedAt !== scheduledEndedAt) {
      console.log(`[gameLifecycle] Skipped cleanup for ${roomCode}: endedAt changed`);
      return;
    }

    gameManager.deleteRoom(roomCode);
    console.log(`[gameLifecycle] Room ${roomCode} deleted after scheduled cleanup`);
  }, delayMs);
  scheduledRoom.cleanupTimer = timer;
  // Cleanup timers should not keep Node alive when tests finish.
  if (typeof timer.unref === 'function') timer.unref();
}

/**
 * Emit a standard 'gameEnded' event to all players in a room.
 * @param {Object} io - Socket.IO server
 * @param {Object} room - GameRoom instance
 * @param {string} reason - End reason (checkmate, stalemate, resignation, etc.)
 * @param {string|null} winner - Winner color ('w'/'b') or null for draws
 */
function emitGameEnded(io, room, reason, winner) {
  // Stop turn clock and clear any standing quiet-resign offer
  turnClock.clearClock(room);
  turnClock.clearQuietResign(room);

  const payload = {
    reason,
    winner,
    board: serializeBoardForClient(room.chess),
    white: getPublicPlayer(room.white),
    black: getPublicPlayer(room.black),
  };
  if (winner) {
    payload.loser = winner === 'w' ? 'b' : 'w';
  }
  io.to(room.roomCode).emit('gameEnded', payload);

  // Update scoreboard (skip bot games, quiet resigns, and custom-ruleset games)
  if (reason === 'quiet-resign') return;
  const w = room.white;
  const b = room.black;
  if (!w || !b || w.isBot || b.isBot) return;

  // Only unmodified games (full mutator pool, auto coin flip) count toward
  // the leaderboard. Custom rule pools could be tuned to favor an exploit.
  const hasDisabledRules = room.disabledMutators && room.disabledMutators.size > 0;
  if (hasDisabledRules || room.manualCoinFlip) return;

  if (winner) {
    const winPlayer = winner === 'w' ? w : b;
    const losePlayer = winner === 'w' ? b : w;
    recordWin(winPlayer.playerHash, winPlayer.name);
    recordLoss(losePlayer.playerHash, losePlayer.name);
  } else {
    recordDraw(w.playerHash, w.name);
    recordDraw(b.playerHash, b.name);
  }

  // Push updated scoreboard to everyone in the lobby
  io.to('lobby').emit('scoreboardUpdate', { players: getTop(25) });
}

// Auto-resign a player whose turn timer ran out. Counts as a normal resignation
// for scoreboard purposes -- the staller loses, the opponent wins.
function autoResignOnTimeout(room, io, gameManager, stallingColor) {
  if (!room || room.status !== 'active') return;
  const winnerColor = stallingColor === 'w' ? 'b' : 'w';
  room.endGame('timeout', winnerColor);
  emitGameEnded(io, room, 'timeout', winnerColor);
  scheduleRoomDeletion(gameManager, room.roomCode);
}

/**
 * Check if either king was destroyed by a mutator effect.
 * If so, end the game immediately. Returns true if game ended.
 */
function checkKingDestroyed(room, io, gameManager) {
  if (!room || !room.chess || !room.status || room.status !== 'active') return false;

  const fen = room.chess.fen();
  const placement = fen.split(' ')[0];
  const hasWhiteKing = placement.includes('K');
  const hasBlackKing = placement.includes('k');

  if (hasWhiteKing && hasBlackKing) return false;

  // Determine winner -- the side whose king still exists
  let winner = null;
  let reason = 'king-destroyed';
  if (!hasWhiteKing && hasBlackKing) winner = 'b';
  else if (hasWhiteKing && !hasBlackKing) winner = 'w';
  else reason = 'draw'; // both kings gone (unlikely but handle it)

  room.endGame(reason, winner);
  emitGameEnded(io, room, reason, winner);
  scheduleRoomDeletion(gameManager, room.roomCode);
  return true;
}

/**
 * Trigger a coin flip for All on Red. Call after the rule activates or after a move.
 * Handles auto vs manual mode and bot auto-pick.
 */
function triggerCoinFlip(room, io, forColor) {
  const ms = room.mutatorState;
  if (!ms) return;
  if (room.status !== 'active') return;

  // Do not prompt/resolve All on Red coin flips while other global pending
  // mutator interactions are unresolved.
  if (hasGlobalPendingBlocker(room)) return;
  // Risk It Rook manual flip flow is separate from All On Red and must resolve
  // first to avoid overlapping prompt/result lifecycles.
  if (room._riskItRookPending) return;

  // Skip if a flip already happened this move (prevents double-flip when rule choice
  // and post-move coin flip both fire in the same turn)
  if (ms.coinFlipResult && ms.coinFlipResult.moveCount === ms.moveCount) return;
  if (ms.pendingCoinFlip && ms.pendingCoinFlip.moveCount === ms.moveCount) return;

  const nextPlayer = room.getPlayer(forColor);

  if (room.manualCoinFlip) {
    ms.pendingCoinFlip = { forPlayer: forColor, moveCount: ms.moveCount };
    if (nextPlayer && nextPlayer.isBot) {
      // Bot flips with humanizing delay
      const flipDelay = 800 + Math.random() * 400; // 0.8-1.2s
      setTimeout(() => {
        if (room.status !== 'active' || !ms.pendingCoinFlip) return;
        if (ms.pendingCoinFlip.forPlayer !== forColor || ms.pendingCoinFlip.moveCount !== ms.moveCount) return;
        const result = Math.random() < 0.5 ? 'heads' : 'tails';
        if (ms.coinFlipResult && ms.coinFlipResult.moveCount === ms.moveCount) return;
        ms.coinFlipResult = { result, moveCount: ms.moveCount };
        ms.pendingCoinFlip = null;
        io.to(room.roomCode).emit('coinFlipResult', { result, forPlayer: forColor, manual: true });
      }, flipDelay);
    } else {
      io.to(room.roomCode).emit('coinFlipPrompt', { forPlayer: forColor });
    }
  } else {
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    ms.coinFlipResult = { result, moveCount: ms.moveCount };
    if (nextPlayer && nextPlayer.isBot) {
      io.to(room.roomCode).emit('coinFlipResult', { result, forPlayer: forColor, manual: false });
    } else {
      io.to(room.roomCode).emit('coinFlip', { result, forPlayer: forColor });
    }
  }
}

/**
 * After a "tails" coin flip, check if the king has any legal moves.
 * If not, skip the turn and trigger the next coin flip.
 */
function checkCoinFlipSkipTurn(room, io, forColor) {
  const ms = room.mutatorState;
  if (!ms || !ms.coinFlipResult || ms.coinFlipResult.result !== 'tails') return;

  // Get all legal moves and filter to king-only
  const moves = room.chess.moves({ verbose: true });
  const kingMoves = moves.filter(m => m.piece === 'k');

  if (kingMoves.length > 0) return; // King has moves, no skip needed

  // No king moves -- skip turn by flipping active color in FEN
  const fen = room.chess.fen();
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w'; // Swap active color
  room.chess.load(parts.join(' '), { skipValidation: true });

  // Notify clients
  io.to(room.roomCode).emit('moveApplied', {
    from: null, to: null, san: '(skipped)', color: forColor,
    piece: null, captured: null, flags: '', promotion: null,
    board: serializeBoardForClient(room.chess),
    skipTurn: true,
    skipMessage: 'No valid King moves -- turn skipped!',
    moveHistory: room.moveHistory,
    white: getPublicPlayer(room.white),
    black: getPublicPlayer(room.black),
  });

  // Restart clock for the new player whose turn just started via skip
  turnClock.startClock(room, io);

  // Trigger next coin flip for the other player
  const nextColor = forColor === 'w' ? 'b' : 'w';
  triggerCoinFlip(room, io, nextColor);
}

/**
 * Get all effective legal moves for the current player after applying mutator
 * restriction filters, custom moves, and wrap moves. No safety fallback --
 * an empty list means the player is truly stuck.
 *
 * Shared by checkMutatorDeadlock and checkParryDeadlock to stay DRY.
 */
function getEffectiveLegalMoves(room) {
  return getEffectiveLegalMovesFromEngine(room, room.chess.turn());
}

/**
 * Check if the current player has no legal moves after applying mutator restrictions.
 * If so, end the game as checkmate (if in check) or stalemate (if not).
 * Returns true if game ended.
 *
 * Unlike the safety fallback in moveHandler, this does NOT skip filters when they
 * empty the move list -- an empty list means the player is truly stuck.
 */
function checkMutatorDeadlock(room, io, gameManager) {
  if (!room || room.status !== 'active') return false;
  if (!room.mutatorState || room.mutatorState.activeRules.length === 0) return false;

  const legalMoves = getEffectiveLegalMoves(room);

  // Player has legal moves -- no deadlock
  if (legalMoves.length > 0) return false;

  // No legal moves after mutator restrictions
  const currentTurn = room.chess.turn();
  const board = fenToBoard(room.chess.fen());
  const inCheck = isKingInCheck(board, currentTurn, room.mutatorState);

  if (inCheck) {
    const winner = currentTurn === 'w' ? 'b' : 'w';
    room.endGame('checkmate', winner);
    emitGameEnded(io, room, 'checkmate', winner);
    scheduleRoomDeletion(gameManager, room.roomCode);
    console.log(`[gameLifecycle] Mutator deadlock: ${currentTurn} in check with no legal moves → checkmate`);
    return true;
  } else {
    room.endGame('stalemate', null);
    emitGameEnded(io, room, 'stalemate', null);
    scheduleRoomDeletion(gameManager, room.roomCode);
    console.log(`[gameLifecycle] Mutator deadlock: ${currentTurn} not in check but no legal moves → stalemate`);
    return true;
  }
}

/**
 * Check if the current player is deadlocked by Parry -- all their legal moves
 * are captures (which Parry would block via RPS). If so, end the game as
 * checkmate (in check) or stalemate (not in check). Returns true if game ended.
 */
function checkParryDeadlock(room, io, gameManager) {
  if (!room || room.status !== 'active') return false;

  const legalMoves = getEffectiveLegalMoves(room);

  // No legal moves at all -- should be caught elsewhere, but handle gracefully
  if (legalMoves.length === 0) {
    const currentTurn = room.chess.turn();
    const board = fenToBoard(room.chess.fen());
    const inCheck = isKingInCheck(board, currentTurn, room.mutatorState);
    const winner = inCheck ? (currentTurn === 'w' ? 'b' : 'w') : null;
    const reason = inCheck ? 'checkmate' : 'stalemate';
    room.endGame(reason, winner);
    emitGameEnded(io, room, reason, winner);
    scheduleRoomDeletion(gameManager, room.roomCode);
    console.log(`[gameLifecycle] Parry deadlock: ${currentTurn} has no legal moves → ${reason}`);
    return true;
  }

  // Check if any move lands on a non-opponent square (won't trigger Parry)
  const currentTurn = room.chess.turn();
  const hasNonCapture = legalMoves.some(m => {
    const targetPiece = room.chess.get(m.to);
    return !targetPiece || targetPiece.color === currentTurn;
  });

  if (hasNonCapture) return false; // Has non-capture moves, no Parry deadlock

  // All moves are captures → Parry blocks them all → deadlock
  const board = fenToBoard(room.chess.fen());
  const inCheck = isKingInCheck(board, currentTurn, room.mutatorState);

  if (inCheck) {
    const winner = currentTurn === 'w' ? 'b' : 'w';
    room.endGame('checkmate', winner);
    emitGameEnded(io, room, 'checkmate', winner);
    scheduleRoomDeletion(gameManager, room.roomCode);
    console.log(`[gameLifecycle] Parry deadlock: ${currentTurn} in check with only capture moves → checkmate`);
    return true;
  } else {
    room.endGame('stalemate', null);
    emitGameEnded(io, room, 'stalemate', null);
    scheduleRoomDeletion(gameManager, room.roomCode);
    console.log(`[gameLifecycle] Parry deadlock: ${currentTurn} has only capture moves while Parry active → stalemate`);
    return true;
  }
}

module.exports = { scheduleRoomDeletion, emitGameEnded, checkKingDestroyed, checkMutatorDeadlock, checkParryDeadlock, triggerCoinFlip, checkCoinFlipSkipTurn, getEffectiveLegalMoves, autoResignOnTimeout, ROOM_CLEANUP_DELAY_MS };
