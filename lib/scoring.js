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

  // ---- c14 screening signals ----
  var FORM_CHECKLIST = [
    'Salary expectation: state a figure inside the advertised band',
    'Notice period: state it exactly as your contract says',
    'Right to work: answer the question for the country of the role',
    'Current job title: enter the title on your CV, not an informal one',
    'Yes or no experience questions: answer from the JD requirements, since the CV cannot'
  ];
  var MON = '(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s+)?(?:19|20)\\d{2}';
  var ATS_RE = new RegExp('\\b(' + MON + ')(\\s+to\\s+|\\s*[\\u2013\\u2014]\\s*)(' + MON + '|present|current|now|ongoing)\\b', 'ig');

  function atsDates(cvText) {
    var out = [];
    String(cvText || '').split(/\r?\n/).forEach(function (line, i) {
      var matches = [], m;
      ATS_RE.lastIndex = 0;
      while ((m = ATS_RE.exec(line)) !== null) {
        matches.push({ found: m[0], fix: m[1] + ' - ' + m[3] });
        if (m[0].length === 0) ATS_RE.lastIndex++;
      }
      if (matches.length) out.push({ line: i + 1, text: line.trim(), matches: matches });
    });
    return out;
  }

  function normWords(s) {
    return String(s || '').toLowerCase()
      .replace(/(\w)-[ \t]*\r?\n[ \t]*(\w)/g, '$1$2')
      .replace(/['‘’‛]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim().split(' ').filter(Boolean);
  }
  // Maximal runs of at least minLen words that appear in both texts. Each phrase is reported once,
  // and a phrase that sits inside a longer reported phrase is dropped.
  function echoPhrases(cvText, jdText, minLen) {
    var A = normWords(cvText), B = normWords(jdText), n = A.length, m = B.length;
    var seen = {}, list = [];
    var prev = new Array(m + 1).fill(0), cur;
    var rows = [];
    for (var i = 1; i <= n; i++) {
      cur = new Array(m + 1).fill(0);
      for (var j = 1; j <= m; j++) if (A[i - 1] === B[j - 1]) cur[j] = prev[j - 1] + 1;
      rows.push(cur); prev = cur;
    }
    // rows[i-1][j] is the common suffix length ending at A[i-1], B[j-1]. A run is maximal when it cannot extend right.
    for (var a = 1; a <= n; a++) for (var b = 1; b <= m; b++) {
      var L = rows[a - 1][b];
      if (L < minLen) continue;
      var extends_ = a < n && b < m && rows[a][b + 1] === L + 1;
      if (extends_) continue;
      var ph = A.slice(a - L, a).join(' ');
      if (!seen[ph]) { seen[ph] = true; list.push(ph); }
    }
    return list.filter(function (p) {
      return !list.some(function (q) { return q !== p && q.length > p.length && (' ' + q + ' ').indexOf(' ' + p + ' ') >= 0; });
    }).sort(function (x, y) { return y.split(' ').length - x.split(' ').length || (x < y ? -1 : 1); });
  }

  function ymLabel(idx) { var y = Math.floor(idx / 12), mo = idx % 12 + 1; return y + '-' + (mo < 10 ? '0' : '') + mo; }
  function sgn(n) { return (n > 0 ? '+' : '') + fmt(n); }

  function computeC14(assessment, cvText, jdText, weights) {
    var a = assessment || {}, w = weights || {}, k = w.c14 || {};
    var d = function (key, def) { return typeof k[key] === 'number' ? k[key] : def; };
    var c14 = a.c14, hasAi = !!(c14 && typeof c14 === 'object');
    c14 = c14 || {};
    var cap = monthIndex(String((a.meta && a.meta.assessed_on) || '').slice(0, 7), 'meta.assessed_on');
    var lookback = d('lookback_years', 10);
    var winStart = cap - lookback * 12;
    var roles = ((a.c12 || {}).roles || []).map(function (r, i) {
      var cur = r.current === true || r.end === null || r.end === undefined;
      var s = monthIndex(r.start, 'c12.roles[' + i + '].start');
      var e = cur ? cap : monthIndex(r.end, 'c12.roles[' + i + '].end');
      return { i: i, r: r, s: s, e: e, cur: cur };
    });
    var items = [], notes = [];
    var qpath = function (x) { return 'c12.roles[' + x.i + '].quote'; };
    var who = function (x) { return (x.r.employer || 'role') + ' ' + ymLabel(x.s) + ' to ' + (x.cur ? 'present' : ymLabel(x.e)); };

    if (hasAi) {
      // target seniority
      var tagged = roles.filter(function (x) { return x.r.at_target_seniority === true; });
      var months = 0, parts = [];
      tagged.forEach(function (x) {
        var s = Math.max(x.s, winStart), e = Math.min(x.e, cap);
        var m = e >= s ? e - s + 1 : 0;
        months += m; parts.push(who(x) + ' ' + m + ' months');
      });
      var fullM = d('seniority_full_years', 3) * 12, pts, desc;
      if (months >= fullM) { pts = d('seniority_full_points', 5); desc = 'at least ' + d('seniority_full_years', 3) + ' years'; }
      else if (months > 0) { pts = 0; desc = 'under ' + d('seniority_full_years', 3) + ' years'; }
      else { pts = d('seniority_none_points', -5); desc = 'none'; }
      items.push({ key: 'seniority', label: 'Time at the target seniority', points: pts,
        working: (tagged.length ? parts.join(' + ') + ' = ' : 'no role tagged at target seniority within the last ' + lookback + ' years = ') + months + ' months (' + desc + ', threshold ' + fullM + ') = ' + sgn(pts),
        evidence_paths: tagged.map(qpath) });
    }

    // gaps
    var dated = roles.slice().sort(function (x, y) { return x.s - y.s || x.e - y.e; });
    var merged = [];
    dated.forEach(function (x) {
      var last = merged[merged.length - 1];
      if (last && x.s <= last.e + 0) { if (x.e > last.e) last.e = x.e; last.idx.push(x.i); }
      else merged.push({ s: x.s, e: x.e, idx: [x.i] });
    });
    var gaps = [];
    for (var g = 1; g < merged.length; g++) {
      var gs = Math.max(merged[g - 1].e + 1, winStart), ge = merged[g].s - 1;
      var gm = ge - gs + 1;
      if (gm > d('gap_months', 6)) gaps.push({ from: ymLabel(gs), to: ymLabel(ge), months: gm, idx: merged[g - 1].idx.slice(-1).concat(merged[g].idx.slice(0, 1)) });
    }
    var gp = Math.max(d('gap_cap', -9), d('gap_points', -3) * gaps.length);
    items.push({ key: 'gaps', label: 'Employment gaps', points: gp,
      working: gaps.length ? gaps.map(function (x) { return x.from + ' to ' + x.to + ' = ' + x.months + ' months'; }).join('; ') + '; ' + gaps.length + ' gap(s) over ' + d('gap_months', 6) + ' months x ' + d('gap_points', -3) + ' = ' + sgn(gp) + (gp !== d('gap_points', -3) * gaps.length ? ' (capped at ' + d('gap_cap', -9) + ')' : '')
        : 'no gap over ' + d('gap_months', 6) + ' months between dated roles in the last ' + lookback + ' years = 0',
      evidence_paths: [].concat.apply([], gaps.map(function (x) { return x.idx.map(function (i) { return 'c12.roles[' + i + '].quote'; }); })) });

    // short recent roles
    var recent = roles.slice().sort(function (x, y) { return y.s - x.s || y.e - x.e; }).slice(0, 2);
    var shortN = 0, sp = [];
    recent.forEach(function (x) {
      var m = x.e - x.s + 1, isShort = m < d('short_role_months', 12);
      if (isShort) shortN++;
      sp.push(who(x) + ' ' + m + ' months' + (isShort ? ' (short)' : ''));
    });
    var shp = shortN * d('short_role_points', -3);
    items.push({ key: 'short_recent', label: 'Short recent roles', points: shp,
      working: recent.length ? 'two most recent roles: ' + sp.join('; ') + '; ' + shortN + ' under ' + d('short_role_months', 12) + ' months x ' + d('short_role_points', -3) + ' = ' + sgn(shp) : 'no dated roles = 0',
      evidence_paths: recent.map(qpath) });

    if (hasAi) {
      // contract history
      var basis = c14.jd_basis || 'unknown', sigs = c14.contract_signals || [], cp = 0, cw;
      if (basis === 'permanent' && sigs.length) { cp = d('contract_mismatch_points', -3); cw = 'JD is permanent and the CV shows ' + sigs.length + ' contract signal(s) = ' + sgn(cp); }
      else if (basis === 'contract' && sigs.length) { cp = d('contract_match_points', 2); cw = 'JD is a contract role and the CV shows ' + sigs.length + ' contract signal(s) = ' + sgn(cp); }
      else cw = 'JD basis ' + basis + ', ' + sigs.length + ' contract signal(s): no effect = 0';
      items.push({ key: 'contract', label: 'Contract history', points: cp, working: cw,
        evidence_paths: ['c14.jd_basis_evidence'].concat(sigs.map(function (s, i) { return 'c14.contract_signals[' + i + '].quote'; })) });
    }

    // JD echo
    if (typeof cvText === 'string' && typeof jdText === 'string') {
      var ph = echoPhrases(cvText, jdText, d('echo_words', 6));
      var free = d('echo_free', 3), ep = Math.max(d('echo_cap', -5), d('echo_points', -1) * Math.max(0, ph.length - free));
      items.push({ key: 'echo', label: 'Phrases copied from the JD', points: ep,
        working: ph.length + ' distinct run(s) of ' + d('echo_words', 6) + ' or more words shared with the JD; first ' + free + ' free; max(' + d('echo_cap', -5) + ', ' + d('echo_points', -1) + ' x max(0, ' + ph.length + ' - ' + free + ')) = ' + sgn(ep),
        evidence_paths: [] });
      var echo = ph;
    } else {
      notes.push('JD echo skipped: CV and JD text were not supplied');
      items.push({ key: 'echo', label: 'Phrases copied from the JD', points: 0, working: 'skipped: CV and JD text were not supplied = 0', evidence_paths: [] });
      echo = [];
    }

    if (hasAi) {
      // sector recency
      var inSec = roles.filter(function (x) { return x.r.in_jd_sector === true; });
      var sp2, sw2, sev;
      var curSec = inSec.filter(function (x) { return x.cur; })[0];
      if (curSec) { sp2 = d('sector_current_points', 2); sw2 = 'current role (' + who(curSec) + ') is in the JD sector = ' + sgn(sp2); sev = [qpath(curSec)]; }
      else if (!inSec.length) { sp2 = d('sector_over_3y_points', -4); sw2 = 'no role tagged as in the JD sector = ' + sgn(sp2); sev = []; }
      else {
        var latest = inSec.slice().sort(function (x, y) { return y.e - x.e; })[0];
        var since = cap - latest.e;
        if (since < 12) { sp2 = 0; sw2 = 'last in-sector role ended ' + ymLabel(latest.e) + ', ' + since + ' months ago (under 12) = 0'; }
        else if (since <= 36) { sp2 = d('sector_1_3y_points', -2); sw2 = 'last in-sector role ended ' + ymLabel(latest.e) + ', ' + since + ' months ago (12 to 36) = ' + sgn(sp2); }
        else { sp2 = d('sector_over_3y_points', -4); sw2 = 'last in-sector role ended ' + ymLabel(latest.e) + ', ' + since + ' months ago (over 36) = ' + sgn(sp2); }
        sev = [qpath(latest)];
      }
      items.push({ key: 'sector', label: 'Sector recency', points: sp2, working: sw2, evidence_paths: sev });

      // conventional certifications
      var cc = c14.conventional_certs || {}, cpts = 0, cwk;
      if (cc.applies === true) {
        var held = cc.held || [];
        cpts = held.length ? d('certs_held_points', 2) : d('certs_missing_points', -2);
        cwk = 'expected: ' + ((cc.expected || []).join(', ') || 'none listed') + '; held: ' + (held.join(', ') || 'none') + (cc.not_equivalent && cc.not_equivalent.length ? '; not equivalent: ' + cc.not_equivalent.join(', ') : '') + ' = ' + sgn(cpts);
      } else cwk = 'conventional certifications do not apply to this role family = 0';
      items.push({ key: 'certs', label: 'Conventional certifications', points: cpts, working: cwk, evidence_paths: ['c14.conventional_certs.evidence'] });

      // conflict of interest
      var coi = c14.conflict_of_interest || {}, cop = coi.present === true ? d('conflict_points', -3) : 0;
      items.push({ key: 'conflict', label: 'Conflict of interest', points: cop,
        working: coi.present === true ? 'possible conflict check: ' + (coi.description || 'see evidence') + ' = ' + sgn(cop) : 'no conflict of interest found = 0',
        evidence_paths: ['c14.conflict_of_interest.evidence'] });
    } else {
      notes.push('c14 judgements absent: seniority, contract, sector, certification and conflict items skipped');
    }

    items.forEach(function (it) { it.points = it.points || 0; }); // no negative zero
    var raw = r2(items.reduce(function (s, it) { return s + it.points; }, 0));
    var lo = d('cap_min', -15), hi = d('cap_max', 10);
    var total = r2(clamp(raw, lo, hi));
    var education = ((a.c9 || {}).institution);
    return {
      items: items, total: total, raw_total: raw, cap_min: lo, cap_max: hi,
      working: items.map(function (it) { return it.key + ' ' + sgn(it.points); }).join(', ') + ' = ' + sgn(raw) + (total !== raw ? ', clamped to ' + sgn(total) : ''),
      flags: {
        ats_dates: typeof cvText === 'string' ? atsDates(cvText) : [],
        education_blank: !(typeof education === 'string' && education.trim()),
        form_checklist: FORM_CHECKLIST.slice()
      },
      echo_phrases: echo, notes: notes
    };
  }

  function scoreAll(assessment, candidate, weights, cvText, jdText) {
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
    var c14 = computeC14(a, cvText, jdText, w);
    bonus.items = bonus.items.concat(c14.items.filter(function (it) { return it.points !== 0; }).map(function (it) { return { label: it.label, points: it.points, group: 'c14' }; }));
    if (c14.total !== c14.raw_total) bonus.items.push({ label: 'c14 clamped to ' + sgn(c14.total), points: r2(c14.total - c14.raw_total), group: 'c14' });
    bonus.c14 = c14.total;
    bonus.total = r2(bonus.c11 + bonus.c13 + bonus.c14);
    var comb = combine(forCombine, w.core, null, null, bonus.total, st.gamma);
    var strictness = { quadrant: st.quadrant, base: st.base, buzz: st.buzz, strictness: r2(st.strictness), gamma: r2(st.gamma) };
    // c2 is a modifier and c13 a bonus: they appear in criteria for their working string and confidence, with no score or weight.
    var c2conf = minConfidence(a.c2 || {});
    criteria.c2 = { score: null, weight: 0, modifier: true, not_applicable: false, confidence: c2conf, working: strictnessWorking(st, comb.core, comb.adjusted) };
    criteria.c13 = { score: null, weight: 0, bonus: true, points: bonus.c13, not_applicable: false, confidence: minConfidence(a.c13 || {}),
      working: c13Working(a, bonus, w) };
    criteria.c14 = { score: null, weight: 0, bonus: true, points: c14.total, not_applicable: false, confidence: minConfidence(a.c14 || {}), working: c14.working };
    return { criteria: criteria, c14: c14, core: comb.core, strictness: strictness, adjusted: comb.adjusted, bonus: bonus, total: comb.total, band: comb.band };
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
    scoreAll: scoreAll, computeC14: computeC14, echoPhrases: echoPhrases, atsDates: atsDates, combine: combine, computeBonus: computeBonus, computeStrictness: computeStrictness, band: band,
    unionMonths: unionMonths, monthIndex: monthIndex, CRITERIA: CRITERIA, C1_SUBS: C1_SUBS
  };
});
