// ============================================================================
// SOCKET HANDLERS -- All server event handlers
// ============================================================================

import { state, STORAGE_KEYS } from './state.js';
import { startPageBackground, stopPageBackground } from './animated-bg.js';
import { saveToStorage, removeFromStorage, clearSession } from './storage.js';
import {
  showLanding, showWaiting, showGame,
  syncChessInstance, updateTurnIndicator,
  renderCapturedPieces,
  setBaseStatus, flashStatus, formatGameEndMessage, showGameOverModal,
  renderRoomsList,
  startTurnClock, stopTurnClock, setQuietResignAvailable,
} from './ui.js';
import {
  renderBoard, animateMoveWithRender, waitForAnimation, skipCurrentAnimations,
} from './board.js';
import { setButtonsLoading, clearJoinError, showJoinError } from './events.js';
import {
  initMutatorPanel,
  showChoiceCards, highlightSelectedCard,
  addPersistentCard, updatePersistentCards, expirePersistentCard,
  removeChoiceCard, addToHistory, restorePersistentCards, syncPersistentCards, renderMutatorHistory,
  renderBoardOverlaysAnimated,
  showTargetSelection, showRPSModal, showRPSResult,
  showRiskItRookOverlay,
  onRiskItRookFlipPrompt, onRiskItRookFlipResult,
  onCoinFlip, onCoinFlipStartAnimation, onCoinFlipPrompt, onCoinFlipResult,
} from './mutatorUI.js';

// ============================================================================
// BACKGROUND HELPERS
// ============================================================================


function buildTargetPrompt(payload, { isSecondChoice = false } = {}) {
  const serverPrompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : '';
  if (serverPrompt) return serverPrompt;

  const ruleName = payload?.ruleName || payload?.rule?.name || payload?.name || 'Mutator action';
  return isSecondChoice
    ? `${ruleName}: select your second target.`
    : `${ruleName}: select a target.`;
}

function cyclePageBackground() {
  const effects = [1, 2, 3, 4];
  const others = effects.filter(e => e !== state.currentBgEffect);
  const next = others[Math.floor(Math.random() * others.length)];
  state.currentBgEffect = next;
  stopPageBackground();
  startPageBackground(document.body, next);
}

// ============================================================================
// CONNECTION
// ============================================================================

export function onConnect() {
  console.log('[socket] Connected');
  // If already in an active game (Socket.IO auto-reconnected), don't re-emit resume
  if (state.isGameActive) return;
  if (state.myToken) {
    console.log('[boot] resumeSession emitted');
    state.socket.emit('resumeSession', { token: state.myToken });
    if (state.startResumeGuard) state.startResumeGuard();
  } else {
    // Fresh user or returned to landing — join lobby and fetch rooms immediately
    state.socket.emit('joinLobby');
    state.socket.emit('listRooms');
  }
}

export function onDisconnect() {
  console.log('[socket] Disconnected');
  state.disconnectedAt = Date.now();
  if (state.isGameActive) {
    flashStatus('Connection lost. Trying to reconnect...', 5000);
  }
}

export function onConnectError(err) {
  console.log('[boot] socket connect_error', err?.message || 'unknown');
  if (state.clearResumeGuard) state.clearResumeGuard();
  if (state.myToken && state.showResumeRecovery) {
    state.showResumeRecovery('Connection issue.');
  }
  flashStatus('Connection issue. You can retry or clear saved session.', 4500);
}

export function onRateLimited(payload) {
  const retryMs = Number(payload?.retryAfterMs) || 10000;
  const retrySec = Math.max(1, Math.round(retryMs / 1000));
  const evt = typeof payload?.event === 'string' ? payload.event : null;
  const suffix = evt ? ` (${evt})` : '';
  flashStatus(`Too many actions too quickly${suffix}. Please wait ~${retrySec}s.`, 2500);
}

// ============================================================================
// GAME LIFECYCLE
// ============================================================================

