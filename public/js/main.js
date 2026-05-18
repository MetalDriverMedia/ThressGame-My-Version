// ============================================================================
// MAIN -- Entry point & socket wiring
// ============================================================================

import { state, elements, STORAGE_KEYS, socketPath, randomChessName } from './state.js';
import { startPageBackground } from './animated-bg.js';
import { loadFromStorage } from './storage.js';
import {
  showPanel, setUIRenderers, preloadPieceImages, flashStatus,
  renderCapturedPieces, fetchScoreboard, fetchMotd, onScoreboardUpdate,
} from './ui.js';
import { renderBoard, setOverlayRenderer } from './board.js';
import { renderBoardOverlays } from './mutatorUI.js';
import { bindLandingEvents, bindWaitingEvents, bindGameEvents, bindModalEvents, initMutatorSettings } from './events.js';
import {
  onConnect, onDisconnect, onConnectError,
  onJoinSuccess, onJoinError, onGameStarted,
  onMoveApplied, onMoveRejected, onGameEnded,
  onOpponentDisconnected, onOpponentReconnected,
  onResumeSuccess, onResumeRejected, onRoomsList,
  onMutatorChoice, onMutatorSelected, onMutatorChosen, onMutatorAction,
  onMutatorActivated, onMutatorExpired, onMutatorBoardUpdate,
  onRPSPrompt, onRPSResult,
  onCoinFlip, onCoinFlipStartAnimation, onCoinFlipPrompt, onCoinFlipResult,
  onRiskItRookFlipPrompt, onRiskItRookFlipResult,
  onSpectateSuccess, onSpectateKicked, onSpectateError, onSpectatorCount,
  onTurnClockUpdate, onQuietResignAvailable, onQuietResignRevoked,
  onRateLimited,
} from './socketHandlers.js';

const RESUME_TIMEOUT_MS = 3500;
let resumeTimeoutId = null;

function clearResumeGuard() {
  if (resumeTimeoutId) {
    clearTimeout(resumeTimeoutId);
    resumeTimeoutId = null;
  }
  state.resumePending = false;
}

function removeRecoveryActions() {
  const existing = document.getElementById('resume-recovery-actions');
  if (existing) existing.remove();
}

function startResumeGuard() {
  clearResumeGuard();
  state.resumePending = true;
  resumeTimeoutId = setTimeout(() => {
    if (!state.resumePending) return;
    console.log('[boot] resume timeout recovery');
    showResumeRecovery('Session resume timed out.');
  }, RESUME_TIMEOUT_MS);
}

function clearSavedSessionAndRecover() {
  try {
    localStorage.removeItem(STORAGE_KEYS.token);
    localStorage.removeItem(STORAGE_KEYS.name);
  } catch {
    // Storage may be unavailable.
  }
  try {
    sessionStorage.clear();
  } catch {
    // sessionStorage may be unavailable.
  }

  state.myToken = null;
  clearResumeGuard();
  state.resumeRecoveryShown = false;

  showPanel('landing');
  removeRecoveryActions();
  flashStatus('Saved session cleared. Start a new game or join a room.', 3500);

  if (state.socket && state.socket.connected) {
    state.socket.emit('joinLobby');
    state.socket.emit('listRooms');
  }
}

function showResumeRecovery(reason = 'Unable to restore your previous session.') {
  if (state.resumeRecoveryShown) return;
  state.resumeRecoveryShown = true;
  state.resumePending = false;
  showPanel('landing');
  flashStatus(`${reason} You can retry or clear saved session.`, 5000);

  let cleared = false;
  const clearOnce = () => {
    if (cleared) return;
    cleared = true;
    clearSavedSessionAndRecover();
  };

  removeRecoveryActions();

  const actionWrap = document.createElement('div');
  actionWrap.id = 'resume-recovery-actions';
  actionWrap.style.display = 'flex';
  actionWrap.style.gap = '8px';
  actionWrap.style.marginTop = '12px';

  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.textContent = 'Retry Resume';
  retryBtn.addEventListener('click', () => {
    if (state.myToken && state.socket && state.socket.connected) {
      actionWrap.remove();
      state.resumeRecoveryShown = false;
      console.log('[boot] resumeSession emitted (manual retry)');
      state.socket.emit('resumeSession', { token: state.myToken });
      startResumeGuard();
    } else {
      if (state.socket && typeof state.socket.connect === 'function') {
        state.socket.connect();
      }
      flashStatus('Socket is not connected yet. Reconnecting… then retry.', 3500);
    }
  });

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.textContent = 'Clear Saved Session';
  clearBtn.addEventListener('click', clearOnce);

  actionWrap.appendChild(retryBtn);
  actionWrap.appendChild(clearBtn);
  elements.landingPanel?.appendChild(actionWrap);
}

// --- Wire cross-module renderers ----------------------------------

// ui.js needs board renderers but can't import board.js (circular)
setUIRenderers({ renderBoard, renderCapturedPieces });

// board.js needs overlay renderer but can't import mutatorUI.js (circular)
setOverlayRenderer(renderBoardOverlays);

// --- Socket Connection --------------------------------------------

