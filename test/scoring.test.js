'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { scoreAll, combine, computeBonus, band, computeC14, echoPhrases, atsDates, computePackage } = require('../lib/scoring');
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
      headline: { level: 'none', evidence: ev() },
      same_industry: { match: true, evidence: ev({ source_ids: S1 }) },
      competitor: { match: false, evidence: ev() },
      supplier: { match: true, evidence: ev({ source_ids: S1 }) },
      top_firm: { match: false, evidence: ev() }
    },
    c2: { quadrant: 'star', evidence: ev(), buzz: { adjustment: 0, evidence: ev() } },
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
    c10: { items: [] },
    c12: { expected_years: { value: 3, from: 'jd' }, roles: [] },
    c13: { roles: [] }
  };
}

test('c1 weighted mean of six sub-scores, headline carries 0.25', () => {
  const r = scoreAll(base(), {}, WD);
  approx(r.criteria.c1.score, (70 + 0.25 * 0 + 100 + 0 + 100 + 0) / 5.25); // 51.43
  assert.equal(r.criteria.c1.sub.title, 70);
  assert.equal(r.criteria.c1.sub.headline, 0);
  assert.match(r.criteria.c1.working, /= 51\.43$/);
  const a = base(); a.c1.headline.level = 'exact';
  approx(scoreAll(a, {}, WD).criteria.c1.score, (70 + 25 + 100 + 100) / 5.25); // 57.14
  assert.equal(scoreAll(base(), {}, WD).criteria.c1.sub.top10_consulting, undefined);
});

test('c1 custom subweights', () => {
  const w = deepMerge(WD, { c1_subweights: { title: 3 } });
  approx(scoreAll(base(), {}, w).criteria.c1.score, (70 * 3 + 100 + 100) / (3 + 0.25 + 4)); // 56.55
});

test('c1 web sub-check with no source scores 0 and confidence low', () => {
  const a = base();
  a.c1.same_industry.evidence.source_ids = [];
  const r = scoreAll(a, {}, WD);
  approx(r.criteria.c1.score, (70 + 0 + 0 + 100) / 5.25);
  assert.equal(r.criteria.c1.confidence, 'low');
  assert.match(r.criteria.c1.working, /no evidence found/);
});

test('c2 strictness: gamma = 0.5 + clamp(base + buzz), adjusted = 100 * (core/100)^gamma', () => {
  const st = (q, adj) => { const a = base(); a.c2.quadrant = q; a.c2.buzz.adjustment = adj; return scoreAll(a, {}, WD).strictness; };
  let s = st('star', 0);
  assert.deepEqual([s.base, s.buzz, s.strictness, s.gamma], [0.75, 0, 0.75, 1.25]);
  s = st('cash_cow', 0.1);
  approx(s.strictness, 1.1); approx(s.gamma, 1.6);
  s = st('dog', -0.25); // 0.25 - 0.25 = 0 -> clamped up to 0.25
  assert.equal(s.strictness, 0.25); assert.equal(s.gamma, 0.75);
  s = st('cash_cow', 0.25); // 1.25 is the ceiling
  assert.equal(s.strictness, 1.25); assert.equal(s.gamma, 1.75);
  // worked example from the rubric: core 70 -> cash cow gamma 1.5 gives 58.6, dog gamma 0.75 gives 76.5
  approx(combine({ c1: 70 }, { c1: 50 }, null, null, 0, 1.5).adjusted, 58.56, 0.01);
  approx(combine({ c1: 70 }, { c1: 50 }, null, null, 0, 0.75).adjusted, 76.5, 0.05);
  assert.equal(combine({ c1: 100 }, { c1: 50 }, null, null, 0, 1.75).adjusted, 100);
});

