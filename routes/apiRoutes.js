const express = require('express');
const { RULES, RULE_CATEGORIES } = require('../mutators/mutatorDefs');
const { getTop, getScoreboardStatus } = require('../utils/scoreboard');
const { readMotd } = require('../utils/motd');

/**
 * Setup public API routes
 */
function setupApiRoutes(options = {}) {
  const router = express.Router();
  const startupTime = options.startupTime || Date.now();
  const version = options.version || 'unknown';
  const basePath = options.basePath || '/';
  const socketPath = options.socketPath || '/socket.io';

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version,
      uptimeSeconds: Math.floor(process.uptime()),
      startupTime: new Date(startupTime).toISOString(),
      timestamp: new Date().toISOString(),
      basePath,
      socketPath,
    });
  });

  router.get('/readiness', (_req, res) => {
    const scoreboard = getScoreboardStatus();
    const isReady = scoreboard.isDirectoryWritable;

    if (!isReady) {
      return res.status(503).json({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        checks: {
          scoreboardPersistence: scoreboard,
        },
      });
    }

    return res.json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      checks: {
        scoreboardPersistence: scoreboard,
      },
    });
  });

  router.get('/rules', (_req, res) => {
    const rules = RULES.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
    }));
    const categories = Object.values(RULE_CATEGORIES);
    res.json({ rules, categories });
  });

  router.get('/scoreboard', (_req, res) => {
    res.json({ players: getTop(25) });
  });

  router.get('/motd', (_req, res) => {
    res.json({ text: readMotd() });
  });

  return router;
}

module.exports = { setupApiRoutes };
