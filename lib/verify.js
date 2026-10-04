'use strict';
// Quote and source verification. Pure (no fs).

const BULLETS = '\\u2022\\u25AA\\u25AB\\u25E6\\u25CF\\u25CB\\u2023\\u2219\\u00B7\\u25A0\\u25A1\\u2043\\uF0B7\\*\\-';

function normalise(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/[‘’‚‛′´`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/­/g, '')
    .split(/\r?\n|\f/)
    .map((l) => l.replace(new RegExp('^\\s*[' + BULLETS + ']+\\s+'), ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function validDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function checkSource(s) {
  const why = [];
  if (!s || typeof s !== 'object') return ['not an object'];
  if (typeof s.url !== 'string' || !/^https?:\/\/\S+$/i.test(s.url.trim())) why.push('url missing or not http(s)');
  if (typeof s.title !== 'string' || !s.title.trim()) why.push('title missing');
  if (!validDate(s.accessed)) why.push('accessed must be YYYY-MM-DD');
  if (typeof s.quote !== 'string' || !s.quote.trim()) why.push('quote missing');
  return why;
}

function quoteText(q) { return typeof q === 'string' ? q : (q && typeof q === 'object' ? q.text : undefined); }

// Collect every Quote with the context ('cv' | 'jd') it must be found in.
function collectQuotes(assessment) {
  const out = [];
  (function walk(node, p) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, p + '[' + i + ']')); return; }
    for (const k of Object.keys(node)) {
      const v = node[k];
      const kp = p ? p + '.' + k : k;
      if (p === '' && k === 'sources') continue; // source.quote is web text, not CV/JD text
      if ((k === 'cv_quotes' || k === 'jd_quotes') && Array.isArray(v)) {
        v.forEach((q, i) => out.push({ path: kp + '[' + i + ']', ctx: k === 'jd_quotes' ? 'jd' : 'cv', text: quoteText(q) }));
      } else if ((k === 'quote' || k === 'jd_quote') && v !== null && v !== undefined && (typeof v === 'object' || typeof v === 'string')) {
        out.push({ path: kp, ctx: k === 'jd_quote' ? 'jd' : 'cv', text: quoteText(v) });
      } else {
        walk(v, kp);
      }
    }
  })(assessment, '');
  return out;
}

function collectSourceRefs(assessment) {
  const out = [];
  (function walk(node, p) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, p + '[' + i + ']')); return; }
    for (const k of Object.keys(node)) {
      const kp = p ? p + '.' + k : k;
      if (p === '' && k === 'sources') continue;
      if (k === 'source_ids' && Array.isArray(node[k])) node[k].forEach((id, i) => out.push({ path: kp + '[' + i + ']', id }));
      else walk(node[k], kp);
    }
  })(assessment, '');
  return out;
}

function verify(assessment, cvText, jdText) {
  const cv = normalise(cvText), jd = normalise(jdText);
  const quotes = collectQuotes(assessment);
  const unverified = [];
  for (const q of quotes) {
    const n = normalise(q.text);
    const hay = q.ctx === 'jd' ? jd : cv;
    if (!n || !hay.includes(n)) {
      unverified.push({ path: q.path, text: q.text === undefined ? '' : String(q.text), context: q.ctx });
    }
  }
  const sources = Array.isArray(assessment && assessment.sources) ? assessment.sources : [];
  const ids = new Set();
  const rejected = [];
  sources.forEach((s, i) => {
    const why = checkSource(s);
    if (s && s.id) {
      if (ids.has(s.id)) why.push('duplicate id');
      ids.add(s.id);
    } else why.push('id missing');
    if (why.length) rejected.push({ id: (s && s.id) || null, path: 'sources[' + i + ']', reason: why.join('; ') });
  });
  const rejectedIds = new Set(rejected.map((r) => r.id).filter(Boolean));
  const refs = collectSourceRefs(assessment);
  const missing = refs.filter((r) => !ids.has(r.id)).map((r) => ({ path: r.path, id: r.id }));
  return {
    quotes_total: quotes.length,
    quotes_unverified: unverified.length,
    unverified,
    sources_total: sources.length,
    sources_rejected: rejected,
    source_refs_missing: missing,
    rejected_source_ids: Array.from(rejectedIds)
  };
}

module.exports = { verify, normalise, checkSource, collectQuotes, validDate };
