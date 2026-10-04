'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { scoreAll, combine, computeBonus, band } = require('../lib/scoring');
const { verify, normalise } = require('../lib/verify');
const { loadWeights, deepMerge } = require('../lib/weights');

const W = loadWeights().weights;
const WD = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'weights.json'), 'utf8'));
const approx = (a, b, eps = 0.005) => assert.ok(Math.abs(a - b) <= eps, a + ' != ' + b);
const ev = (extra) => Object.assign({ cv_quotes: [], jd_quotes: [], source_ids: [], reasoning: 'r', confidence: 'high' }, extra);
const S1 = ['S1'];

function base() {
  return {
    meta: { candidate: 'A', hiring_company: 'Acme', role_title: 'Head', assessed_on: '2022-12-15' },
    sources: [{ id: 'S1', url: 'https://example.com/x', title: 'T', accessed: '2026-10-04', quote: 'q' }],
    c1: {
      title: { level: 'close', evidence: ev() },
      same_industry: { match: true, evidence: ev({ source_ids: S1 }) },
      competitor: { match: false, evidence: ev() },
      supplier: { match: true, evidence: ev({ source_ids: S1 }) },
      top_firm: { match: false, evidence: ev() },
      top10_consulting: { match: false, evidence: ev() }
    },
    c2: { quadrant: 'star', candidate_risk_aversion: 60, evidence: ev() },
    c3: { items: [] },
    c4: { years_using_ai: 1.5, uses: [
      { category: 'cost_saving', quantified: true, quote: { text: 'a' } },
      { category: 'innovation', quantified: true, quote: { text: 'b' } },
      { category: 'cost_saving', quantified: false, quote: { text: 'c' } }], evidence: ev() },
    c5: { likelihood: 35, signals: [], evidence: ev() },
    c6: { errors: [{}, {}, {}] },
    c7: { errors: [] },
    c8: { bullets: [{ level: 'full' }, { level: 'full' }, { level: 'partial' }, { level: 'none' }] },
    c9: { tier: 'russell_group', graduated: true, evidence: ev() },
    c10: { items: [] }
  };
}

test('c1 weighted mean of six sub-scores', () => {
  const r = scoreAll(base(), {}, WD);
  approx(r.criteria.c1.score, (70 + 100 + 0 + 100 + 0 + 0) / 6); // 45
  assert.equal(r.criteria.c1.sub.title, 70);
  assert.match(r.criteria.c1.working, /= 45$/);
});

test('c1 custom subweights', () => {
  const w = deepMerge(WD, { c1_subweights: { title: 3 } });
  approx(scoreAll(base(), {}, w).criteria.c1.score, (70 * 3 + 100 + 100) / 8); // 51.25 -> 51.25
});

test('c1 web sub-check with no source scores 0 and confidence low', () => {
  const a = base();
  a.c1.same_industry.evidence.source_ids = [];
  const r = scoreAll(a, {}, WD);
  approx(r.criteria.c1.score, (70 + 0 + 0 + 100) / 6);
  assert.equal(r.criteria.c1.confidence, 'low');
  assert.match(r.criteria.c1.working, /no evidence found/);
});

test('c2 quadrant fit and candidate override', () => {
  approx(scoreAll(base(), {}, WD).criteria.c2.score, 85);
  approx(scoreAll(base(), { risk_aversion_override: 100 }, WD).criteria.c2.score, 75);
  const a = base(); a.c2.quadrant = 'dog'; a.c2.candidate_risk_aversion = 100;
  approx(scoreAll(a, {}, WD).criteria.c2.score, 25);
});

test('c3 overlapping roles counted once, open end uses assessed_on month, default 3 years', () => {
  const a = base();
  a.c3.items = [
    { name: 'Salesforce', required_years: null, cv_roles: [
      { start: '2019-01', end: '2020-12' }, { start: '2020-07', end: '2021-06' }] }, // union 2019-01..2021-06 = 30 months
    { name: 'AWS', required_years: 1, cv_roles: [{ start: '2022-01', end: null }] } // 2022-01..2022-12 = 12 months
  ];
  const r = scoreAll(a, {}, WD);
  approx(r.criteria.c3.item_scores[0], 30 / 12 / 3 * 100); // 83.33
  approx(r.criteria.c3.item_scores[1], 100);
  approx(r.criteria.c3.score, (83.3333333 + 100) / 2);
  assert.match(r.criteria.c3.working, /Salesforce: 30 months/);
});

test('c3 not applicable when no items or flagged', () => {
  const r = scoreAll(base(), {}, WD);
  assert.equal(r.criteria.c3.not_applicable, true);
  assert.equal(r.criteria.c3.score, null);
  const a = base(); a.c3 = { not_applicable: true, items: [] };
  assert.equal(scoreAll(a, {}, WD).criteria.c3.not_applicable, true);
});