export function onJoinSuccess(payload) {
  console.log('[socket] joinSuccess', payload.roomCode);
  setButtonsLoading(false);
  clearJoinError();

  state.myColor = payload.color;
  state.myToken = payload.token;
  state.myName = payload.name;
  state.roomCode = payload.roomCode;

  saveToStorage(STORAGE_KEYS.token, state.myToken);
  saveToStorage(STORAGE_KEYS.name, state.myName);

  state.whitePlayer = payload.white;
  state.blackPlayer = payload.black;

  if (payload.board) {
    state.currentFen = payload.board.fen;
    state.currentTurn = payload.board.turn;
    syncChessInstance(state.currentFen);
  }

  state.isGameActive = payload.status === 'active';
  state.moveHistory = payload.moveHistory || [];
  state.capturedPieces = payload.capturedPieces || { w: [], b: [] };
  state.checkState = null;
  state.selectedSquare = null;
  state.legalMoves = [];
  state.lastMove = null;

  if (state.isGameActive) {
    showGame();
  } else {
    showWaiting(state.roomCode);
  }
}

export function onJoinError(payload) {
  setButtonsLoading(false);
  const message = typeof payload === 'string' ? payload : (payload?.message || 'Unable to join.');
  showJoinError(message);
}

export function onGameStarted(payload) {
  console.log('[socket] gameStarted');
  state.isGameActive = true;

  if (payload.board) {
    state.currentFen = payload.board.fen;
    state.currentTurn = payload.board.turn;
    syncChessInstance(state.currentFen);
  }

  state.whitePlayer = payload.white;
  state.blackPlayer = payload.black;

  state.selectedSquare = null;
  state.legalMoves = [];
  state.lastMove = null;
  state.checkState = null;
  state.moveHistory = [];
  state.capturedPieces = { w: [], b: [] };

  // Clear stale animation state from previous game
  state.isAnimating = false;
  state.animationPromise = null;
  state.activeAnimations = [];
  state.mutatorPanelAnimating = false;

  showGame();
  initMutatorPanel();
  setBaseStatus('Game started!');
}

export async function onMoveApplied(payload) {
  await waitForAnimation();

  const oldFen = state.currentFen;

  state.lastMove = { from: payload.from, to: payload.to };

  if (payload.board) {
    state.currentFen = payload.board.fen;
    state.currentTurn = payload.board.turn;
    syncChessInstance(state.currentFen);
  }

  if (payload.capturedPieces) {
    state.capturedPieces = payload.capturedPieces;
  }

  if (payload.moveHistory) {
    state.moveHistory = payload.moveHistory;
  }

  if (payload.white) state.whitePlayer = payload.white;
  if (payload.black) state.blackPlayer = payload.black;
  state.checkState = payload.checkState || null;

  state.selectedSquare = null;
  state.legalMoves = [];

  if (oldFen && state.currentFen && oldFen !== state.currentFen) {
    await animateMoveWithRender(oldFen, state.currentFen);
  } else {
    renderBoard();
  }

  updateTurnIndicator();
  renderCapturedPieces();
  updatePersistentCards();

  if (payload.skipTurn && payload.skipMessage) {
    flashStatus(payload.skipMessage, 3000);
  } else if (state.chessInstance && state.chessInstance.in_check()) {
    flashStatus('Check!', 2500);
  }
}

export function onMoveRejected(payload) {
  const message = typeof payload === 'string' ? payload : (payload?.message || payload?.error || 'Move rejected.');
  flashStatus(message, 3000);
}

export function onTurnClockUpdate(payload) {
  if (!payload || !payload.turnStartTime) return;
  startTurnClock(payload.turnStartTime, payload.durationMs);
  // Don't hide quiet-resign here -- the server controls its lifecycle via
  // explicit quietResignAvailable / quietResignRevoked events.
}

export function onQuietResignAvailable(payload) {
  if (state.isSpectator) return;
  if (payload.forColor === state.myColor) {
    setQuietResignAvailable(true);
  }
}

export function onQuietResignRevoked(payload) {
  if (state.isSpectator) return;
  if (payload.forColor === state.myColor) {
    setQuietResignAvailable(false);
  }
}

export function onGameEnded(payload) {
  console.log('[socket] gameEnded', payload.reason);
  state.isGameActive = false;
  state.isSpectator = false;
  stopTurnClock();
  setQuietResignAvailable(false);
  skipCurrentAnimations();

  if (payload.board) {
    state.currentFen = payload.board.fen;
    state.currentTurn = payload.board.turn;
    syncChessInstance(state.currentFen);
  }

  if (payload.white) state.whitePlayer = payload.white;
  if (payload.black) state.blackPlayer = payload.black;

  state.selectedSquare = null;
  state.legalMoves = [];
  state.checkState = null;

  renderBoard();
  updateTurnIndicator();

  const message = formatGameEndMessage(payload);
  showGameOverModal(message);

  removeFromStorage(STORAGE_KEYS.token);
}

