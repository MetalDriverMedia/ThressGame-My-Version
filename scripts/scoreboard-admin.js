#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const {
  exportScoreboard,
  resetScoreboard,
} = require('../utils/scoreboard');

function usage() {
  console.log('Usage: node scripts/scoreboard-admin.js <export|reset> [--out <path>] [--no-backup]');
}

const args = process.argv.slice(2);
const command = args[0];

if (!command || !['export', 'reset'].includes(command)) {
  usage();
  process.exit(1);
}

if (command === 'export') {
  const outIndex = args.indexOf('--out');
  const outPath = outIndex >= 0 && args[outIndex + 1]
    ? path.resolve(args[outIndex + 1])
    : null;

  const payload = exportScoreboard();
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`Exported scoreboard to ${outPath}`);
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }
  process.exit(0);
}

if (command === 'reset') {
  const backupFirst = !args.includes('--no-backup');
  const result = resetScoreboard({ backupFirst });
  console.log(JSON.stringify({
    ok: true,
    backupPath: result.backupPath,
    scorePath: result.scorePath,
  }, null, 2));
  process.exit(0);
}