test('c4 breadth, depth, tenure', () => {
  const r = scoreAll(base(), {}, WD);
  approx(r.criteria.c4.score, 2 / 4 * 50 + 2 / 3 * 30 + 1.5 / 3 * 20); // 25+20+10 = 55
});

test('c5 direction negative and positive', () => {
  approx(scoreAll(base(), {}, WD).criteria.c5.score, 65);
  const w = deepMerge(WD, { c5_ai_generated_direction: 'positive' });
  approx(scoreAll(base(), {}, w).criteria.c5.score, 35);
});

test('c6 and c7 error points, floored at 0', () => {
  const r = scoreAll(base(), {}, WD);
  approx(r.criteria.c6.score, 85);
  approx(r.criteria.c7.score, 100);
  const a = base(); a.c7.errors = new Array(25).fill({});
  approx(scoreAll(a, {}, WD).criteria.c7.score, 0);
});

test('c8 STAR levels', () => {
  approx(scoreAll(base(), {}, WD).criteria.c8.score, 62.5);
});

test('c9 tier and graduation', () => {
  approx(scoreAll(base(), {}, WD).criteria.c9.score, 80);
  const a = base(); a.c9.graduated = false;
  approx(scoreAll(a, {}, WD).criteria.c9.score, 0);
});

test('c10 required counts double; n/a when none', () => {
  const a = base();
  a.c10.items = [
    { requirement: 'A', required: true, status: 'met' },
    { requirement: 'B', required: false, status: 'not_met' },
    { requirement: 'C', required: true, status: 'partial' }];
  approx(scoreAll(a, {}, WD).criteria.c10.score, (2 * 1 + 0 + 2 * 0.5) / 5 * 100); // 60
  assert.equal(scoreAll(base(), {}, WD).criteria.c10.not_applicable, true);
});

test('renormalisation drops n/a weights; total = core + bonus', () => {
  const r = scoreAll(base(), {}, WD); // c3 and c10 n/a
  const s = { c1: 45, c2: 85, c4: 55, c5: 65, c6: 85, c7: 100, c8: 62.5, c9: 80 };
  const wt = 50 / 9;
  const core = (50 * 45 + wt * (85 + 55 + 65 + 85 + 100 + 62.5 + 80)) / (50 + 7 * wt);
  approx(r.core, core);
  approx(r.total, core);
  assert.equal(r.band, band(r.total));
  assert.equal(r.criteria.c1.weight, 50);
  void s;
});

test('c11 bonus table and visibility multiplier', () => {
  const b = computeBonus({
    previously_worked_here: { value: true, direction: 'positive' },
    referrals: [
      { type: 'hiring_manager_trusted_influencer' },
      { type: 'same_division_colleague', seniority: 'senior' },
      { type: 'colleague', seniority: 'senior', visibility: 'high' },
      { type: 'colleague', seniority: 'junior', visibility: 'low' }] }, WD);
  approx(b.total, 5 + 10 + 7 + 5 * 1.25 + 2 * 0.75); // 29.75
  assert.equal(b.items.length, 5);
  assert.equal(computeBonus({ previously_worked_here: { value: true, direction: 'negative' } }, WD).total, -5);
  assert.equal(computeBonus(null, WD).total, 0);
});

test('bonus clamps total to 0-100', () => {
  const crit = { c1: 95 };
  assert.equal(combine(crit, { c1: 50 }, null, null, 20).total, 100);
  assert.equal(combine({ c1: 5 }, { c1: 50 }, null, null, -20).total, 0);
  assert.equal(combine(crit, { c1_current_role: 50 }, null, null, 3).total, 98);
});

test('bands', () => {
  assert.deepEqual([75, 74.99, 60, 59.9, 45, 44.9].map(band), ['Strong', 'Competitive', 'Competitive', 'Stretch', 'Stretch', 'Long shot']);
});

test('combine recomputes c1 from sliders and renormalises n/a', () => {
  const r = combine({ c1: 0, c2: 100, c3: null }, { c1_current_role: 50, c2_market_position: 50, c3_tools_years: 50 },
    { title: 100, same_industry: 0, competitor: 0, supplier: 0, top_firm: 0, top10_consulting: 0 },
    { title: 1, same_industry: 1, competitor: 1, supplier: 1, top_firm: 1, top10_consulting: 1 }, 0);
  approx(r.c1, 16.67);
  approx(r.core, (50 * 16.6667 + 50 * 100) / 100); // 58.33
});

test('scoreAll matches combine on its own output', () => {
  const r = scoreAll(base(), { referrals: [{ type: 'hiring_manager_trusted_influencer' }] }, WD);
  const scores = {};
  Object.keys(r.criteria).forEach((k) => { scores[k] = r.criteria[k].score; });
  const c = combine(scores, WD.core, r.criteria.c1.sub, WD.c1_subweights, r.bonus.total);
  approx(c.total, r.total, 0.02);
});