test('c2 buzz adjustment is clamped to +/- c2_buzz_max', () => {
  const a = base(); a.c2.quadrant = 'question_mark'; a.c2.buzz.adjustment = 0.9;
  const s = scoreAll(a, {}, WD).strictness;
  assert.equal(s.buzz, 0.25); approx(s.strictness, 0.75); approx(s.gamma, 1.25);
  a.c2.buzz.adjustment = -0.9;
  assert.equal(scoreAll(a, {}, WD).strictness.buzz, -0.25);
  const w = deepMerge(WD, { c2_buzz_max: 0.1 });
  a.c2.buzz.adjustment = 0.9;
  assert.equal(scoreAll(a, {}, w).strictness.buzz, 0.1);
});

test('c2 is not weighted, and legacy risk fields are ignored', () => {
  const a = base(); a.c2.candidate_risk_aversion = 99; a.c2.candidate_evidence = ev();
  const r = scoreAll(a, { risk_aversion_override: 10 }, WD);
  assert.equal(r.criteria.c2.score, null);
  assert.equal(r.criteria.c2.weight, 0);
  assert.equal(r.strictness.gamma, 1.25);
  assert.match(r.criteria.c2.working, /gamma = 0.5 \+ 0.75 = 1.25/);
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
  approx(scoreAll(base(), {}, WD).criteria.c8.score, 62.5); // no section tag: all scored (legacy)
});

