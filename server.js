const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const { GameManager } = require('./gameManager');
const { serializeBoardForClient, getPublicPlayer } = require('./gameController');
const { handleCreateRoom, handleJoinRoom, handleJoinBot, handleListRooms } = require('./handlers/joinHandler');
const { handleMove } = require('./handlers/moveHandler');
const { handleDisconnect, handleResign, handleQuietResign, handleResume } = require('./handlers/playerHandlers');
const { handleSpectateRoom, handleDisableSpectating, handleSpectatorDisconnect } = require('./handlers/spectatorHandler');
const { createMutatorHandlers } = require('./handlers/mutatorHandler');
const { addBotToRoom, scheduleBotMove, generateBotTarget } = require('./botManager');
const { formatBasePath, buildSocketPath, registerConfigRoute } = require('./utils/config');
const { flushSaves } = require('./utils/scoreboard');
const turnClock = require('./utils/turnClock');
const { autoResignOnTimeout } = require('./utils/gameLifecycle');

// Routes
const { setupApiRoutes } = require('./routes/apiRoutes');

// --- Configuration -----------------------------------------------------------

const PORT = process.env.PORT || 3000;
const BASE_PATH = formatBasePath(process.env.BASE_PATH);
const SOCKET_PATH = buildSocketPath(BASE_PATH);

// --- Express Setup -----------------------------------------------------------

const app = express();