// ---- verify ----
test('normalise handles curly quotes, dashes, bullets, whitespace, case', () => {
  assert.equal(normalise('•  Led  the   team’s “turnaround” – 2019'), 'led the team\'s "turnaround" - 2019');
  assert.equal(normalise('- First\n- Second'), 'first second');
});

test('verify: curly quotes and whitespace match; unverified flagged by context', () => {
  const cv = '• Cut costs by 20%\n  across the team’s   budget – saved £1m';
  const jd = 'You will use  Salesforce daily.';
  const a = base();
  a.c4.uses = [
    { quote: { text: "cut costs by 20% across the team's budget - saved £1m" } },
    { quote: { text: 'Invented sentence' } }];
  a.c3.items = [{ name: 'SF', jd_quote: { text: 'use salesforce DAILY' }, cv_roles: [{ start: '2020-01', end: null, quote: { text: 'Salesforce daily' } }] }];
  a.c1.title.evidence.cv_quotes = [{ text: 'cut costs' }];
  a.c1.title.evidence.jd_quotes = [{ text: 'cut costs' }]; // wrong context: jd lacks it
  const v = verify(a, cv, jd);
  const paths = v.unverified.map((u) => u.path).sort();
  assert.deepEqual(paths, ['c1.title.evidence.jd_quotes[0]', 'c3.items[0].cv_roles[0].quote', 'c4.uses[1].quote']);
  assert.equal(v.quotes_total, 6);
  assert.equal(v.quotes_unverified, 3);
});

test('verify: source validation', () => {
  const a = base();
  a.sources = [
    { id: 'S1', url: 'https://a.com', title: 'T', accessed: '2026-10-04', quote: 'q' },
    { id: 'S2', url: '', title: 'T', accessed: '2026-10-04', quote: 'q' },
    { id: 'S3', url: 'https://a.com', title: 'T', accessed: '04/10/2026', quote: 'q' }];
  a.c1.competitor.evidence.source_ids = ['S1', 'S9'];
  const v = verify(a, '', '');
  assert.deepEqual(v.sources_rejected.map((s) => s.id), ['S2', 'S3']);
  assert.deepEqual(v.source_refs_missing.map((s) => s.id), ['S9']);
});

// ---- weights ----
test('weights deep merge', () => {
  const m = deepMerge(WD, { core: { c1_current_role: 40 }, _comment: 'x' });
  assert.equal(m.core.c1_current_role, 40);
  assert.equal(m.core.c2_market_position, 5.5555556);
  assert.equal(m._comment, WD._comment); // override _comment keys ignored
  assert.ok(W.core);
});

// ---- CLI ----
function runCli(mutate, cvText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cvfit-'));
  const a = base();
  a.meta.assessed_on = '2026-10-04';
  a.current_role = { start: '2021-03', end: null, evidence: ev() };
  a.summary = { strengths: [], risks: [], actions: [] };
  a.c4.uses.forEach((u, i) => { u.quote = { text: 'line ' + i }; });
  a.c8.bullets.forEach((b) => { b.quote = { text: 'line 0' }; });
  a.c6.errors = a.c6.errors.map(() => ({ quote: { text: 'line 1' } }));
  mutate(a);
  fs.writeFileSync(path.join(dir, 'cv.txt'), cvText || 'line 0\nline 1\nline 2\n');
  fs.writeFileSync(path.join(dir, 'jd.txt'), 'job text');
  fs.writeFileSync(path.join(dir, 'assessment.json'), JSON.stringify(a));
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'score.js'), dir], { encoding: 'utf8' });
  return { r, dir };
}

test('CLI: ok run exits 0 and writes scored.json', () => {
  const { r, dir } = runCli(() => {});
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const s = JSON.parse(fs.readFileSync(path.join(dir, 'scored.json'), 'utf8'));
  assert.equal(s.verification.quotes_unverified, 0);
  assert.ok(typeof s.total === 'number' && s.band);
});

test('CLI: unverified quote exits 1 and forces confidence low', () => {
  const { r, dir } = runCli(() => {}, 'nothing matches here');
  assert.equal(r.status, 1);
  const s = JSON.parse(fs.readFileSync(path.join(dir, 'scored.json'), 'utf8'));
  assert.equal(s.criteria.c4.confidence, 'low');
  assert.equal(s.verification.quotes_unverified, s.verification.quotes_total);
});

test('CLI: invalid input exits 2 with path-based message', () => {
  const { r } = runCli((a) => {
    a.c3 = { items: [{ name: 'X', cv_roles: [{ start: '2020', end: null }] }] };
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /c3\.items\[0\]\.cv_roles\[0\]\.start must be YYYY-MM/);
});