export function onOpponentDisconnected(payload) {
  const timeout = payload?.timeout || 60;
  setBaseStatus(`Opponent disconnected. They have ${timeout}s to reconnect...`);
  flashStatus(`Opponent disconnected. Waiting ${timeout}s...`, 5000);
}

export function onOpponentReconnected() {
  setBaseStatus('Opponent reconnected.');
  flashStatus('Opponent reconnected!', 2500);
}

export function onResumeSuccess(payload) {
  console.log('[boot] resumeSuccess');
  console.log('[socket] resumeSuccess', payload.roomCode);
  if (state.clearResumeGuard) state.clearResumeGuard();
  state.resumeRecoveryShown = false;
  const recovery = document.getElementById('resume-recovery-actions');
  if (recovery) recovery.remove();

  state.myColor = payload.color;
  state.myToken = payload.token;
  state.myName = payload.name;
  state.roomCode = payload.roomCode;

  saveToStorage(STORAGE_KEYS.token, state.myToken);
  saveToStorage(STORAGE_KEYS.name, state.myName);

  state.whitePlayer = payload.white;
  state.blackPlayer = payload.black;

  if (payload.board) {
    state.currentFen = payload.board.fen;
    state.currentTurn = payload.board.turn;
    syncChessInstance(state.currentFen);
  }

  state.isGameActive = payload.status === 'active';
  state.moveHistory = payload.moveHistory || [];
  state.capturedPieces = payload.capturedPieces || { w: [], b: [] };
  state.checkState = payload.checkState || null;

  if (state.isGameActive) {
    showGame();

    // Restore mutator panel state from server
    if (payload.mutatorState) {
      state.mutatorState = payload.mutatorState;
      // Restore completed mutator history for left sidebar
      if (payload.mutatorState.completedMutators) {
        state.mutatorHistory = payload.mutatorState.completedMutators.map(m => ({
          id: m.id,
          name: m.name,
          description: m.description || '',
          type: m.type,
        }));
        renderMutatorHistory();
      }
      restorePersistentCards();
      renderBoardOverlaysAnimated();

      // Restore pending mutator UI states
      const ms = payload.mutatorState;
      if (ms.pendingChoice) {
        showChoiceCards(ms.pendingChoice.options, ms.pendingChoice.chooser === state.myColor);
      } else if (ms.pendingAction && ms.pendingAction.forPlayer === state.myColor) {
        const prompt = buildTargetPrompt(ms.pendingAction);
        const validSquares = ms.pendingAction.sophieOptions || null;
        showTargetSelection(prompt, ms.pendingAction.actionType, (targets) => {
          state.socket.emit('mutatorActionResponse', { ruleId: ms.pendingAction.ruleId, targets });
        }, validSquares);
      } else if (ms.pendingSecondAction && ms.pendingSecondAction.forPlayer === state.myColor) {
        showTargetSelection(buildTargetPrompt(ms.pendingSecondAction, { isSecondChoice: true }), ms.pendingSecondAction.actionType, (targets) => {
          state.socket.emit('mutatorActionResponse', { ruleId: ms.pendingSecondAction.ruleId, targets });
        });
      } else if (ms.pendingRPS) {
        const isAttacker = ms.pendingRPS.attacker === state.myColor;
        const isDefender = ms.pendingRPS.defender === state.myColor;
        const needsChoice = (isAttacker && !ms.pendingRPS.attackerChoice) ||
                            (isDefender && !ms.pendingRPS.defenderChoice);
        if (needsChoice) {
          showRPSModal(ms.pendingRPS);
        }
      } else if (ms.pendingCoinFlip && ms.pendingCoinFlip.forPlayer === state.myColor) {
        onCoinFlipPrompt(ms.pendingCoinFlip);
      }
    }

    // Restore turn clock and quiet resign state
    if (payload.turnStartTime) {
      startTurnClock(payload.turnStartTime, payload.turnDurationMs);
    } else {
      stopTurnClock();
    }
    if (payload.quietResignFor && payload.quietResignFor === state.myColor) {
      setQuietResignAvailable(true);
    } else {
      setQuietResignAvailable(false);
    }

    // Only show "Reconnected" if the disconnect was noticeable (>2s)
    const disconnectDuration = state.disconnectedAt ? Date.now() - state.disconnectedAt : 0;
    if (disconnectDuration > 2000) {
      setBaseStatus('Reconnected to the game.');
    }
    state.disconnectedAt = null;
  } else if (payload.status === 'waiting') {
    showWaiting(state.roomCode);
  } else {
    clearSession();
    showLanding();
  }
}

