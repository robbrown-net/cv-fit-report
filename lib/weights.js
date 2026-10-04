'use strict';
// Load config/weights.json deep-merged with config/weights.local.json (if present) or a --weights file.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const k of Object.keys(over || {})) {
    if (k.startsWith('_')) continue; // _comment keys
    out[k] = isObj(over[k]) && isObj(base && base[k]) ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error('cannot read weights file ' + file + ': ' + e.message); }
}

// Returns { weights, file, override } where override is the merged-in file path or null.
function loadWeights(weightsPath) {
  const defFile = path.join(ROOT, 'config', 'weights.json');
  let weights = readJson(defFile);
  delete weights._comment;
  let override = null;
  if (weightsPath) {
    override = path.resolve(weightsPath);
    if (!fs.existsSync(override)) throw new Error('weights file not found: ' + weightsPath);
  } else {
    const local = path.join(ROOT, 'config', 'weights.local.json');
    if (fs.existsSync(local)) override = local;
  }
  if (override) weights = deepMerge(weights, readJson(override));
  return { weights, file: 'config/weights.json', override: override ? path.relative(ROOT, override) || override : null };
}

module.exports = { loadWeights, deepMerge };
