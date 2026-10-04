#!/usr/bin/env node
const f1 = (n) => (Math.round((n + Number.EPSILON) * 10) / 10).toFixed(1);
'use strict';
// Usage: node bin/score.js <report-dir> [--weights file]
// Exit: 0 ok, 1 unverified quotes present, 2 invalid input.
const fs = require('fs');
const path = require('path');
const { scoreAll } = require('../lib/scoring');
const { verify } = require('../lib/verify');
const { loadWeights } = require('../lib/weights');
const { validateAssessment, validateCandidate } = require('../lib/validate');

function fail(msgs) {
  console.error('Invalid input:');
  msgs.forEach((m) => console.error('  - ' + m));
  process.exit(2);
}
function readJson(file, optional) {
  if (!fs.existsSync(file)) { if (optional) return null; fail(['missing file: ' + file]); }
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { fail([path.basename(file) + ' is not valid JSON: ' + e.message]); }
}
function readText(file) {
  if (!fs.existsSync(file)) fail(['missing file: ' + file]);
  return fs.readFileSync(file, 'utf8');
}

function main() {
  const args = process.argv.slice(2);
  let dir = null, wfile = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--weights') wfile = args[++i];
    else if (!dir) dir = args[i];
  }
  if (!dir || (args.includes('--weights') && !wfile)) { console.error('usage: node bin/score.js <report-dir> [--weights file]'); process.exit(2); }
  dir = path.resolve(dir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail(['not a directory: ' + dir]);

  let loaded;
  try { loaded = loadWeights(wfile); } catch (e) { fail([e.message]); }
  const weights = loaded.weights;

  const cv = readText(path.join(dir, 'cv.txt'));
  const jd = readText(path.join(dir, 'jd.txt'));
  const candidate = readJson(path.join(dir, 'candidate.json'), true);
  const assessment = readJson(path.join(dir, 'assessment.json'));

  const errs = validateAssessment(assessment, weights).concat(validateCandidate(candidate));
  if (errs.length) fail(errs);

  const ver = verify(assessment, cv, jd);
  if (ver.source_refs_missing.length) {
    fail(ver.source_refs_missing.map((r) => r.path + ' references unknown source id "' + r.id + '"'));
  }

  // Rejected sources do not count as evidence: strip their ids before scoring.
  const rej = new Set(ver.rejected_source_ids);
  const scoredInput = JSON.parse(JSON.stringify(assessment), function (k, v) {
    return k === 'source_ids' && Array.isArray(v) ? v.filter((id) => !rej.has(id)) : v;
  });

  let result;
  try { result = scoreAll(scoredInput, candidate || {}, weights); } catch (e) { fail([e.message]); }

  // Unverified quotes force the owning criterion's confidence to low.
  const forced = {};
  ver.unverified.forEach((u) => {
    const m = /^(c\d+)/.exec(u.path);
    const id = m ? m[1] : (u.path.startsWith('current_role') ? 'c1' : null);
    if (id && result.criteria[id]) {
      result.criteria[id].confidence = 'low';
      forced[id] = (forced[id] || 0) + 1;
    }
  });
  Object.keys(forced).forEach((id) => { result.criteria[id].unverified_quotes = forced[id]; });

  const verOut = { quotes_total: ver.quotes_total, quotes_unverified: ver.quotes_unverified, unverified: ver.unverified, sources_rejected: ver.sources_rejected };

  const scored = {
    meta: assessment.meta,
    weights_used: weights,
    weights_file: loaded.file,
    weights_override_file: loaded.override,
    verification: verOut,
    criteria: result.criteria,
    core: result.core,
    strictness: result.strictness,
    adjusted: result.adjusted,
    bonus: result.bonus,
    total: result.total,
    band: result.band
  };
  fs.writeFileSync(path.join(dir, 'scored.json'), JSON.stringify(scored, null, 2) + '\n');

  // summary
  const names = { c1: 'Current role', c3: 'Tools/years', c4: 'AI experience', c5: 'AI-generated', c6: 'Spelling', c7: 'Grammar', c8: 'STAR/PAR bullets', c9: 'University', c10: 'Qualifications', c12: 'Tenure' };
  console.log('\n' + assessment.meta.candidate + ' -> ' + assessment.meta.role_title + ', ' + assessment.meta.hiring_company);
  console.log('ID   Criterion          Score  Weight  Conf    ');
  Object.keys(names).forEach((id) => {
    const c = result.criteria[id];
    console.log(id.padEnd(4) + ' ' + names[id].padEnd(18) + ' ' + (c.not_applicable ? 'n/a' : f1(c.score)).padStart(5) + '  ' + String(Math.round(c.weight * 100) / 100).padStart(6) + '  ' + c.confidence + (c.unverified_quotes ? ' (' + c.unverified_quotes + ' unverified)' : ''));
  });
  const sgn = (n) => (n >= 0 ? '+' : '') + n;
  const st = result.strictness;
  console.log('c2   Strictness: Core ' + f1(result.core) + ' -> adjusted ' + f1(result.adjusted) + ' (' + st.quadrant + ', gamma ' + st.gamma + ')');
  console.log('Bonus ' + sgn(result.bonus.total) + ' (c11 ' + sgn(result.bonus.c11) + ', c13 ' + sgn(result.bonus.c13) + ')  Total ' + f1(result.total) + '  Band: ' + result.band);
  console.log('Quotes: ' + ver.quotes_total + ' checked, ' + ver.quotes_unverified + ' unverified; sources rejected: ' + ver.sources_rejected.length);
  ver.unverified.forEach((u) => console.log('  UNVERIFIED ' + u.path + ' (' + u.context + '): ' + JSON.stringify(u.text)));
  ver.sources_rejected.forEach((s) => console.log('  REJECTED SOURCE ' + (s.id || s.path) + ': ' + s.reason));
  console.log('Wrote ' + path.join(dir, 'scored.json'));
  process.exit(ver.quotes_unverified > 0 ? 1 : 0);
}

main();
