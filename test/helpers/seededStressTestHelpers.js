'use strict';

const DEFAULT_STRESS_SEEDS = Object.freeze([101, 202, 303]);
const DEFAULT_STRESS_STEPS = 6;
const EXTENDED_STRESS_STEPS = 12;

function normalizeSeed(seed) {
  const n = Number.parseInt(seed, 10);
  if (!Number.isFinite(n)) return 1;
  return (n >>> 0) || 1;
}

function createSeededRng(seed) {
  let state = normalizeSeed(seed);
  return function rng() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pick(rng, array) {
  if (!Array.isArray(array) || array.length === 0) {
    throw new Error('pick requires a non-empty array');
  }
  return array[Math.floor(rng() * array.length)];
}

function parseStressSeeds(envValue) {
  if (!envValue || typeof envValue !== 'string') return [...DEFAULT_STRESS_SEEDS];
  const parsed = envValue
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isFinite(n));
  return parsed.length > 0 ? parsed : [...DEFAULT_STRESS_SEEDS];
}

function resolveStressStepCount() {
  return process.env.THRESS_STRESS_EXTENDED === '1'
    ? EXTENDED_STRESS_STEPS
    : DEFAULT_STRESS_STEPS;
}

module.exports = {
  DEFAULT_STRESS_SEEDS,
  DEFAULT_STRESS_STEPS,
  EXTENDED_STRESS_STEPS,
  createSeededRng,
  pick,
  parseStressSeeds,
  resolveStressStepCount,
};
