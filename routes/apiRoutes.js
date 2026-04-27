const express = require('express');
const { RULES, RULE_CATEGORIES } = require('../mutators/mutatorDefs');
const { getTop } = require('../utils/scoreboard');

const router = express.Router();

/**
 * Setup public API routes
 */
function setupApiRoutes() {
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
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

  return router;
}

module.exports = { setupApiRoutes };