// cPanel/Passenger subfolder support: strip BASE_PATH prefix from incoming URLs
if (BASE_PATH !== '/') {
  app.use((req, _res, next) => {
    if (req.url.startsWith(BASE_PATH)) {
      req.url = req.url.slice(BASE_PATH.length) || '/';
    }
    next();
  });
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Config route (exposes BASE_PATH and SOCKET_PATH to the client)
registerConfigRoute(app, BASE_PATH, SOCKET_PATH);

// API routes (health check, etc.) -- before static files
app.use('/api', setupApiRoutes());

// --- HTTP Server & Socket.IO -------------------------------------------------

const httpServer = createServer(app);
const io = new Server(httpServer, {
  path: SOCKET_PATH,
  cors: {
    origin: true,
    credentials: true,
  },
  transports: ['polling', 'websocket'],
  pingTimeout: 120000,
  pingInterval: 25000,
});

// --- Game Infrastructure -----------------------------------------------------

const gameManager = new GameManager();

// When a turn timer expires, auto-resign the staller
turnClock.setTimeoutResignHandler((room, io, stallingColor) => {
  autoResignOnTimeout(room, io, gameManager, stallingColor);
});

// Static files
// URL rewriting middleware above strips BASE_PATH, so serve at '/'
const STATIC_DIR = path.join(__dirname, 'public');

// Serve index.html with the current package version injected as a cache-buster
// on the main.js script tag and the footer version label, so browsers always
// fetch the latest module bundle after a deploy without a manual hard-refresh.
const fs = require('fs');
const APP_VERSION = require('./package.json').version;
const INDEX_PATH = path.join(STATIC_DIR, 'index.html');
function serveIndex(_req, res) {
  fs.readFile(INDEX_PATH, 'utf8', (err, html) => {
    if (err) return res.status(500).send('index unavailable');
    const stamped = html.replace(/main\.js\?v=[^"']+/g, `main.js?v=${APP_VERSION}`);
    res.set('Cache-Control', 'no-store');
    res.type('html').send(stamped);
  });
}
app.get('/', serveIndex);
app.get('/index.html', serveIndex);

app.use(express.static(STATIC_DIR, { index: ['index.html'] }));

/**
 * Start a game when both players are in the room.
 */
function startGame(room) {
  room.startGame();
  const boardState = serializeBoardForClient(room.chess);
  io.to(room.roomCode).emit('gameStarted', {
    board: boardState,
    white: getPublicPlayer(room.white),
    black: getPublicPlayer(room.black),
  });
  // Start turn clock for the first player (skipped for bot games)
  turnClock.startClock(room, io);
  // If bot goes first (white), schedule its move
  scheduleBotMove(room, io, gameManager, handleMove, botAutoMutatorResponse);
}

/**
 * Add a bot opponent to a room.
 */
function addBot(room, color) {
  const bot = addBotToRoom(room, color);
  gameManager.setSocketRoom(bot.socketId, room.roomCode);
}

/**
 * Broadcast the updated public waiting rooms list to all connected clients.
 */
function broadcastRoomUpdate() {
  io.to('lobby').emit('roomsList', {
    waiting: gameManager.getPublicWaitingRooms(),
    active: gameManager.getSpectatableRooms(),
  });
}

// Initialize mutator handlers with dependencies
const { botAutoMutatorResponse, registerSocketHandlers: registerMutatorHandlers } =
  createMutatorHandlers({ handleMove, scheduleBotMove, generateBotTarget });

// --- Socket.IO Rate Limiting -------------------------------------------------

function createRateLimiter(windowMs) {
  const counts = new Map(); // key: socket.id:eventName -> count
  const lastWarnAt = new Map();
  const EVENT_LIMITS = new Map([
    // User-clicked room flow events should almost never be bursty.
    ['createRoom', 8],
    ['joinRoom', 10],
    ['joinBot', 6],
    ['listRooms', 30],
    ['joinLobby', 20],

    // Spectator / session
    ['spectateRoom', 20],
    ['disableSpectating', 8],
    ['resumeSession', 10],

    // Gameplay
    ['move', 45],
    ['resign', 6],
    ['quietResign', 6],

    // Mutator interactions
    ['selectMutator', 20],
    ['mutatorActionResponse', 20],
    ['rpsChoice', 20],
    ['coinFlipChoice', 20],
    ['coinFlipStart', 20],
    ['riskItRookFlipChoice', 20],
  ]);

  setInterval(() => counts.clear(), windowMs);
  return function rateLimit(socket, eventName, next) {
    const maxPerWindow = EVENT_LIMITS.get(eventName) || 60;
    const key = `${socket.id}:${eventName}`;
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    if (count > maxPerWindow) {
      const now = Date.now();
      const prev = lastWarnAt.get(socket.id) || 0;
      if (now - prev > 1000) {
        socket.emit('rateLimited', { retryAfterMs: windowMs, event: eventName });
        lastWarnAt.set(socket.id, now);
      }
      return;
    }
    next();
  };
}

const socketRateLimit = createRateLimiter(10_000);

// --- Socket.IO Connection Handler --------------------------------------------

io.on('connection', (socket) => {
  // New connections start in the lobby for scoped broadcasts
  socket.join('lobby');

  // Rate-limit all incoming events
  socket.use((packet, next) => {
    const eventName = Array.isArray(packet) ? packet[0] : 'unknown';
    socketRateLimit(socket, eventName, next);
  });

  // Room management
  socket.on('createRoom', (data) => handleCreateRoom(io, socket, gameManager, data, broadcastRoomUpdate));
  socket.on('joinRoom', (data) => handleJoinRoom(io, socket, gameManager, data, startGame, broadcastRoomUpdate));
  socket.on('joinBot', (data) => handleJoinBot(io, socket, gameManager, data, startGame, addBot));
  socket.on('listRooms', () => handleListRooms(socket, gameManager));
  socket.on('joinLobby', () => socket.join('lobby'));

  // Spectating
  socket.on('spectateRoom', (data) => handleSpectateRoom(io, socket, gameManager, data));
  socket.on('disableSpectating', () => handleDisableSpectating(io, socket, gameManager));

  // Game actions
  socket.on('move', (data) => {
    handleMove(io, socket, gameManager, data);
    // After human move, schedule bot response if opponent is bot
    const room = gameManager.getRoomForSocket(socket.id);
    if (room && room.status === 'active') {
      scheduleBotMove(room, io, gameManager, handleMove, botAutoMutatorResponse);
    }
    // Bot auto-responds to mutator prompts (with humanizing delay)
    if (room && room.mutatorState) {
      setTimeout(() => botAutoMutatorResponse(room, io, gameManager), 1200 + Math.random() * 600);
    }
  });
  socket.on('resign', () => handleResign(io, socket, gameManager, broadcastRoomUpdate));
  socket.on('quietResign', () => handleQuietResign(io, socket, gameManager, broadcastRoomUpdate));

  // Mutator events (selectMutator, mutatorActionResponse, rpsChoice, coinFlipChoice, coinFlipStart)
  registerMutatorHandlers(socket, io, gameManager);

  // Session
  socket.on('resumeSession', (data) => handleResume(io, socket, gameManager, data));

  // Disconnect
  socket.on('disconnect', () => {
    handleSpectatorDisconnect(io, socket.id, gameManager);
    handleDisconnect(io, socket, gameManager, broadcastRoomUpdate);
  });
});

// --- Periodic Cleanup --------------------------------------------------------

setInterval(() => gameManager.cleanupOldRooms(), 5 * 60 * 1000);

// Flush pending scoreboard writes on process shutdown lifecycle.
process.once('beforeExit', flushSaves);
process.once('SIGINT', flushSaves);
process.once('SIGTERM', flushSaves);

// --- Initialization ----------------------------------------------------------

// Start HTTP server
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Socket.IO path: ${SOCKET_PATH}`);
  console.log(`Base path: ${BASE_PATH}`);
});
