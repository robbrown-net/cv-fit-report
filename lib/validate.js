'use strict';
// Structural validation of assessment.json and candidate.json with path-based messages.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CONF = ['high', 'medium', 'low'];

function validateAssessment(a, weights) {
  const errs = [];
  const err = (p, m) => errs.push(p + ' ' + m);
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const str = (v, p) => { if (typeof v !== 'string' || !v.trim()) err(p, 'must be a non-empty string'); };
  const oneOf = (v, list, p) => { if (!list.includes(v)) err(p, 'must be one of: ' + list.join(', ')); };
  const bool = (v, p) => { if (typeof v !== 'boolean') err(p, 'must be true or false'); };
  const numRange = (v, lo, hi, p) => { if (typeof v !== 'number' || !isFinite(v) || v < lo || v > hi) err(p, 'must be a number from ' + lo + ' to ' + hi); };
  const month = (v, p) => { if (typeof v !== 'string' || !MONTH.test(v)) err(p, 'must be YYYY-MM'); };
  const arr = (v, p) => { if (!Array.isArray(v)) { err(p, 'must be an array'); return false; } return true; };
  const quote = (q, p) => {
    if (typeof q === 'string') return;
    if (!isObj(q) || typeof q.text !== 'string') err(p, 'must be { "text": "..." }');
  };
  const evidence = (e, p) => {
    if (!isObj(e)) { err(p, 'must be an object (Evidence)'); return; }
    ['cv_quotes', 'jd_quotes', 'source_ids'].forEach((k) => {
      if (e[k] !== undefined && arr(e[k], p + '.' + k) && k !== 'source_ids') e[k].forEach((q, i) => quote(q, p + '.' + k + '[' + i + ']'));
    });
    if (e.reasoning !== undefined && typeof e.reasoning !== 'string') err(p + '.reasoning', 'must be a string');
    if (e.confidence !== undefined) oneOf(e.confidence, CONF, p + '.confidence');
  };

  if (!isObj(a)) return ['assessment must be a JSON object'];
  if (!isObj(a.meta)) err('meta', 'must be an object');
  else {
    ['candidate', 'hiring_company', 'role_title'].forEach((k) => str(a.meta[k], 'meta.' + k));
    if (typeof a.meta.assessed_on !== 'string' || !DAY.test(a.meta.assessed_on)) err('meta.assessed_on', 'must be YYYY-MM-DD');
  }
  arr(a.sources, 'sources');

  if (!isObj(a.current_role)) err('current_role', 'must be an object');
  else {
    month(a.current_role.start, 'current_role.start');
    if (a.current_role.end !== null && a.current_role.end !== undefined) month(a.current_role.end, 'current_role.end');
    evidence(a.current_role.evidence, 'current_role.evidence');
  }

  // c1
  const lv = Object.keys((weights && weights.c1_title_levels) || { exact: 1, close: 1, adjacent: 1, none: 1 });
  if (!isObj(a.c1)) err('c1', 'must be an object');
  else {
    if (!isObj(a.c1.title)) err('c1.title', 'must be an object');
    else { oneOf(a.c1.title.level, lv, 'c1.title.level'); evidence(a.c1.title.evidence, 'c1.title.evidence'); }
    if (!isObj(a.c1.headline)) err('c1.headline', 'must be an object');
    else { oneOf(a.c1.headline.level, lv, 'c1.headline.level'); evidence(a.c1.headline.evidence, 'c1.headline.evidence'); }
    ['same_industry', 'competitor', 'supplier', 'top_firm'].forEach((k) => {
      const s = a.c1[k];
      if (!isObj(s)) { err('c1.' + k, 'must be an object'); return; }
      bool(s.match, 'c1.' + k + '.match');
      evidence(s.evidence, 'c1.' + k + '.evidence');
    });
  }
  // c2 (strictness modifier; legacy candidate_risk_aversion / candidate_evidence are ignored)
  if (!isObj(a.c2)) err('c2', 'must be an object');
  else {
    oneOf(a.c2.quadrant, Object.keys((weights && weights.c2_strictness) || {}), 'c2.quadrant');
    evidence(a.c2.evidence, 'c2.evidence');
    if (a.c2.buzz !== undefined && a.c2.buzz !== null) {
      if (!isObj(a.c2.buzz)) err('c2.buzz', 'must be an object');
      else {
        if (a.c2.buzz.adjustment !== undefined) numRange(a.c2.buzz.adjustment, -1, 1, 'c2.buzz.adjustment');
        if (a.c2.buzz.evidence !== undefined) evidence(a.c2.buzz.evidence, 'c2.buzz.evidence');
      }
    }
  }
  // c3
  if (!isObj(a.c3)) err('c3', 'must be an object');
  else if (a.c3.not_applicable !== true) {
    if (arr(a.c3.items, 'c3.items')) a.c3.items.forEach((it, i) => {
      const p = 'c3.items[' + i + ']';
      if (!isObj(it)) { err(p, 'must be an object'); return; }
      str(it.name, p + '.name');
      if (it.required_years !== null && it.required_years !== undefined) numRange(it.required_years, 0, 100, p + '.required_years');
      if (it.jd_quote !== undefined) quote(it.jd_quote, p + '.jd_quote');
      if (!arr(it.cv_roles, p + '.cv_roles')) return;
      it.cv_roles.forEach((r, j) => {
        const rp = p + '.cv_roles[' + j + ']';
        if (!isObj(r)) { err(rp, 'must be an object'); return; }
        month(r.start, rp + '.start');
        if (r.end !== null && r.end !== undefined) month(r.end, rp + '.end');
        if (typeof r.start === 'string' && typeof r.end === 'string' && MONTH.test(r.start) && MONTH.test(r.end) && r.end < r.start) err(rp + '.end', 'is before start');
        if (r.quote !== undefined) quote(r.quote, rp + '.quote');
      });
    });
  }
  // c4
  if (!isObj(a.c4)) err('c4', 'must be an object');
  else {
    if (a.c4.years_using_ai !== null && a.c4.years_using_ai !== undefined) numRange(a.c4.years_using_ai, 0, 100, 'c4.years_using_ai');
    if (arr(a.c4.uses, 'c4.uses')) a.c4.uses.forEach((u, i) => {
      const p = 'c4.uses[' + i + ']';
      if (!isObj(u)) { err(p, 'must be an object'); return; }
      oneOf(u.category, ['innovation', 'cost_saving', 'time_to_market', 'revenue_growth', 'risk_reduction', 'customer_satisfaction', 'colleague_engagement', 'communication', 'other'], p + '.category');
      bool(u.quantified, p + '.quantified');
      quote(u.quote, p + '.quote');
    });
    if (a.c4.evidence !== undefined) evidence(a.c4.evidence, 'c4.evidence');
  }
  // c5
  if (!isObj(a.c5)) err('c5', 'must be an object');
  else {
    numRange(a.c5.likelihood, 0, 100, 'c5.likelihood');
    if (arr(a.c5.signals, 'c5.signals')) a.c5.signals.forEach((s, i) => {
      if (!isObj(s)) { err('c5.signals[' + i + ']', 'must be an object'); return; }
      quote(s.quote, 'c5.signals[' + i + '].quote');
      if (s.weight !== undefined) oneOf(s.weight, ['weak', 'moderate', 'strong'], 'c5.signals[' + i + '].weight');
    });
    if (a.c5.evidence !== undefined) evidence(a.c5.evidence, 'c5.evidence');
  }
  // c6 / c7
  ['c6', 'c7'].forEach((c) => {
    if (!isObj(a[c])) { err(c, 'must be an object'); return; }
    if (arr(a[c].errors, c + '.errors')) a[c].errors.forEach((e, i) => {
      if (!isObj(e)) { err(c + '.errors[' + i + ']', 'must be an object'); return; }
      quote(e.quote, c + '.errors[' + i + '].quote');
    });
  });
  // c8
  if (!isObj(a.c8)) err('c8', 'must be an object');
  else if (arr(a.c8.bullets, 'c8.bullets')) a.c8.bullets.forEach((b, i) => {
    const p = 'c8.bullets[' + i + ']';
    if (!isObj(b)) { err(p, 'must be an object'); return; }
    quote(b.quote, p + '.quote');
    oneOf(b.level, Object.keys((weights && weights.c8_levels) || { full: 1, partial: 1, none: 1 }), p + '.level');
    if (b.section !== undefined) oneOf(b.section, ['achievement', 'experience', 'other'], p + '.section');
  });
  // c9
  if (!isObj(a.c9)) err('c9', 'must be an object');
  else {
    oneOf(a.c9.tier, Object.keys((weights && weights.c9_tiers) || {}), 'c9.tier');
    bool(a.c9.graduated, 'c9.graduated');
    evidence(a.c9.evidence, 'c9.evidence');
  }
  // c10
  if (!isObj(a.c10)) err('c10', 'must be an object');
  else if (a.c10.not_applicable !== true && arr(a.c10.items, 'c10.items')) a.c10.items.forEach((it, i) => {
    const p = 'c10.items[' + i + ']';
    if (!isObj(it)) { err(p, 'must be an object'); return; }
    str(it.requirement, p + '.requirement');
    bool(it.required, p + '.required');
    oneOf(it.status, Object.keys((weights && weights.c10_levels) || { met: 1, partial: 1, not_met: 1 }), p + '.status');
    if (it.jd_quote !== undefined) quote(it.jd_quote, p + '.jd_quote');
    if (it.evidence !== undefined) evidence(it.evidence, p + '.evidence');
  });
  // c12
  if (!isObj(a.c12)) err('c12', 'must be an object');
  else if (a.c12.not_applicable !== true) {
    if (isObj(a.c12.expected_years)) {
      numRange(a.c12.expected_years.value, 0, 100, 'c12.expected_years.value');
      if (a.c12.expected_years.from !== undefined) oneOf(a.c12.expected_years.from, ['jd', 'research', 'default'], 'c12.expected_years.from');
      if (a.c12.expected_years.evidence !== undefined) evidence(a.c12.expected_years.evidence, 'c12.expected_years.evidence');
    } else if (a.c12.expected_years !== undefined) err('c12.expected_years', 'must be an object');
    if (arr(a.c12.roles, 'c12.roles')) a.c12.roles.forEach((r, i) => {
      const p = 'c12.roles[' + i + ']';
      if (!isObj(r)) { err(p, 'must be an object'); return; }
      month(r.start, p + '.start');
      if (r.end !== null && r.end !== undefined) month(r.end, p + '.end');
      if (typeof r.start === 'string' && typeof r.end === 'string' && MONTH.test(r.start) && MONTH.test(r.end) && r.end < r.start) err(p + '.end', 'is before start');
      if (r.current !== undefined) bool(r.current, p + '.current');
      if (r.employer_count !== undefined && !(Number.isInteger(r.employer_count) && r.employer_count >= 1)) err(p + '.employer_count', 'must be an integer of 1 or more');
      if (r.quote !== undefined) quote(r.quote, p + '.quote');
    });
    if (a.c12.evidence !== undefined) evidence(a.c12.evidence, 'c12.evidence');
  }
  // c13
  if (!isObj(a.c13)) err('c13', 'must be an object');
  else if (arr(a.c13.roles, 'c13.roles')) a.c13.roles.forEach((r, i) => {
    const p = 'c13.roles[' + i + ']';
    if (!isObj(r)) { err(p, 'must be an object'); return; }
    bool(r.top_in_industry, p + '.top_in_industry');
    bool(r.related_to_jd, p + '.related_to_jd');
    if (r.quote !== undefined) quote(r.quote, p + '.quote');
    if (r.evidence !== undefined) evidence(r.evidence, p + '.evidence');
  });
  if (!isObj(a.summary)) err('summary', 'must be an object');
  return errs;
}

