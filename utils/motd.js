const fs = require('fs');
const path = require('path');

const MOTD_PATH = path.join(__dirname, '..', 'data', 'motd.txt');

function readMotd() {
  try {
    if (!fs.existsSync(MOTD_PATH)) return '';
    return fs.readFileSync(MOTD_PATH, 'utf8').trim();
  } catch (err) {
    console.warn('[motd] Failed to read:', err.message);
    return '';
  }
}

module.exports = { readMotd };