function connectSocket() {
  const opts = {
    path: socketPath,
    transports: ['websocket', 'polling'],
  };
  state.socket = io('/', opts);

  state.socket.on('connect', onConnect);
  state.socket.on('disconnect', onDisconnect);
  state.socket.on('connect_error', onConnectError);

  // Game lifecycle
  state.socket.on('joinSuccess', onJoinSuccess);
  state.socket.on('joinError', onJoinError);
  state.socket.on('gameStarted', onGameStarted);
  state.socket.on('moveApplied', onMoveApplied);
  state.socket.on('moveRejected', onMoveRejected);
  state.socket.on('gameEnded', onGameEnded);
  state.socket.on('opponentDisconnected', onOpponentDisconnected);
  state.socket.on('opponentReconnected', onOpponentReconnected);
  state.socket.on('resumeSuccess', onResumeSuccess);
  state.socket.on('resumeRejected', onResumeRejected);
  state.socket.on('roomsList', onRoomsList);
  state.socket.on('scoreboardUpdate', onScoreboardUpdate);

  // Spectator events
  state.socket.on('spectateSuccess', onSpectateSuccess);
  state.socket.on('spectateKicked', onSpectateKicked);
  state.socket.on('spectateError', onSpectateError);
  state.socket.on('spectatorCount', onSpectatorCount);

  state.socket.on('resignError', (msg) => flashStatus(msg || 'Resign failed.', 3000));

  // Turn clock + quiet resign
  state.socket.on('turnClockUpdate', onTurnClockUpdate);
  state.socket.on('quietResignAvailable', onQuietResignAvailable);
  state.socket.on('quietResignRevoked', onQuietResignRevoked);
  state.socket.on('rateLimited', onRateLimited);

  // Mutator events
  state.socket.on('mutatorChoice', onMutatorChoice);
  state.socket.on('mutatorSelected', onMutatorSelected);
  state.socket.on('mutatorChosen', onMutatorChosen);
  state.socket.on('mutatorAction', onMutatorAction);
  state.socket.on('mutatorActivated', onMutatorActivated);
  state.socket.on('mutatorExpired', onMutatorExpired);
  state.socket.on('mutatorBoardUpdate', onMutatorBoardUpdate);
  state.socket.on('rpsPrompt', onRPSPrompt);
  state.socket.on('rpsResult', onRPSResult);
  state.socket.on('coinFlip', onCoinFlip);
  state.socket.on('coinFlipPrompt', onCoinFlipPrompt);
  state.socket.on('coinFlipResult', onCoinFlipResult);
  state.socket.on('coinFlipStart', onCoinFlipStartAnimation);
  state.socket.on('riskItRookFlipPrompt', onRiskItRookFlipPrompt);
  state.socket.on('riskItRookFlipResult', onRiskItRookFlipResult);
}

// --- Initialization -----------------------------------------------

(function init() {
  console.log('[boot] init start');
  state.showResumeRecovery = showResumeRecovery;
  state.clearSavedSessionAndRecover = clearSavedSessionAndRecover;
  state.startResumeGuard = startResumeGuard;
  state.clearResumeGuard = clearResumeGuard;

  const savedToken = loadFromStorage(STORAGE_KEYS.token);
  if (savedToken) {
    console.log('[boot] saved token detected');
    state.myToken = savedToken;
    elements.landingPanel?.classList.add('hidden');
  } else {
    showPanel('landing');
  }

  // Restore saved name or use default
  const savedName = loadFromStorage(STORAGE_KEYS.name);
  if (elements.nameInput) {
    elements.nameInput.value = savedName || randomChessName();
  }

  // Page background disabled - using static matte
  // startPageBackground(document.body);

  // Preload SVG icons (captured pieces, etc.)
  preloadPieceImages();

  // Preload PNG piece art variations
  const _pieceVariationTypes = ['king', 'queen', 'bishop', 'knight', 'rook', 'pawn'];
  const _pieceVariationCounts = { king: 1, queen: 1, bishop: 2, knight: 2, rook: 2, pawn: 8 };
  const _assetBase = window.__assetBasePath !== undefined ? window.__assetBasePath : (window.CHESS_BASE_PATH && window.CHESS_BASE_PATH !== '/' ? window.CHESS_BASE_PATH : '');
  for (const color of ['white', 'black']) {
    for (const type of _pieceVariationTypes) {
      for (let v = 1; v <= _pieceVariationCounts[type]; v++) {
        const img = new Image();
        img.src = `${_assetBase}/images/pieces/${color}-${type}-${v}.png`;
      }
    }
  }

  // Connect socket after startup recovery handlers and saved token are in state.
  connectSocket();

  // Check for ?watch= query param
  const urlParams = new URLSearchParams(window.location.search);
  const watchCode = urlParams.get('watch');
  if (watchCode) {
    // Wait for socket connection, then spectate
    state.socket.once('connect', () => {
      state.socket.emit('spectateRoom', { roomCode: watchCode });
    });
  }

  // Bind all event listeners
  bindLandingEvents();
  bindWaitingEvents();
  bindGameEvents();
  bindModalEvents();

  // Load mutator settings and scoreboard
  initMutatorSettings();
  fetchScoreboard();
  fetchMotd();

})();
