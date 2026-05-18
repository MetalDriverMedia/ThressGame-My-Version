// ============================================================================
// SHARED STATE & CONSTANTS
// All mutable game state lives in the `state` object.
// Every module imports and reads/writes `state.xxx`.
// ============================================================================

const rawBasePath =
  (typeof window !== 'undefined' && window.CHESS_BASE_PATH) || '/';
export const basePath = rawBasePath && rawBasePath !== '' ? rawBasePath : '/';
const rawSocketPath =
  (typeof window !== 'undefined' && window.CHESS_SOCKET_PATH) || '/socket.io';
export const socketPath = rawSocketPath || '/socket.io';
export const assetBasePath = basePath === '/' ? '' : basePath;

export function apiPath(endpoint) {
  const normalized = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${assetBasePath}${normalized}`;
}

export const STORAGE_KEYS = {
  token: 'chess.playerToken',
  name: 'chess.playerName',
  browserId: 'chess.browserId',
};

// Stable per-browser identity. Persists across page loads in localStorage so
// the server can distinguish two players on the same network using different
// browsers/devices, while still preventing self-join from the same browser.
export function getOrCreateBrowserId() {
  try {
    let id = localStorage.getItem(STORAGE_KEYS.browserId);
    if (!id) {
      id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : 'b-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(STORAGE_KEYS.browserId, id);
    }
    return id;
  } catch {
    // localStorage unavailable -- fall back to per-session id
    return 'session-' + Math.random().toString(36).slice(2);
  }
}

export const COLOR_NAMES = { w: 'White', b: 'Black' };

export const PIECE_NAMES = {
  k: 'King',
  q: 'Queen',
  r: 'Rook',
  b: 'Bishop',
  n: 'Knight',
  p: 'Pawn',
};

export const PIECE_ICONS = {
  w: {
    k: 'kingwhite.svg',
    q: 'queenwhite.svg',
    r: 'rookwhite.svg',
    b: 'bishopwhite.svg',
    n: 'knightwhite.svg',
    p: 'pawnwhite.svg',
  },
  b: {
    k: 'kingblack.svg',
    q: 'queenblack.svg',
    r: 'rookblack.svg',
    b: 'bishopblack.svg',
    n: 'knightblack.svg',
    p: 'pawnblack.svg',
  },
};

export const PIECE_VARIATION_COUNTS = {
  k: 1, q: 1, b: 2, n: 2, r: 2, p: 8,
};

// --- Mutable State --------------------------------------------------

export const state = {
  socket: null,
  myColor: null,
  myToken: null,
  myName: null,
  roomCode: null,
  roomMetadata: null,

  isGameActive: false,
  isSpectator: false,
  currentFen: null,
  currentTurn: null,
  moveHistory: [],
  capturedPieces: { w: [], b: [] },

  whitePlayer: null,
  blackPlayer: null,

  selectedSquare: null,
  legalMoves: [],
  lastMove: null,

  chessInstance: null,

  flashTimeout: null,
  baseStatus: '',
  roomsPollingInterval: null,

  pendingPromotion: null,

  // Turn clock
  turnStartTime: null,
  turnDurationMs: 180000,
  turnTimerRaf: null,
  quietResignAvailable: false,

  // Mutator-aware check state from server (overrides chess.js's check display)
  checkState: null,

  // Mutator
  mutatorState: null,
  allRules: [],
  disabledMutators: new Set(),
  manualCoinFlip: false,
  isChoosingRule: false,
  isSelectingTarget: false,
  targetSelectionCallback: null,

  // Mutator panel
  mutatorPanelAnimating: false,
  mutatorHistory: [],

  // Animation
  isAnimating: false,
  animationPromise: null,
  activeAnimations: [],

  // Piece art
  pieceArtVariations: {},

  // Animated background
  currentBgEffect: 1,

  // Startup resume recovery
  resumePending: false,
  resumeRecoveryShown: false,
  showResumeRecovery: null,
  clearSavedSessionAndRecover: null,
  startResumeGuard: null,
  clearResumeGuard: null,
};

// --- DOM Caches -----------------------------------------------------

export const boardSquares = new Map();
export const pieceImageCache = new Map();
export const renderedPieces = new Map();

// --- DOM Elements ---------------------------------------------------

export const elements = {
  // Landing
  landingPanel: document.getElementById('landing-panel'),
  nameInput: document.getElementById('name-input'),
  joinError: document.getElementById('join-error'),
  createRoomBtn: document.getElementById('create-room-btn'),
  joinRoomBtn: document.getElementById('join-room-btn'),
  playBotBtn: document.getElementById('play-bot-btn'),
  joinCodeSection: document.getElementById('join-code-section'),
  roomCodeInput: document.getElementById('room-code-input'),
  joinCodeSubmit: document.getElementById('join-code-submit'),
  createOptionsSection: document.getElementById('create-options-section'),
  colorSelect: document.getElementById('color-select'),
  privateCheck: document.getElementById('private-check'),
  createRoomSubmit: document.getElementById('create-room-submit'),
  roomsList: document.getElementById('rooms-list'),

  // Waiting
  waitingPanel: document.getElementById('waiting-panel'),
  roomCodeText: document.getElementById('room-code-text'),
  roomCodeCopy: document.getElementById('room-code-copy'),
  roomCodeToggle: document.getElementById('room-code-toggle'),
  waitingRoomMeta: document.getElementById('waiting-room-meta'),
  copyFeedback: document.getElementById('copy-feedback'),
  cancelWaitingBtn: document.getElementById('cancel-waiting-btn'),

  // Game
  gamePanel: document.getElementById('game-panel'),
  gameStatus: document.getElementById('game-status'),
  board: document.getElementById('board'),
  opponentName: document.getElementById('opponent-name'),
  opponentCaptured: document.getElementById('opponent-captured'),
  myNameDisplay: document.getElementById('my-name-display'),
  myCaptured: document.getElementById('my-captured'),
  resignButton: document.getElementById('resign-button'),
  sidebarRoomCode: document.getElementById('sidebar-room-code'),
  sidebarCodeToggle: document.getElementById('sidebar-code-toggle'),
  fullscreenBtn: document.getElementById('fullscreen-btn'),
  turnIndicator: document.getElementById('turn-indicator'),
  turnText: document.getElementById('turn-text'),
  titleCard: document.getElementById('title-card'),
  mutatorPanel: document.getElementById('mutator-panel'),
  mutatorChoicePanel: document.getElementById('mutator-choice-panel'),
  activeMutatorsRow: document.getElementById('active-mutators-row'),
  infoBar: document.querySelector('.info-bar'),
  sidebarStatus: document.getElementById('sidebar-status'),

  // Spectator
  spectatorBanner: document.getElementById('spectator-banner'),
  spectatorCount: document.getElementById('spectator-count'),
  disableSpectatingBtn: document.getElementById('disable-spectating-btn'),

  // Promotion modal
  promotionModal: document.getElementById('promotion-modal'),
  promotionChoices: document.getElementById('promotion-choices'),

  // Game over modal
  gameOverModal: document.getElementById('game-over-modal'),
  gameOverText: document.getElementById('game-over-text'),
  gameOverNewGame: document.getElementById('game-over-new-game'),
  gameOverQuit: document.getElementById('game-over-quit'),

};

// --- Utilities ------------------------------------------------------

export function normalizeRoomCode(value) {
  return String(value || '').trim().toUpperCase();
}

export function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

const _namePool = {
  adj: [
    'Sneaky', 'Blundering', 'Brave', 'Doomed', 'Greedy', 'Cursed',
    'Chaotic', 'Sleepy', 'Feral', 'Cowardly', 'Mighty', 'Tiny',
    'Grumpy', 'Reckless', 'Panicked', 'Lazy', 'Angry', 'Lost',
    'Haunted', 'Confused', 'Foolish', 'Dramatic', 'Nervous', 'Smug',
    'Unhinged', 'Tragic', 'Hungry', 'Screaming', 'Retired', 'Feral',
  ],
  noun: [
    'Pawn', 'Knight', 'Bishop', 'Rook', 'King', 'Queen',
    'Gambit', 'Blunder', 'Fork', 'Pin', 'Checkmate', 'Stalemate',
    'Castler', 'Sacrifice', 'Fianchetto', 'Zugzwang', 'Patzer',
    'EnPassant', 'Tempo', 'Promotion', 'Skewer', 'Endgame',
  ],
  suffix: [
    '', '', '', '', '', '', // weighted toward no suffix
    '42', '99', '007', 'Jr', 'III', 'PhD', 'Esq',
    'XD', '69', 'TTV', 'IRL', 'lol',
  ],
};

export function randomChessName() {
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  return pick(_namePool.adj) + pick(_namePool.noun) + pick(_namePool.suffix);
}
