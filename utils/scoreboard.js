const fs = require('fs');
const path = require('path');

const SCOREBOARD_PATH = path.join(__dirname, '..', 'data', 'scoreboard.json');
const MAX_ENTRIES = 5000;
const SAVE_DEBOUNCE_MS = 500;

// In-memory scoreboard: { [playerHash]: { name, score, wins, losses, draws, lastPlayed } }
let scores = {};
let saveTimer = null;
let pendingSave = false;

function load() {
  try {
    if (fs.existsSync(SCOREBOARD_PATH)) {
      scores = JSON.parse(fs.readFileSync(SCOREBOARD_PATH, 'utf8'));
    }
  } catch (err) {
    console.warn('[scoreboard] Failed to load:', err.message);
    scores = {};
  }
}

function saveNow() {
  try {
    const dir = path.dirname(SCOREBOARD_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SCOREBOARD_PATH, JSON.stringify(scores, null, 2));
  } catch (err) {
    console.warn('[scoreboard] Failed to save:', err.message);
  } finally {
    pendingSave = false;
  }
}

function save() {
  pendingSave = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!pendingSave) return;
    saveNow();
  }, SAVE_DEBOUNCE_MS);
}

function flushSaves() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (pendingSave) saveNow();
}

function ensureEntry(hash, name) {
  if (!scores[hash]) {
    scores[hash] = { name, score: 0, wins: 0, losses: 0, draws: 0, lastPlayed: Date.now() };
  } else {
    // Update display name to the most recent one
    scores[hash].name = name;
  }
}

function recordWin(hash, name) {
  ensureEntry(hash, name);
  scores[hash].wins++;
  scores[hash].score++;
  scores[hash].lastPlayed = Date.now();
  prune();
  save();
}

function recordLoss(hash, name) {
  ensureEntry(hash, name);
  scores[hash].losses++;
  scores[hash].score = Math.max(0, scores[hash].score - 1);
  scores[hash].lastPlayed = Date.now();
  save();
}

function recordDraw(hash, name) {
  ensureEntry(hash, name);
  scores[hash].draws++;
  scores[hash].score++;
  scores[hash].lastPlayed = Date.now();
  save();
}

function getTop(n = 25) {
  return Object.entries(scores)
    .map(([hash, data]) => ({
      name: data.name,
      score: data.score,
      wins: data.wins,
      losses: data.losses,
      draws: data.draws,
    }))
    .sort((a, b) => b.score - a.score || b.wins - a.wins)
    .slice(0, n);
}

function getPlayerScore(hash) {
  return scores[hash] || null;
}

// Returns 1, 2, 3 for top 3 players, or 0 if not in top 3
function getPlayerRank(hash) {
  if (!scores[hash]) return 0;
  const sorted = Object.entries(scores)
    .sort((a, b) => b[1].score - a[1].score || b[1].wins - a[1].wins);
  for (let i = 0; i < Math.min(3, sorted.length); i++) {
    if (sorted[i][0] === hash) return i + 1;
  }
  return 0;
}

// How many points the #1 player leads #2 by (0 if fewer than 2 entries)
function getGoldLead() {
  const sorted = Object.values(scores)
    .sort((a, b) => b.score - a.score || b.wins - a.wins);
  if (sorted.length < 2) return 0;
  return Math.max(0, sorted[0].score - sorted[1].score);
}

// Prune low-score inactive entries if the store grows too large
function prune() {
  const entries = Object.entries(scores);
  if (entries.length <= MAX_ENTRIES) return;
  entries.sort((a, b) => b[1].score - a[1].score || b[1].lastPlayed - a[1].lastPlayed);
  scores = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
  save();
}

// Load on startup
load();
process.on('beforeExit', flushSaves);
process.on('SIGINT', () => {
  flushSaves();
  process.exit(0);
});
process.on('SIGTERM', () => {
  flushSaves();
  process.exit(0);
});

module.exports = { recordWin, recordLoss, recordDraw, getTop, getPlayerScore, getPlayerRank, getGoldLead, prune, flushSaves };