function validateCandidate(c) {
  const errs = [];
  if (c === null || c === undefined) return errs;
  if (typeof c !== 'object' || Array.isArray(c)) return ['candidate must be a JSON object'];
  // legacy risk_aversion_override is tolerated and ignored
  const pw = c.previously_worked_here;
  if (pw !== undefined && pw !== null) {
    if (typeof pw.value !== 'boolean') errs.push('candidate.previously_worked_here.value must be true or false');
    if (pw.direction !== undefined && !['positive', 'negative'].includes(pw.direction)) errs.push('candidate.previously_worked_here.direction must be positive or negative');
  }
  if (c.referrals !== undefined && !Array.isArray(c.referrals)) errs.push('candidate.referrals must be an array');
  else (c.referrals || []).forEach((r, i) => {
    const p = 'candidate.referrals[' + i + ']';
    if (!['hiring_manager_trusted_influencer', 'same_division_colleague', 'colleague'].includes(r && r.type)) errs.push(p + '.type must be hiring_manager_trusted_influencer, same_division_colleague or colleague');
    else if (r.type !== 'hiring_manager_trusted_influencer' && !['junior', 'mid', 'senior', 'executive'].includes(r.seniority)) errs.push(p + '.seniority must be junior, mid, senior or executive');
    if (r && r.type === 'colleague' && r.visibility !== undefined && !['low', 'medium', 'high'].includes(r.visibility)) errs.push(p + '.visibility must be low, medium or high');
  });
  return errs;
}

module.exports = { validateAssessment, validateCandidate };