export function onResumeRejected(payload) {
  console.log('[boot] resumeRejected');
  console.log('[socket] resumeRejected');
  if (state.clearResumeGuard) state.clearResumeGuard();
  // Don't destroy an active game if this was a spurious resume attempt
  if (state.isGameActive) return;
  if (state.showResumeRecovery) {
    state.showResumeRecovery('Saved session is no longer valid.');
  } else {
    clearSession();
    showLanding();
  }
  // Immediately join lobby and fetch rooms since we're back on landing
  if (state.socket && state.socket.connected) {
    state.socket.emit('joinLobby');
    state.socket.emit('listRooms');
  }
}

export function onRoomsList(payload) {
  // Support both old format (array) and new format ({waiting, active})
  if (Array.isArray(payload)) {
    renderRoomsList(payload, []);
  } else {
    const waiting = payload?.waiting || payload?.rooms || [];
    const active = payload?.active || [];
    renderRoomsList(waiting, active);
  }
}

// ============================================================================
// MUTATOR EVENTS
// ============================================================================

export function onMutatorChoice(payload) {
  state.mutatorState = state.mutatorState || {};
  state.mutatorState.pendingChoice = payload;

  showChoiceCards(payload.options, payload.chooser === state.myColor);
}

export async function onMutatorSelected(payload) {
  // Synchronized highlight -- both clients see the selected card
  await highlightSelectedCard(payload.ruleId);
}

export async function onMutatorChosen(payload) {
  // Action-required path: highlight the card, then show status
  await highlightSelectedCard(payload.rule.id);
  flashStatus(`${payload.rule.name} selected -- action required`, 3000);
}

export function onMutatorAction(payload) {
  const validSquares = payload.sophieOptions || null;
  showTargetSelection(buildTargetPrompt(payload), payload.actionType, (targets) => {
    state.socket.emit('mutatorActionResponse', { ruleId: payload.ruleId, targets });
  }, validSquares);
}

export async function onMutatorActivated(payload) {
  await waitForAnimation();
  state.isChoosingRule = false;

  // Show Risk it Rook coin flip visualization before updating board
  if (payload.riskItRookFlip) {
    await showRiskItRookOverlay(payload.riskItRookFlip);
  }

  const oldFen = state.currentFen;

  if (payload.fen) {
    state.currentFen = payload.fen;
    syncChessInstance(state.currentFen);
  }

  if (oldFen && payload.fen && oldFen !== payload.fen) {
    await animateMoveWithRender(oldFen, state.currentFen);
  } else {
    renderBoard();
  }

  if (payload.mutatorState) {
    state.mutatorState = payload.mutatorState;
    renderBoardOverlaysAnimated();
  }

  // Card lifecycle: persistent stays, instant exits + goes to history
  const rule = payload.rule;
  if (rule) {
    const hasDuration = rule.duration || (payload.mutatorState?.activeRules?.find(ar => ar.id === rule.id)?.expiresAtMove != null);
    if (hasDuration) {
      addPersistentCard(rule);
      addToHistory(rule, 'persistent');
    } else {
      await removeChoiceCard(rule.id);
      addToHistory(rule, 'instant');
    }
    // Re-render history in the choice panel so newly added entry appears
    renderMutatorHistory();
  }

  // Restore any previously-active persistent cards that were cleared during selection
  syncPersistentCards();

  flashStatus(`${rule?.name || 'Mutator'} activated!`, 3000);
}

