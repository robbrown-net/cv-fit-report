'use strict';
// Deterministic scoring engine. Pure functions, no fs. Implements docs/rubric.md exactly.
// Works in Node (module.exports) and inlined in a browser (window.CVFit).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CVFit = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  // Weighted core criteria. c2 is a strictness modifier and c11/c13 are bonuses, so none of them are here.
  var CRITERIA = ['c1', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c12'];
  var C1_SUBS = ['title', 'headline', 'same_industry', 'competitor', 'supplier', 'top_firm'];
  var C1_WEB = ['same_industry', 'competitor', 'supplier', 'top_firm'];
  var CONF_RANK = { low: 0, medium: 1, high: 2 };

  function r2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  function fmt(x) { return String(r2(x)); }
  function num(v, path) {
    if (typeof v !== 'number' || !isFinite(v)) throw new Error(path + ' must be a number');
    return v;
  }
  function lookup(table, key, path) {
    if (!table || !Object.prototype.hasOwnProperty.call(table, key)) {
      throw new Error(path + ' has unknown value "' + key + '" (expected one of: ' + Object.keys(table || {}).join(', ') + ')');
    }
    return table[key];
  }
  function band(total) {
    if (total >= 75) return 'Strong';
    if (total >= 60) return 'Competitive';
    if (total >= 45) return 'Stretch';
    return 'Long shot';
  }
  // 'c3' or 'c3_tools_years' -> 'c3'
  function critId(key) { var m = /^(c\d+)(?:_|$)/.exec(key); return m ? m[1] : key; }
  function weightKeyFor(id, coreWeights) {
    var keys = Object.keys(coreWeights);
    for (var i = 0; i < keys.length; i++) if (critId(keys[i]) === id) return keys[i];
    return null;
  }
  function weightFor(id, coreWeights) {
    var k = weightKeyFor(id, coreWeights);
    return k === null ? 0 : coreWeights[k];
  }
  function weightedMean(pairs) { // [[score, weight]]
    var sw = 0, s = 0;
    pairs.forEach(function (p) { s += p[0] * p[1]; sw += p[1]; });
    return sw > 0 ? s / sw : 0;
  }
  function minConfidence(node) {
    var min = null;
    (function walk(n) {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (typeof n.confidence === 'string' && n.confidence in CONF_RANK) {
        if (min === null || CONF_RANK[n.confidence] < CONF_RANK[min]) min = n.confidence;
      }
      Object.keys(n).forEach(function (k) { walk(n[k]); });
    })(node);
    return min || 'medium';
  }
  function na(working, conf) { return { score: null, not_applicable: true, confidence: conf || 'high', working: working }; }

  // ---- c1 ----
  function scoreC1(a, w) {
    var c1 = a.c1 || {};
    var levels = w.c1_title_levels, sw = w.c1_subweights;
    var sub = {}, notes = [], lowConf = false;
    var t = c1.title || {};
    sub.title = lookup(levels, t.level, 'c1.title.level');
    notes.push('title ' + sub.title + ' (' + t.level + ')');
    var hd = c1.headline || {};
    sub.headline = lookup(levels, hd.level, 'c1.headline.level');
    notes.push('headline ' + sub.headline + ' (' + hd.level + ')');
    C1_WEB.forEach(function (k) {
      var s = c1[k] || {};
      var ids = (s.evidence && s.evidence.source_ids) || [];
      if (s.match === true && ids.length === 0) {
        sub[k] = 0; lowConf = true;
        notes.push(k + ' 0 (no evidence found)');
      } else {
        sub[k] = s.match === true ? 100 : 0;
        notes.push(k + ' ' + sub[k]);
      }
    });
    var pairs = C1_SUBS.map(function (k) { return [sub[k], sw[k] === undefined ? 1 : sw[k]]; });
    var score = weightedMean(pairs);
    var allEq = pairs.every(function (p) { return p[1] === pairs[0][1]; });
    return {
      score: score, sub: sub, not_applicable: false,
      confidence: lowConf ? 'low' : minConfidence(c1),
      working: (allEq ? 'mean(' : 'weighted mean(') + notes.join(', ') + ') = ' + fmt(score)
    };
  }

  // ---- c2: strictness modifier (not weighted) ----
  function computeStrictness(a, w) {
    var c2 = a.c2 || {};
    var base = lookup(w.c2_strictness, c2.quadrant, 'c2.quadrant');
    var max = w.c2_buzz_max === undefined ? 0.25 : w.c2_buzz_max;
    var rawBuzz = (c2.buzz && typeof c2.buzz.adjustment === 'number' && isFinite(c2.buzz.adjustment)) ? c2.buzz.adjustment : 0;
    var buzz = clamp(rawBuzz, -max, max);
    var strictness = clamp(base + buzz, 0.25, 1.25);
    var gb = w.c2_gamma_base === undefined ? 0.5 : w.c2_gamma_base;
    return { quadrant: c2.quadrant, base: base, buzz: buzz, strictness: strictness, gamma: gb + strictness, gamma_base: gb, buzz_raw: rawBuzz };
  }
  function strictnessWorking(st, core, adjusted) {
    return 'base ' + st.base + ' (' + st.quadrant + ') + buzz ' + fmt(st.buzz) + (st.buzz !== st.buzz_raw ? ' (clamped from ' + fmt(st.buzz_raw) + ')' : '') +
      ' -> strictness clamp(' + fmt(st.base + st.buzz) + ', 0.25, 1.25) = ' + fmt(st.strictness) +
      '; gamma = ' + st.gamma_base + ' + ' + fmt(st.strictness) + ' = ' + fmt(st.gamma) +
      '; adjusted = 100 * (' + fmt(core) + '/100)^' + fmt(st.gamma) + ' = ' + fmt(adjusted);
  }

  // ---- c3 ----
  function monthIndex(s, path) {
    var m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(s));
    if (!m) throw new Error(path + ' must be YYYY-MM');
    return parseInt(m[1], 10) * 12 + parseInt(m[2], 10) - 1;
  }
  // Inclusive month ranges merged so overlaps count once. Returns total months.
  function unionMonths(roles, assessedOn, path) {
    var cap = monthIndex(String(assessedOn).slice(0, 7), 'meta.assessed_on');
    var iv = (roles || []).map(function (r, i) {
      var s = monthIndex(r.start, path + '[' + i + '].start');
      var e = (r.end === null || r.end === undefined) ? cap : monthIndex(r.end, path + '[' + i + '].end');
      if (e < s) throw new Error(path + '[' + i + '].end is before start');
      return [s, e];
    }).sort(function (x, y) { return x[0] - y[0]; });
    var total = 0, cs = null, ce = null;
    iv.forEach(function (p) {
      if (cs === null) { cs = p[0]; ce = p[1]; }
      else if (p[0] <= ce) { if (p[1] > ce) ce = p[1]; }
      else { total += ce - cs + 1; cs = p[0]; ce = p[1]; }
    });
    if (cs !== null) total += ce - cs + 1;
    return total;
  }
  function scoreC3(a, w) {
    var c3 = a.c3 || {};
    var items = c3.items || [];
    if (c3.not_applicable === true || items.length === 0) return na('not applicable: the JD names no tools, services or suppliers');
    var assessedOn = a.meta && a.meta.assessed_on;
    var scores = [], notes = [];
    items.forEach(function (it, i) {
      var req = (it.required_years === null || it.required_years === undefined) ? w.c3_default_required_years : num(it.required_years, 'c3.items[' + i + '].required_years');
      var months = unionMonths(it.cv_roles, assessedOn, 'c3.items[' + i + '].cv_roles');
      var years = months / 12;
      var s = req > 0 ? Math.min(years / req, 1) * 100 : 100;
      scores.push(s);
      notes.push(it.name + ': ' + months + ' months = ' + fmt(years) + ' y / ' + req + ' y required = ' + fmt(s));
    });
    var score = scores.reduce(function (x, y) { return x + y; }, 0) / scores.length;
    return { score: score, not_applicable: false, confidence: minConfidence(c3), item_scores: scores,
      working: 'mean(' + notes.join('; ') + ') = ' + fmt(score) };
  }

  // ---- c4 ----
  function scoreC4(a) {
    var c4 = a.c4 || {};
    var uses = c4.uses || [];
    var cats = {};
    uses.forEach(function (u) { if (u.category) cats[u.category] = true; });
    var nCats = Object.keys(cats).length;
    var nQ = uses.filter(function (u) { return u.quantified === true; }).length;
    var yrs = (c4.years_using_ai === null || c4.years_using_ai === undefined) ? 0 : num(c4.years_using_ai, 'c4.years_using_ai');
    var breadth = Math.min(nCats / 4, 1) * 50;
    var depth = Math.min(nQ / 3, 1) * 30;
    var tenure = Math.min(yrs / 3, 1) * 20;
    var score = breadth + depth + tenure;
    return { score: score, not_applicable: false, confidence: minConfidence(c4),
      working: 'breadth min(' + nCats + '/4,1)*50 = ' + fmt(breadth) + ' + depth min(' + nQ + '/3,1)*30 = ' + fmt(depth) +
        ' + tenure min(' + yrs + '/3,1)*20 = ' + fmt(tenure) + ' = ' + fmt(score) };
  }

  // ---- c5 ----
  function scoreC5(a, w) {
    var c5 = a.c5 || {};
    var L = clamp(num(c5.likelihood, 'c5.likelihood'), 0, 100);
    var dir = w.c5_ai_generated_direction || 'negative';
    var score, working;
    if (dir === 'positive') { score = L; working = 'direction positive: likelihood ' + L + ' = ' + fmt(score); }
    else { score = 100 - L; working = 'direction negative: 100 - likelihood ' + L + ' = ' + fmt(score); }
    return { score: score, not_applicable: false, confidence: minConfidence(c5),
      working: working + ' (an indication, not proof)' };
  }

  // ---- c6 / c7 ----
  function scoreErrors(block, perError, label) {
    var n = ((block || {}).errors || []).length;
    var score = Math.max(0, 100 - perError * n);
    return { score: score, not_applicable: false, confidence: minConfidence(block || {}),
      working: 'max(0, 100 - ' + perError + ' * ' + n + ' ' + label + ' errors) = ' + fmt(score) };
  }

  // ---- c8 ----
  // Only achievement and experience bullets are scored. A missing section counts as scored (legacy files).
  function scoreC8(a, w) {
    var all = (a.c8 || {}).bullets || [];
    var bullets = all.filter(function (b) { return b.section !== 'other'; });
    var excluded = all.length - bullets.length;
    if (bullets.length === 0) return na('not applicable: no achievement or experience bullets classified' + (excluded ? ' (' + excluded + ' other bullets listed but not scored)' : ''), 'low');
    var counts = { full: 0, partial: 0, none: 0 }, sum = 0;
    bullets.forEach(function (b) {
      var i = all.indexOf(b);
      sum += lookup(w.c8_levels, b.level, 'c8.bullets[' + i + '].level');
      counts[b.level] = (counts[b.level] || 0) + 1;
    });
    var score = sum / bullets.length * 100;
    return { score: score, not_applicable: false, confidence: minConfidence(a.c8),
      working: 'mean(' + counts.full + ' full x ' + w.c8_levels.full + ', ' + counts.partial + ' partial x ' + w.c8_levels.partial +
        ', ' + counts.none + ' none x ' + w.c8_levels.none + ') over ' + bullets.length + ' achievement/experience bullets * 100 = ' + fmt(score) +
        (excluded ? ' (' + excluded + ' other bullets not scored)' : '') };
  }

  // ---- c9 ----
  function scoreC9(a, w) {
    var c9 = a.c9 || {};
    var tv = lookup(w.c9_tiers, c9.tier, 'c9.tier');
    var score = c9.graduated === true ? tv : 0;
    return { score: score, not_applicable: false, confidence: minConfidence(c9),
      working: c9.graduated === true ? 'tier ' + c9.tier + ' = ' + fmt(score) : 'graduation not evidenced in the CV = 0 (tier ' + c9.tier + ' would be ' + tv + ')' };
  }

  // ---- c10 ----
  function scoreC10(a, w) {
    var c10 = a.c10 || {};
    var items = c10.items || [];
    if (c10.not_applicable === true || items.length === 0) return na('not applicable: the JD asks for no qualifications or certifications');
    var num_ = 0, den = 0, notes = [];
    items.forEach(function (it, i) {
      var lv = lookup(w.c10_levels, it.status, 'c10.items[' + i + '].status');
      var wt = it.required === true ? 2 : 1;
      num_ += lv * wt; den += wt;
      notes.push(it.requirement + ' ' + it.status + ' x' + wt);
    });
    var score = num_ / den * 100;
    return { score: score, not_applicable: false, confidence: minConfidence(c10),
      working: 'weighted mean(' + notes.join(', ') + ') = ' + num_ + '/' + den + ' * 100 = ' + fmt(score) };
  }

  // ---- c12 tenure ----
  function median(xs) {
    var v = xs.slice().sort(function (x, y) { return x - y; });
    var n = v.length, m = Math.floor(n / 2);
    return n % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
  function roleMonths(r, cap, path) {
    var s = monthIndex(r.start, path + '.start');
    var e = (r.end === null || r.end === undefined) ? cap : monthIndex(r.end, path + '.end');
    if (e < s) throw new Error(path + '.end is before start');
    return e - s + 1;
  }
  function scoreC12(a, w) {
    var c12 = a.c12 || {};
    var roles = c12.roles || [];
    if (c12.not_applicable === true || roles.length === 0) return na('not applicable: no dated roles on the CV', 'low');
    var cap = monthIndex(String((a.meta && a.meta.assessed_on) || '').slice(0, 7), 'meta.assessed_on');
    var isCur = function (r) { return r.current === true || r.end === null || r.end === undefined; };
    var done = roles.map(function (r, i) { return { r: r, i: i }; }).filter(function (x) { return !isCur(x.r); });
    var used = done.length ? done : roles.map(function (r, i) { return { r: r, i: i }; });
    // An entry naming n employers under one date range counts as n roles of months / n each.
    var months = [], parts = [];
    used.forEach(function (x) {
      var m = roleMonths(x.r, cap, 'c12.roles[' + x.i + ']');
      var n = (typeof x.r.employer_count === 'number' && x.r.employer_count >= 1) ? Math.floor(x.r.employer_count) : 1;
      if (x.r.has_others === true) {
        // "A, B & others": the named employers share (1 - others_share) equally; "others" counts as one role of others_share.
        var os = (typeof w.c12_others_share === 'number') ? w.c12_others_share : 0.4;
        for (var k2 = 0; k2 < n; k2++) months.push(m * (1 - os) / n);
        months.push(m * os);
        parts.push(fmt(m) + '*' + fmt(1 - os) + '/' + n + ' x' + n + ' + ' + fmt(m) + '*' + fmt(os) + ' (others)');
        return;
      }
      for (var k = 0; k < n; k++) months.push(m / n);
      parts.push(n > 1 ? fmt(m) + '/' + n + ' x' + n : fmt(m));
    });
    var med = median(months);
    var ev = c12.expected_years || {};
    var yrs = (typeof ev.value === 'number' && isFinite(ev.value)) ? ev.value : w.c12_default_expected_years;
    var exp = yrs * 12;
    var score = exp > 0 ? Math.min(med / exp, 1) * 100 : 100;
    return { score: score, not_applicable: false, confidence: minConfidence(c12),
      detail: { months: months, role_indexes: used.map(function (x) { return x.i; }), median_months: med, expected_years: yrs, expected_months: exp, current_excluded: done.length > 0 && done.length < roles.length },
      working: 'median of ' + months.length + ' ' + (done.length ? 'completed' : 'current (only role)') + ' tenure' + (months.length === 1 ? '' : 's') + ' (' + parts.join(', ') + ' months) = ' + fmt(med) +
        ' months / (' + yrs + ' y * 12 = ' + exp + ') capped at 1 * 100 = ' + fmt(score) +
        (done.length > 0 && done.length < roles.length ? '; current role excluded' : '') };
  }

  // ---- c11 bonus ----
  function computeBonus(candidate, w, assessment) {
    var b = w.bonus || {};
    var items = [];
    candidate = candidate || {};
    var pw = candidate.previously_worked_here;
    if (pw && pw.value === true) {
      var cfg = b.c11_previously_worked_here || { points: 5, direction: 'positive' };
      var dir = pw.direction || cfg.direction || 'positive';
      var pts = (dir === 'negative' ? -1 : 1) * Math.abs(cfg.points);
      items.push({ label: 'Previously worked for the hiring organisation' + (dir === 'negative' ? ' (negative)' : ''), points: pts, group: 'c11' });
    }
    (candidate.referrals || []).forEach(function (r, i) {
      var p = 'candidate.referrals[' + i + ']';
      if (r.type === 'hiring_manager_trusted_influencer') {
        items.push({ label: 'Referral to the hiring manager by a trusted influencer', points: b.c11_referral_hiring_manager_trusted_influencer, group: 'c11' });
      } else if (r.type === 'same_division_colleague') {
        items.push({ label: 'Referral by a same-division colleague (' + r.seniority + ')',
          points: lookup(b.c11_referral_same_division_colleague, r.seniority, p + '.seniority'), group: 'c11' });
      } else if (r.type === 'colleague') {
        var t = b.c11_referral_colleague || {};
        var base = lookup(t, r.seniority, p + '.seniority');
        var vis = r.visibility || 'medium';
        var mult = lookup(t.visibility_multiplier, vis, p + '.visibility');
        items.push({ label: 'Referral by a colleague (' + r.seniority + ', ' + vis + ' visibility, ' + base + ' x ' + mult + ')', points: r2(base * mult), group: 'c11' });
      } else {
        throw new Error(p + '.type must be hiring_manager_trusted_influencer, same_division_colleague or colleague');
      }
    });
    var c11 = r2(items.reduce(function (s, it) { return s + it.points; }, 0));
    var c13 = 0;
    var roles = ((assessment || {}).c13 || {}).roles || [];
    var topPts = b.c13_consulting_top_in_industry === undefined ? 3 : b.c13_consulting_top_in_industry;
    var relPts = b.c13_consulting_related_to_jd === undefined ? 3 : b.c13_consulting_related_to_jd;
    var cap = b.c13_cap === undefined ? 10 : b.c13_cap;
    var c13items = [];
    roles.forEach(function (r) {
      var who = (r.employer || 'consulting firm') + (r.title ? ', ' + r.title : '');
      if (r.top_in_industry === true) {
        c13items.push({ label: 'Consulting at a top-10 firm for the industry: ' + who, points: topPts, group: 'c13' });
        if (r.related_to_jd === true) c13items.push({ label: 'Consulting work related to the JD: ' + who, points: relPts, group: 'c13' });
      }
    });
    var c13raw = r2(c13items.reduce(function (s, it) { return s + it.points; }, 0));
    c13 = Math.min(c13raw, cap);
    items = items.concat(c13items);
    if (c13raw > cap) items.push({ label: 'c13 capped at +' + cap, points: r2(cap - c13raw), group: 'c13' });
    return { items: items, c11: c11, c13: r2(c13), c13_uncapped: c13raw, total: r2(c11 + c13) };
  }

  // ---- combine (also used by the in-browser sliders) ----
  // criteriaScores: {c1: 61.7, c3: null (n/a), ...}. coreWeights keyed 'c1' or 'c1_current_role'.
  // c1Sub: {title: 70,...} + c1Subweights: when given, c1 is recomputed from them.
  // gamma: exponent from the c2 strictness step (omitted = 1, no adjustment).
  function combine(criteriaScores, coreWeights, c1Sub, c1Subweights, bonusTotal, gamma) {
    var scores = {};
    Object.keys(criteriaScores || {}).forEach(function (k) { scores[critId(k)] = criteriaScores[k]; });
    if (c1Sub && c1Subweights) {
      var pairs = C1_SUBS.filter(function (k) { return typeof c1Sub[k] === 'number'; })
        .map(function (k) { return [c1Sub[k], c1Subweights[k] === undefined ? 1 : c1Subweights[k]]; });
      if (pairs.length) scores.c1 = weightedMean(pairs);
    }
    var num_ = 0, den = 0;
    CRITERIA.forEach(function (id) {
      var s = scores[id];
      if (s === null || s === undefined || typeof s !== 'number') return;
      var wt = weightFor(id, coreWeights);
      num_ += wt * s; den += wt;
    });
    var core = den > 0 ? r2(num_ / den) : 0;
    var g = (typeof gamma === 'number' && isFinite(gamma)) ? gamma : 1;
    var adjusted = r2(100 * Math.pow(clamp(core, 0, 100) / 100, g));
    var bonus = bonusTotal || 0;
    var total = r2(clamp(adjusted + bonus, 0, 100));
    return { c1: scores.c1 === undefined ? null : r2(scores.c1), core: core, gamma: g, adjusted: adjusted, bonus: bonus, total: total, band: band(total) };
  }

  function scoreAll(assessment, candidate, weights) {
    var a = assessment || {}, w = weights;
    var raw = {
      c1: scoreC1(a, w), c3: scoreC3(a, w), c4: scoreC4(a),
      c5: scoreC5(a, w),
      c6: scoreErrors(a.c6, w.c6_points_per_spelling_error, 'spelling'),
      c7: scoreErrors(a.c7, w.c7_points_per_grammar_error, 'grammar'),
      c8: scoreC8(a, w), c9: scoreC9(a, w), c10: scoreC10(a, w), c12: scoreC12(a, w)
    };
    var criteria = {}, forCombine = {};
    CRITERIA.forEach(function (id) {
      var c = raw[id];
      var out = {
        score: c.score === null ? null : r2(c.score),
        weight: weightFor(id, w.core),
        not_applicable: c.not_applicable,
        confidence: c.confidence,
        working: c.working
      };
      if (c.sub) out.sub = c.sub;
      if (c.item_scores) out.item_scores = c.item_scores.map(r2);
      if (c.detail) out.detail = c.detail;
      criteria[id] = out;
      forCombine[id] = c.score;
    });
    var st = computeStrictness(a, w);
    var bonus = computeBonus(candidate, w, a);
    var comb = combine(forCombine, w.core, null, null, bonus.total, st.gamma);
    var strictness = { quadrant: st.quadrant, base: st.base, buzz: st.buzz, strictness: r2(st.strictness), gamma: r2(st.gamma) };
    // c2 is a modifier and c13 a bonus: they appear in criteria for their working string and confidence, with no score or weight.
    var c2conf = minConfidence(a.c2 || {});
    criteria.c2 = { score: null, weight: 0, modifier: true, not_applicable: false, confidence: c2conf, working: strictnessWorking(st, comb.core, comb.adjusted) };
    criteria.c13 = { score: null, weight: 0, bonus: true, points: bonus.c13, not_applicable: false, confidence: minConfidence(a.c13 || {}),
      working: c13Working(a, bonus, w) };
    return { criteria: criteria, core: comb.core, strictness: strictness, adjusted: comb.adjusted, bonus: bonus, total: comb.total, band: comb.band };
  }

  function c13Working(a, bonus, w) {
    var roles = ((a.c13 || {}).roles || []);
    if (!roles.length) return 'no consulting roles: +0';
    var parts = roles.map(function (r) {
      var pts = r.top_in_industry === true ? (w.bonus.c13_consulting_top_in_industry + (r.related_to_jd === true ? w.bonus.c13_consulting_related_to_jd : 0)) : 0;
      return (r.employer || 'role') + ' (top_in_industry ' + (r.top_in_industry === true) + ', related_to_jd ' + (r.related_to_jd === true) + (r.related_to_jd === true && r.top_in_industry !== true ? ', ignored: not a top firm' : '') + ') +' + pts;
    });
    return parts.join('; ') + ' = ' + fmt(bonus.c13_uncapped) + ', capped at ' + w.bonus.c13_cap + ' = +' + fmt(bonus.c13);
  }

  return {
    scoreAll: scoreAll, combine: combine, computeBonus: computeBonus, computeStrictness: computeStrictness, band: band,
    unionMonths: unionMonths, monthIndex: monthIndex, CRITERIA: CRITERIA, C1_SUBS: C1_SUBS
  };
});
