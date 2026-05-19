const fs = require('fs');
const path = require('path');

const SCOREBOARD_PATH = process.env.SCOREBOARD_PATH
  ? path.resolve(process.env.SCOREBOARD_PATH)
  : path.join(__dirname, '..', 'data', 'scoreboard.json');
const SCOREBOARD_DIR = path.dirname(SCOREBOARD_PATH);
const BACKUP_DIR = path.join(SCOREBOARD_DIR, 'backups');
const MAX_ENTRIES = 5000;
const SAVE_DEBOUNCE_MS = 500;

// In-memory scoreboard: { [playerHash]: { name, score, wins, losses, draws, lastPlayed } }
let scores = {};
let saveTimer = null;
let pendingSave = false;

function toNonNegativeInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : null;
  if (!name) return null;
  return {
    name,
    score: toNonNegativeInt(entry.score),
    wins: toNonNegativeInt(entry.wins),
    losses: toNonNegativeInt(entry.losses),
    draws: toNonNegativeInt(entry.draws),
    lastPlayed: toNonNegativeInt(entry.lastPlayed) || Date.now(),
  };
}

function getNormalizedScoresMap() {
  const normalized = {};
  for (const [hash, entry] of Object.entries(scores)) {
    const safeEntry = normalizeEntry(entry);
    if (!safeEntry) continue;
    normalized[hash] = safeEntry;
  }
  return normalized;
}

function getScoreboardStatus() {
  let exists = false;
  let directoryWritable = false;

  try {
    exists = fs.existsSync(SCOREBOARD_PATH);
  } catch (_err) {
    exists = false;
  }

  try {
    if (!fs.existsSync(SCOREBOARD_DIR)) {
      fs.mkdirSync(SCOREBOARD_DIR, { recursive: true });
    }
    fs.accessSync(SCOREBOARD_DIR, fs.constants.W_OK);
    directoryWritable = true;
  } catch (_err) {
    directoryWritable = false;
  }

  return {
    configured: Boolean(SCOREBOARD_PATH),
    hasCustomPath: Boolean(process.env.SCOREBOARD_PATH),
    fileExists: exists,
    isDirectoryWritable: directoryWritable,
  };
}

function load() {
  try {
    if (fs.existsSync(SCOREBOARD_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(SCOREBOARD_PATH, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        scores = {};
        return;
      }
      const normalized = {};
      for (const [hash, entry] of Object.entries(parsed)) {
        const safeEntry = normalizeEntry(entry);
        if (!safeEntry) continue;
        normalized[hash] = safeEntry;
      }
      scores = normalized;
    }
  } catch (err) {
    console.warn('[scoreboard] Failed to load:', err.message);
    scores = {};
  }
}

function saveNow() {
  try {
    if (!fs.existsSync(SCOREBOARD_DIR)) fs.mkdirSync(SCOREBOARD_DIR, { recursive: true });
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
      hash,
      name: data.name,
      score: data.score,
      wins: data.wins,
      losses: data.losses,
      draws: data.draws,
    }))
    .filter((row) => typeof row.name === 'string' && row.name.length > 0)
    .sort((a, b) => b.score - a.score || b.wins - a.wins)
    .map(({ hash, ...row }) => row)
    .slice(0, n);
}

function getPlayerScore(hash) {
  return scores[hash] || null;
}

function exportScoreboard() {
  const normalizedScores = getNormalizedScoresMap();
  const players = Object.entries(normalizedScores)
    .map(([hash, data]) => ({ hash, ...data }))
    .sort((a, b) => b.score - a.score || b.wins - a.wins || b.lastPlayed - a.lastPlayed);

  return {
    exportedAt: new Date().toISOString(),
    entryCount: players.length,
    players,
  };
}

function createScoreboardBackup() {
  const payload = exportScoreboard();
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[.:]/g, '-');
  const filePath = path.join(BACKUP_DIR, `scoreboard-${timestamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return filePath;
}

function resetScoreboard({ backupFirst = true } = {}) {
  flushSaves();
  let backupPath = null;
  if (backupFirst) {
    backupPath = createScoreboardBackup();
  }
  scores = {};
  saveNow();
  return { backupPath, scorePath: SCOREBOARD_PATH };
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

module.exports = {
  recordWin,
  recordLoss,
  recordDraw,
  getTop,
  getPlayerScore,
  getPlayerRank,
  getGoldLead,
  prune,
  flushSaves,
  exportScoreboard,
  createScoreboardBackup,
  resetScoreboard,
  getScoreboardStatus,
};