export async function onMutatorExpired(payload) {
  await waitForAnimation();

  const oldFen = state.currentFen;

  if (payload.fen) {
    state.currentFen = payload.fen;
    syncChessInstance(state.currentFen);
  }

  if (oldFen && payload.fen && oldFen !== payload.fen) {
    await animateMoveWithRender(oldFen, state.currentFen);
  } else {
    renderBoard();
  }

  if (payload.mutatorState) {
    state.mutatorState = payload.mutatorState;
    renderBoardOverlaysAnimated();
  }

  // Drop the persistent card and add to history
  await expirePersistentCard(payload.ruleId);
  addToHistory({ id: payload.ruleId, name: payload.name, description: payload.description || '' }, 'expired');
  renderMutatorHistory();

  flashStatus(`${payload.name} expired`, 2000);
}

export async function onMutatorBoardUpdate(payload) {
  await waitForAnimation();

  // Show Risk it Rook coin flip visualization if present
  if (payload.riskItRookFlip) {
    await showRiskItRookOverlay(payload.riskItRookFlip);
  }

  const oldFen = state.currentFen;

  if (payload.fen) {
    state.currentFen = payload.fen;
    syncChessInstance(state.currentFen);
  }

  if (oldFen && payload.fen && oldFen !== payload.fen) {
    await animateMoveWithRender(oldFen, state.currentFen);
  } else {
    renderBoard();
  }

  if (payload.mutatorState) {
    state.mutatorState = payload.mutatorState;
    updatePersistentCards();
    renderBoardOverlaysAnimated();
  }
}

export function onRPSPrompt(payload) {
  showRPSModal(payload);
}

export function onRPSResult(payload) {
  showRPSResult(payload);
}

// ============================================================================
// SPECTATOR EVENTS
// ============================================================================

export function onSpectateSuccess(payload) {
  console.log('[socket] spectateSuccess', payload.roomCode);
  setButtonsLoading(false);
  clearJoinError();

  state.isSpectator = true;
  state.myColor = null;
  state.roomCode = payload.roomCode;
  state.isGameActive = true;

  state.whitePlayer = payload.white;
  state.blackPlayer = payload.black;

  if (payload.board) {
    state.currentFen = payload.board.fen;
    state.currentTurn = payload.board.turn;
    syncChessInstance(state.currentFen);
  }

  state.moveHistory = payload.moveHistory || [];
  state.capturedPieces = payload.capturedPieces || { w: [], b: [] };
  state.checkState = payload.checkState || null;

  if (payload.mutatorState) {
    state.mutatorState = payload.mutatorState;
  }

  showGame();

  // Set initial flip state without animation so card doesn't transition on join
  const titleCard = document.getElementById('title-card');
  if (titleCard && state.currentTurn === 'b') {
    titleCard.style.transition = 'none';
    titleCard.classList.add('flip');
    requestAnimationFrame(() => {
      titleCard.style.transition = '';
    });
  }

  // Sync turn clock if the game is using it
  if (payload.turnStartTime) {
    startTurnClock(payload.turnStartTime, payload.turnDurationMs);
  }

  // Restore mutator panel state
  if (payload.mutatorState) {
    if (payload.mutatorState.completedMutators) {
      state.mutatorHistory = payload.mutatorState.completedMutators.map(m => ({
        id: m.id,
        name: m.name,
        description: m.description || '',
        type: m.type,
      }));
      renderMutatorHistory();
    }
    restorePersistentCards();
    renderBoardOverlaysAnimated();
  }
}

export function onSpectateKicked() {
  console.log('[socket] spectateKicked');
  flashStatus('Spectating has been disabled by a player.', 5000);
  state.isSpectator = false;
  state.isGameActive = false;
  state.roomCode = null;
  showLanding();
}

export function onSpectateError(payload) {
  setButtonsLoading(false);
  const message = typeof payload === 'string' ? payload : (payload?.message || 'Cannot spectate.');
  showJoinError(message);
}

export function onSpectatorCount(payload) {
  const el = document.getElementById('spectator-count');
  if (el && payload?.count != null) {
    el.textContent = `${payload.count} watching`;
    el.classList.toggle('hidden', payload.count === 0);
  }
}

// Re-export coin flip handlers from mutatorUI
export {
  onCoinFlip,
  onCoinFlipStartAnimation,
  onCoinFlipPrompt,
  onCoinFlipResult,
  onRiskItRookFlipPrompt,
  onRiskItRookFlipResult,
};