test('c8 only scores achievement and experience bullets; other is excluded', () => {
  const a = base();
  a.c8.bullets = [
    { section: 'achievement', level: 'full' }, { section: 'experience', level: 'none' },
    { section: 'other', level: 'none' }, { section: 'other', level: 'none' }];
  const r = scoreAll(a, {}, WD);
  approx(r.criteria.c8.score, 50);
  assert.match(r.criteria.c8.working, /over 2 achievement\/experience bullets/);
  assert.match(r.criteria.c8.working, /2 other bullets not scored/);
  a.c8.bullets = [{ section: 'other', level: 'full' }];
  assert.equal(scoreAll(a, {}, WD).criteria.c8.not_applicable, true);
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

test('c12 median of completed tenures excludes the current role', () => {
  const a = base();
  a.c12.roles = [
    { employer: 'Now', start: '2020-01', end: null, current: true }, // would be 36 months, excluded
    { employer: 'A', start: '2019-01', end: '2019-12' }, // 12
    { employer: 'B', start: '2017-01', end: '2018-06' }, // 18
    { employer: 'C', start: '2014-01', end: '2016-12' }]; // 36
  const r = scoreAll(a, {}, WD);
  approx(r.criteria.c12.score, 18 / 36 * 100); // median 18 months, expected 3 y = 36 months
  assert.equal(r.criteria.c12.detail.median_months, 18);
  assert.match(r.criteria.c12.working, /current role excluded/);
  a.c12.roles.splice(3, 1); // 12 and 18 -> median 15
  approx(scoreAll(a, {}, WD).criteria.c12.score, 15 / 36 * 100);
  a.c12.expected_years.value = 1; // capped at 1
  assert.equal(scoreAll(a, {}, WD).criteria.c12.score, 100);
});

test('c12 splits a combined-employer entry equally', () => {
  const a = base();
  a.c12.roles = [
    { employer: 'A', start: '2023-01', end: '2024-12' }, // 24
    { employer: 'B & C', start: '2019-01', end: '2021-12', employer_count: 2 }, // 36 -> 18, 18
    { employer: 'D', start: '2017-01', end: '2017-12' }]; // 12
  const r = scoreAll(a, {}, WD); // tenures 24, 18, 18, 12 -> median 18
  assert.equal(r.criteria.c12.detail.median_months, 18);
  approx(r.criteria.c12.score, 18 / 36 * 100);
  assert.match(r.criteria.c12.working, /36\/2 x2/);
});

test('c12 splits an "& others" entry 60/40', () => {
  const a = base();
  a.c12.roles = [
    { employer: 'A', start: '2020-01', end: '2020-12' }, // 12
    { employer: 'X, Y & others', start: '2010-01', end: '2019-12', employer_count: 2, has_others: true }]; // 120 -> 36, 36, others 48
  const r = scoreAll(a, {}, WD); // 12, 36, 36, 48 -> median 36
  assert.equal(r.criteria.c12.detail.median_months, 36);
  assert.equal(r.criteria.c12.score, 100);
  assert.match(r.criteria.c12.working, /\(others\)/);
});

test('c12 uses the current role when it is the only one; n/a with no roles', () => {
  const a = base();
  a.c12.roles = [{ employer: 'Now', start: '2022-01', end: null, current: true }]; // assessed 2022-12: 12 months
  approx(scoreAll(a, {}, WD).criteria.c12.score, 12 / 36 * 100);
  assert.equal(scoreAll(base(), {}, WD).criteria.c12.not_applicable, true);
  a.c12.not_applicable = true;
  assert.equal(scoreAll(a, {}, WD).criteria.c12.not_applicable, true);
});

test('c12 expected years falls back to the default when absent', () => {
  const a = base(); delete a.c12.expected_years;
  a.c12.roles = [{ start: '2019-01', end: '2020-12' }]; // 24 months vs default 3 y
  approx(scoreAll(a, {}, WD).criteria.c12.score, 24 / 36 * 100);
});

test('c13: +3 top_in_industry, +3 more if related, related alone earns nothing, capped at 10', () => {
  const run = (roles) => scoreAll(Object.assign(base(), { c13: { roles } }), {}, WD).bonus;
  assert.equal(run([{ top_in_industry: true, related_to_jd: false }]).c13, 3);
  assert.equal(run([{ top_in_industry: true, related_to_jd: true }]).c13, 6);
  assert.equal(run([{ top_in_industry: false, related_to_jd: true }]).c13, 0);
  const capped = run([{ top_in_industry: true, related_to_jd: true }, { top_in_industry: true, related_to_jd: true }]);
  assert.equal(capped.c13_uncapped, 12);
  assert.equal(capped.c13, 10);
  assert.equal(capped.total, 10);
  assert.ok(capped.items.every((i) => i.group === 'c13'));
  assert.equal(capped.items.reduce((s, i) => s + i.points, 0), 10);
});

test('bonus items carry group and total splits c11/c13', () => {
  const a = base(); a.c13.roles = [{ employer: 'X', top_in_industry: true, related_to_jd: false }];
  const b = computeBonus({ referrals: [{ type: 'hiring_manager_trusted_influencer' }] }, WD, a);
  assert.equal(b.c11, 10); assert.equal(b.c13, 3); assert.equal(b.total, 13);
  assert.deepEqual(b.items.map((i) => i.group), ['c11', 'c13']);
});

test('renormalisation drops n/a weights; total = adjusted + bonus', () => {
  const r = scoreAll(base(), {}, WD); // c3, c10, c12 n/a; star gamma 1.25
  const wt = 50 / 9;
  const c1 = 270 / 5.25;
  const core = (50 * c1 + wt * (55 + 65 + 85 + 100 + 62.5 + 80)) / (50 + 6 * wt);
  approx(r.core, core);
  approx(r.adjusted, 100 * Math.pow(core / 100, 1.25));
  approx(r.total, r.adjusted);
  assert.equal(r.band, band(r.total));
  assert.equal(r.criteria.c1.weight, 50);
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

test('bonus is added after the strictness adjustment', () => {
  const r = combine({ c1: 80 }, { c1: 50 }, null, null, 5, 1.5);
  approx(r.adjusted, 71.55, 0.01);
  approx(r.total, 76.55, 0.01);
  assert.equal(r.gamma, 1.5);
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
  const r = combine({ c1: 0, c4: 100, c3: null }, { c1_current_role: 50, c4_ai_experience: 50, c3_tools_years: 50 },
    { title: 100, headline: 0, same_industry: 0, competitor: 0, supplier: 0, top_firm: 0 },
    { title: 1, headline: 1, same_industry: 1, competitor: 1, supplier: 1, top_firm: 1 }, 0);
  approx(r.c1, 16.67);
  approx(r.core, (50 * 16.6667 + 50 * 100) / 100); // 58.33
  assert.equal(r.adjusted, r.core); // no gamma: unchanged
});

test('scoreAll matches combine on its own output', () => {
  const r = scoreAll(base(), { referrals: [{ type: 'hiring_manager_trusted_influencer' }] }, WD);
  const scores = {};
  Object.keys(r.criteria).forEach((k) => { scores[k] = r.criteria[k].score; });
  const c = combine(scores, WD.core, r.criteria.c1.sub, WD.c1_subweights, r.bonus.total, r.strictness.gamma);
  approx(c.total, r.total, 0.02);
  approx(c.adjusted, r.adjusted, 0.02);
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
  assert.equal(m.core.c12_tenure, 5.5555556);
  assert.equal(m._comment, WD._comment); // override _comment keys ignored
  assert.ok(W.core);
});


// ---- c14 screening signals ----
// assessed_on 2026-10-04, so the cap month is 2026-10 and the 10-year window starts 2016-10.
const q = { text: 'x' };
function a14(roles, c14) {
  const a = base();
  a.meta.assessed_on = '2026-10-04';
  a.c9.institution = 'University of Example';
  a.c12.roles = roles;
  if (c14 !== null) a.c14 = Object.assign({ jd_basis: 'unknown', contract_signals: [], conventional_certs: { applies: false }, conflict_of_interest: { present: false } }, c14 || {});
  return a;
}
const item = (r, key) => r.items.find((i) => i.key === key);
const R = (employer, start, end, extra) => Object.assign({ employer, start, end, quote: q }, end === null ? { current: true } : {}, extra || {});

test('c14 worked example: every item computed by hand', () => {
  const a = a14([
    R('Now', '2024-02', null, { at_target_seniority: true, in_jd_sector: true }), // 2024-02..2026-10 = 33 months
    R('B', '2021-01', '2023-06', { at_target_seniority: true }),                   // 30 months
    R('C', '2015-01', '2020-12')],                                                  // clipped to 2016-10..2020-12 = 51
  { jd_basis: 'permanent', contract_signals: [{ quote: q }], conventional_certs: { applies: true, expected: ['PRINCE2'], held: [] },
    conflict_of_interest: { present: true, description: 'auditor' } });
  const r = computeC14(a, null, null, WD);
  assert.equal(item(r, 'seniority').points, 5);      // 33 + 30 = 63 months >= 36
  assert.match(item(r, 'seniority').working, /63 months/);
  assert.equal(item(r, 'gaps').points, -3);          // Jul 2023 to Jan 2024 = 7 months, one gap
  assert.equal(item(r, 'short_recent').points, 0);   // 33 and 30 months
  assert.equal(item(r, 'contract').points, -3);
  assert.equal(item(r, 'echo').points, 0);           // skipped without text
  assert.ok(r.notes.some((n) => /echo skipped/.test(n)));
  assert.equal(item(r, 'sector').points, 2);
  assert.equal(item(r, 'certs').points, -2);
  assert.equal(item(r, 'conflict').points, -3);
  assert.equal(r.total, -4);                         // 5 - 3 + 0 - 3 + 0 + 2 - 2 - 3
  r.items.forEach((i) => assert.ok(i.label && i.working));
});

test('c14 seniority tiers and window clipping', () => {
  const sen = (roles) => item(computeC14(a14(roles, {}), null, null, WD), 'seniority');
  assert.equal(sen([R('A', '2010-01', '2012-12', { at_target_seniority: true })]).points, -5); // outside the window
  assert.equal(sen([R('A', '2020-01', '2020-12')]).points, -5);                                // nothing tagged
  const part = sen([R('A', '2016-01', '2017-09', { at_target_seniority: true })]);              // clipped to 2016-10..2017-09 = 12
  assert.equal(part.points, 0); assert.match(part.working, /12 months/);
  assert.equal(sen([R('A', '2020-01', '2022-12', { at_target_seniority: true })]).points, 5);   // exactly 36 months
  assert.equal(sen([R('A', '2020-01', '2022-11', { at_target_seniority: true })]).points, 0);   // 35 months
});

test('c14 employment gaps: exclusive months, merged overlaps, cap at -9', () => {
  const gaps = (roles) => item(computeC14(a14(roles, {}), null, null, WD), 'gaps').points;
  assert.equal(gaps([R('A', '2020-01', '2020-05'), R('B', '2020-12', '2021-06')]), 0);  // Jun to Nov = 6 months, not over 6
  assert.equal(gaps([R('A', '2020-01', '2020-05'), R('B', '2021-01', '2021-06')]), -3); // Jun to Dec = 7 months
  assert.equal(gaps([R('A', '2020-01', '2021-06'), R('B', '2020-06', '2020-09'), R('C', '2021-07', '2021-12')]), 0); // overlap merged
  assert.equal(gaps([R('A', '2017-01', '2017-03'), R('B', '2018-01', '2018-03'), R('C', '2019-01', '2019-03')]), -6); // two gaps of 9
  assert.equal(gaps([R('A', '2017-01', '2017-03'), R('B', '2018-01', '2018-03'), R('C', '2019-01', '2019-03'), R('D', '2020-01', '2020-03'), R('E', '2021-01', '2021-03')]), -9); // four gaps, capped
  assert.equal(gaps([R('A', '2010-01', '2010-03'), R('B', '2012-01', '2012-03')]), 0);  // gap entirely before the window
});

test('c14 short recent roles: two most recent by start, current counts to assessed_on', () => {
  const sh = (roles) => item(computeC14(a14(roles, {}), null, null, WD), 'short_recent').points;
  assert.equal(sh([R('Now', '2026-02', null), R('P', '2025-01', '2025-08'), R('Old', '2019-01', '2019-03')]), -6); // 9 and 8 months
  assert.equal(sh([R('Now', '2025-12', null), R('P', '2025-01', '2025-12'), R('Old', '2019-01', '2019-03')]), -3); // current 11 months is short, 12 months is not
  assert.equal(sh([R('Now', '2025-11', null), R('P', '2025-01', '2025-12')]), 0);
  assert.equal(sh([R('Now', '2023-01', null), R('P', '2020-01', '2020-04')]), -3);                              // current 46 months, previous 4
});

test('c14 contract history: mismatch, match, none', () => {
  const k = (basis, n) => item(computeC14(a14([], { jd_basis: basis, contract_signals: Array(n).fill({ quote: q }) }), null, null, WD), 'contract').points;
  assert.equal(k('permanent', 1), -3);
  assert.equal(k('permanent', 0), 0);
  assert.equal(k('contract', 2), 2);
  assert.equal(k('contract', 0), 0);
  assert.equal(k('unknown', 3), 0);
});

test('c14 sector recency boundaries', () => {
  const sec = (roles) => item(computeC14(a14(roles, {}), null, null, WD), 'sector').points;
  assert.equal(sec([R('Now', '2024-01', null, { in_jd_sector: true })]), 2);
  assert.equal(sec([R('Now', '2024-01', null), R('P', '2020-01', '2026-05', { in_jd_sector: true })]), 0);   // 5 months ago
  assert.equal(sec([R('P', '2020-01', '2025-11', { in_jd_sector: true })]), 0);                              // 11 months
  assert.equal(sec([R('P', '2020-01', '2025-10', { in_jd_sector: true })]), -2);                             // 12 months
  assert.equal(sec([R('P', '2020-01', '2023-10', { in_jd_sector: true })]), -2);                             // 36 months
  assert.equal(sec([R('P', '2020-01', '2023-09', { in_jd_sector: true })]), -4);                             // 37 months
  assert.equal(sec([R('P', '2020-01', '2023-09')]), -4);                                                     // never
});

test('c14 conventional certifications and conflict of interest', () => {
  const run = (c14) => computeC14(a14([], c14), null, null, WD);
  assert.equal(item(run({ conventional_certs: { applies: true, expected: ['PRINCE2'], held: ['PRINCE2'] } }), 'certs').points, 2);
  assert.equal(item(run({ conventional_certs: { applies: true, expected: ['PRINCE2'], held: [], not_equivalent: ['DSDM'] } }), 'certs').points, -2);
  assert.equal(item(run({ conventional_certs: { applies: false, held: [] } }), 'certs').points, 0);
  assert.equal(item(run({ conflict_of_interest: { present: true } }), 'conflict').points, -3);
  assert.equal(item(run({ conflict_of_interest: { present: false } }), 'conflict').points, 0);
});

test('c14 JD echo: maximal runs, each reported once, hyphenated line breaks joined', () => {
  const jd = 'We need a leader who can deliver measurable improvements in cost speed and quality across the payments division. ' +
    'You will own end to end operations for merchant onboarding settlement disputes and customer support.';
  const cv = 'Delivered measurable improvements in cost, speed and quality across the payments division. ' +
    'Own end-to-end operations for merchant onboarding, settlement, disputes and customer support daily.';
  const ph = echoPhrases(cv, jd, 6);
  assert.deepEqual(ph, [
    'own end to end operations for merchant onboarding settlement disputes and customer support', // 13 words
    'measurable improvements in cost speed and quality across the payments division']);           // 11 words
  // an 8-word run that also appears as a 6-word run elsewhere is reported once, as the longer phrase
  const e8 = 'alpha beta gamma delta epsilon zeta eta theta';
  assert.deepEqual(echoPhrases(e8, e8 + '. unrelated filler words. gamma delta epsilon zeta eta theta', 6), [e8]);
  // five matching words are below the minimum
  assert.deepEqual(echoPhrases('one two three four five', 'one two three four five', 6), []);
  // hyphenated line break: cross-\nfunctional -> crossfunctional
  assert.deepEqual(echoPhrases('led crossfunctional teams across many regions daily', 'led cross-\nfunctional teams across many regions daily', 6), ['led crossfunctional teams across many regions daily']);
  // points: first 3 free, then -1 each, capped at -5
  const mk = (n) => { const c = [], j = []; for (let i = 0; i < n; i++) { const p = ['w' + i + 'a', 'w' + i + 'b', 'w' + i + 'c', 'w' + i + 'd', 'w' + i + 'e', 'w' + i + 'f'].join(' '); c.push(p, 'cvfill' + i); j.push(p, 'jdfill' + i); } return [c.join(' '), j.join(' ')]; };
  const pts = (n) => { const [c, j] = mk(n); return item(computeC14(a14([], {}), c, j, WD), 'echo').points; };
  assert.equal(pts(3), 0);
  assert.equal(pts(4), -1);
  assert.equal(pts(7), -4);
  assert.equal(pts(9), -5);   // -6 capped at -5
  assert.equal(pts(12), -5);
  const [c, j] = mk(5);
  assert.equal(computeC14(a14([], {}), c, j, WD).echo_phrases.length, 5);
});

test('c14 ats_dates flag: positives and negatives', () => {
  const hit = (line) => atsDates(line).length === 1;
  ['Apr 2022 to Apr 2023', 'Jul 2026 to present', '1994 to 2017', 'Mar 2026 – Present', 'Jan 2010 — Dec 2012',
    'Acme | Director | September 2010 – February 2013', 'Earlier career, 1994 TO 2015'].forEach((l) => assert.ok(hit(l), l));
  ['Apr 2022 - Apr 2023', 'March 2021 - Present', '2019-2021', 'up to 2000 people', 'From 1500 to 2000 merchants', 'Open 9 to 5 daily', 'Call 0207 946 0000'].forEach((l) => assert.ok(!hit(l), l));
  const r = atsDates('Intro\nExample Ltd | Head | Apr 2022 to Apr 2023\nOther | Lead | Mar 2026 – Present');
  assert.equal(r.length, 2);
  assert.equal(r[0].line, 2);
  assert.equal(r[0].matches[0].fix, 'Apr 2022 - Apr 2023');
  assert.equal(r[1].matches[0].fix, 'Mar 2026 - Present');
  const flags = computeC14(a14([], {}), 'Head | Apr 2022 to Apr 2023', 'jd', WD).flags;
  assert.equal(flags.ats_dates.length, 1);
  assert.equal(flags.form_checklist.length, 5);
});

test('c14 education_blank flag follows c9.institution', () => {
  const a = a14([], {});
  assert.equal(computeC14(a, '', '', WD).flags.education_blank, false);
  a.c9.institution = null;
  assert.equal(computeC14(a, '', '', WD).flags.education_blank, true);
  a.c9.institution = '  ';
  assert.equal(computeC14(a, '', '', WD).flags.education_blank, true);
});

test('c14 caps: total clamped to cap_min and cap_max, uncapped sum kept', () => {
  const hi = a14([R('Now', '2023-07', null, { at_target_seniority: true, in_jd_sector: true }), R('B', '2021-01', '2023-06', { at_target_seniority: true })],
    { jd_basis: 'contract', contract_signals: [{ quote: q }], conventional_certs: { applies: true, held: ['PMP'] } });
  const rh = computeC14(hi, null, null, WD); // 5 + 0 + 0 + 2 + 0 + 2 + 2 + 0 = 11
  assert.equal(rh.raw_total, 11); assert.equal(rh.total, 10);
  const lo = a14([R('Now', '2026-05', null), R('B', '2025-01', '2025-03'), R('C', '2023-01', '2023-03'), R('D', '2021-01', '2021-03'), R('E', '2019-01', '2019-03')],
    { jd_basis: 'permanent', contract_signals: [{ quote: q }], conventional_certs: { applies: true, held: [] }, conflict_of_interest: { present: true } });
  const rl = computeC14(lo, null, null, WD); // -5 -9 -6 -3 +0 -4 -2 -3 = -32
  assert.equal(rl.raw_total, -32); assert.equal(rl.total, -15);
  const custom = JSON.parse(JSON.stringify(WD)); custom.c14.cap_min = -20; custom.c14.gap_cap = -3;
  assert.equal(computeC14(lo, null, null, custom).total, -20); // gaps now -3: -5 -3 -6 -3 +0 -4 -2 -3 = -26, clamped to -20
});

test('c14 legacy file without c14: script items computed, no AI items, total includes c14', () => {
  const a = a14([R('Now', '2026-02', null), R('P', '2025-01', '2025-08')], null);
  assert.equal(a.c14, undefined);
  const r = scoreAll(a, {}, WD, 'cv text', 'jd text');
  assert.deepEqual(r.c14.items.map((i) => i.key), ['gaps', 'short_recent', 'echo']);
  assert.equal(r.c14.total, -6);
  assert.equal(r.bonus.c14, -6);
  assert.equal(r.bonus.total, -6);
  assert.ok(r.bonus.items.some((i) => i.group === 'c14' && i.points === -6));
  approx(r.total, Math.min(100, Math.max(0, r.adjusted - 6)));
  assert.ok(r.c14.notes.some((n) => /absent/.test(n)));
  assert.equal(r.criteria.c14.points, -6);
});

test('c14 scoreAll: total = clamp(adjusted + c11 + c13 + c14, 0, 100)', () => {
  const a = a14([R('Now', '2023-07', null, { at_target_seniority: true, in_jd_sector: true }), R('B', '2021-01', '2023-06', { at_target_seniority: true })], {});
  a.c13.roles = [{ top_in_industry: true, related_to_jd: false }];
  const cand = { referrals: [{ type: 'hiring_manager_trusted_influencer' }] };
  const r = scoreAll(a, cand, WD, 'a', 'b');
  assert.equal(r.bonus.c11, 10); assert.equal(r.bonus.c13, 3);
  assert.equal(r.bonus.c14, 7); // seniority +5, sector +2, nothing else
  assert.equal(r.bonus.total, 20);
  approx(r.total, Math.min(100, r.adjusted + 20));
});

test('c14 scoreAll without texts skips echo and ats_dates with a note', () => {
  const r = scoreAll(a14([], {}), {}, WD);
  assert.deepEqual(r.c14.flags.ats_dates, []);
  assert.ok(r.c14.notes.some((n) => /echo skipped/.test(n)));
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
  a.c12.roles = [{ employer: 'X', start: '2019-01', end: '2020-12', quote: { text: 'line 2' } }];
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
  assert.equal(s.strictness.quadrant, 'star');
  assert.equal(s.strictness.gamma, 1.25);
  assert.ok(typeof s.adjusted === 'number');
  assert.ok(r.stdout.includes('adjusted') && r.stdout.includes('c11') && r.stdout.includes('c12'));
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

// ---- package and location (not scored)
const pkg = (comparables) => ({
  posted: { salary: 'not stated', benefits: [], evidence: ev() },
  estimate: { currency: 'GBP', period: 'year', low: 70000, high: 90000, basis: 'b', confidence: 'medium' },
  comparables,
  location: { office: 'London', work_pattern: 'hybrid', office_days_per_week: 4, evidence: ev() }
});
const cmp = (scope, figure, extra) => Object.assign({ source_id: 'S1', label: scope, scope, figure, period: 'year', as_of: '2026-09' }, extra);

test('package: midpoint, London premium and summary line', () => {
  const p = computePackage({ package: pkg([cmp('london', 90000), cmp('london', 100000), cmp('uk_ex_london', 80000)]) });
  assert.equal(p.midpoint, 80000);
  approx(p.london_premium_pct, 18.75);
  assert.equal(p.line, 'Package: £70,000 - £90,000 per year (mid £80,000); London premium 19%; hybrid, 4 office days');
});

test('package: premium is null when a group or the same period is missing', () => {
  assert.equal(computePackage({ package: pkg([cmp('london', 90000)]) }).london_premium_pct, null);
  assert.equal(computePackage({ package: pkg([cmp('uk_ex_london', 80000)]) }).london_premium_pct, null);
  assert.equal(computePackage({ package: pkg([cmp('london', 90000), cmp('uk_ex_london', 400, { period: 'day' })]) }).london_premium_pct, null);
});

test('package: absent for a legacy file and never changes the score', () => {
  const a = base();
  const without = scoreAll(a, {}, W, 'cv', 'jd');
  assert.equal(without.package, null);
  a.package = pkg([cmp('london', 90000), cmp('uk_ex_london', 80000)]);
  const withPkg = scoreAll(a, {}, W, 'cv', 'jd');
  assert.equal(withPkg.total, without.total);
  assert.equal(withPkg.package.midpoint, 80000);
});

test('CLI: legacy file without package is valid and scored.json has no package', () => {
  const { r, dir } = runCli(() => {});
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'scored.json'), 'utf8')).package, undefined);
  assert.ok(!r.stdout.includes('Package:'));
});

test('CLI: valid package prints one line and is written to scored.json', () => {
  const { r, dir } = runCli((a) => { a.package = pkg([cmp('london', 90000), cmp('uk_ex_london', 80000)]); });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Package: £70,000 - £90,000 per year \(mid £80,000\); London premium 13%; hybrid, 4 office days/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'scored.json'), 'utf8')).package.midpoint, 80000);
});

test('CLI: package validation rejects bad enums, unknown source and low above high', () => {
  const bad = (mutate) => runCli((a) => { a.package = pkg([cmp('london', 90000)]); mutate(a.package); }).r;
  let r = bad((p) => { p.comparables[0].scope = 'mars'; });
  assert.equal(r.status, 2); assert.match(r.stderr, /package\.comparables\[0\]\.scope must be one of/);
  r = bad((p) => { p.comparables[0].period = 'week'; });
  assert.match(r.stderr, /package\.comparables\[0\]\.period must be one of/);
  r = bad((p) => { p.comparables[0].source_id = 'S99'; });
  assert.match(r.stderr, /package\.comparables\[0\]\.source_id must reference an id in sources/);
  r = bad((p) => { p.estimate.low = 100000; });
  assert.match(r.stderr, /package\.estimate\.low must not be greater than high/);
  r = bad((p) => { p.location.work_pattern = 'sometimes'; });
  assert.match(r.stderr, /package\.location\.work_pattern must be one of/);
});

test('CLI: package quotes are verified like all others', () => {
  const { r } = runCli((a) => { a.package = pkg([]); a.package.posted.evidence = ev({ jd_quotes: [{ text: 'not in the job text' }] }); });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /UNVERIFIED package\.posted\.evidence\.jd_quotes\[0\]/);
});
