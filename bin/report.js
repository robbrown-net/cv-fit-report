#!/usr/bin/env node
"use strict";
// node bin/report.js <report-dir>
// Reads scored.json + assessment.json (+ candidate.json) and writes report.html and report.pdf.
// report.html is a single self-contained file. Every string from the JSON files is escaped.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const IDS = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10"];
const NAMES = {
  c1: "Current or most recent role",
  c2: "Market position (BCG growth-share)",
  c3: "Years with the JD's tools and suppliers",
  c4: "AI experience and outcomes",
  c5: "Likelihood the CV was AI-generated",
  c6: "Spelling",
  c7: "Grammar",
  c8: "STAR / Problem-Action-Result bullets",
  c9: "Top university",
  c10: "Qualifications against the JD",
};
const DEFAULT_KEYS = {
  c1: "c1_current_role", c2: "c2_market_position", c3: "c3_tools_years", c4: "c4_ai_experience",
  c5: "c5_ai_generated", c6: "c6_spelling", c7: "c7_grammar", c8: "c8_star_par",
  c9: "c9_top_university", c10: "c10_qualifications",
};
const SUBS = ["title", "same_industry", "competitor", "supplier", "top_firm", "top10_consulting"];
const SUB_LABEL = {
  title: "Job title", same_industry: "Same industry", competitor: "Employer is a competitor",
  supplier: "Employer is a supplier", top_firm: "Worked at the market leader", top10_consulting: "Worked at a top-10 consultancy",
};

// ---------- helpers
const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const num = (n, d = 1) => (typeof n === "number" && isFinite(n) ? (Math.round((n + Number.EPSILON) * 10 ** d) / 10 ** d).toFixed(d) : "n/a");
const trim = (n) => String(Math.round(n * 100) / 100);
const arr = (a) => (Array.isArray(a) ? a : []);
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");
const normText = (s) => String(s || "").toLowerCase().replace(/[\u2018\u2019\u201B]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\s+/g, " ").trim();
const jsonForScript = (o) => JSON.stringify(o).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const readJson = (p, required) => {
  if (!fs.existsSync(p)) { if (required) { console.error("Missing " + p); process.exit(1); } return null; }
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { console.error("Cannot parse " + p + ": " + e.message); process.exit(1); }
};
const bandOf = (t) => (t >= 75 ? "Strong" : t >= 60 ? "Competitive" : t >= 45 ? "Stretch" : "Long shot");

function load(dir) {
  const scored = readJson(path.join(dir, "scored.json"), true);
  const a = readJson(path.join(dir, "assessment.json"), true);
  const cand = readJson(path.join(dir, "candidate.json"), false) || {};
  const defaults = readJson(path.join(ROOT, "config", "weights.json"), false) || {};
  const wu = scored.weights_used || {};
  const weights = {
    core: wu.core || defaults.core || DEFAULT_KEYS,
    c1_subweights: wu.c1_subweights || defaults.c1_subweights || Object.fromEntries(SUBS.map((s) => [s, 1])),
  };
  // keys for each cN inside weights.core
  const keys = {};
  for (const id of IDS) {
    keys[id] = Object.keys(weights.core).find((k) => k === id || k.startsWith(id + "_")) || DEFAULT_KEYS[id];
    if (!(keys[id] in weights.core)) weights.core[keys[id]] = (scored.criteria[id] || {}).weight || 0;
  }
  return { scored, a, cand, weights, keys, defaults };
}

// ---------- verification lookup
function makeVerifier(scored) {
  const list = arr(scored.verification && scored.verification.unverified);
  const paths = new Set(list.map((u) => u.path));
  const texts = new Set(list.map((u) => normText(u.text)));
  return (quote, p) => !(paths.has(p) || texts.has(normText(quote && quote.text)));
}

// ---------- evidence blocks
function Ctx(a, scored) {
  const sources = arr(a.sources);
  return { a, scored, verified: makeVerifier(scored), sourceIds: new Set(sources.map((s) => s.id)) };
}
function quoteBlock(ctx, q, kind, p) {
  if (!q || !q.text) return "";
  const ok = ctx.verified(q, p);
  return `<blockquote class="${kind === "JD" ? "jd" : "cv"}${ok ? "" : " unv"}"><span class="tag">${kind}</span>${esc(q.text)}` +
    (ok ? `<span class="badge ok" title="Found in the ${kind === "JD" ? "job description" : "CV"} text">&#10003; verified</span>`
        : `<span class="badge bad" title="Not found in the source text">&#10007; unverified</span>`) + `</blockquote>`;
}
function footnotes(ctx, ids) {
  return arr(ids).map((id) => ctx.sourceIds.has(id)
    ? `<a class="fn" href="#src-${esc(id)}">[${esc(id)}]</a>` : `<span class="fn muted" title="Source not in list">[${esc(id)}?]</span>`).join("");
}
function confBadge(c) {
  const v = String(c || "").toLowerCase();
  if (!v || v === "n/a") return "";
  const cls = v === "high" ? "conf-high" : v === "low" ? "conf-low" : "";
  return `<span class="badge ${cls}">${esc(v)} confidence</span>`;
}
function evidence(ctx, ev, p, opts = {}) {
  if (!ev) return "";
  let h = "";
  arr(ev.cv_quotes).forEach((q, i) => (h += quoteBlock(ctx, q, "CV", `${p}.cv_quotes[${i}]`)));
  arr(ev.jd_quotes).forEach((q, i) => (h += quoteBlock(ctx, q, "JD", `${p}.jd_quotes[${i}]`)));
  const fn = footnotes(ctx, ev.source_ids);
  if (ev.reasoning || fn) h += `<p class="reasoning">${esc(ev.reasoning)} ${fn}</p>`;
  if (opts.conf !== false && ev.confidence) h += `<p>${confBadge(ev.confidence)}</p>`;
  return h;
}
const table = (head, rows, numCols = []) =>
  `<div class="tablewrap"><table><thead><tr>${head.map((x, i) => `<th${numCols.includes(i) ? ' class="num"' : ""}>${esc(x)}</th>`).join("")}</tr></thead><tbody>` +
  rows.map((r) => `<tr>${r.map((c, i) => `<td${numCols.includes(i) ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`).join("") + `</tbody></table></div>`;
const h4 = (t) => `<h4>${esc(t)}</h4>`;

// ---------- months helper (c3)
function parseYM(s, fallback) {
  const m = /^(\d{4})-(\d{2})/.exec(String(s || ""));
  if (!m) return fallback;
  return Number(m[1]) * 12 + Number(m[2]) - 1;
}
function yearsCovered(roles, asOf) {
  const now = parseYM(asOf, new Date().getFullYear() * 12 + new Date().getMonth());
  const iv = arr(roles).map((r) => [parseYM(r.start, null), parseYM(r.end, now)]).filter((x) => x[0] != null && x[1] >= x[0]).sort((x, y) => x[0] - y[0]);
  let months = 0, cs = null, ce = null;
  for (const [s, e] of iv) {
    if (cs == null) { cs = s; ce = e; } else if (s <= ce) ce = Math.max(ce, e); else { months += ce - cs + 1; cs = s; ce = e; }
  }
  if (cs != null) months += ce - cs + 1;
  return months / 12;
}

// ---------- criterion detail renderers
function c1Detail(ctx, a, sc, w) {
  const c1 = a.c1 || {};
  const sub = (sc.sub) || {};
  const sw = w.c1_subweights;
  const detail = (k, o) => {
    if (!o) return "";
    if (k === "title") return `Level: <b>${esc(o.level)}</b>` + (a.current_role ? ` (CV: ${esc(a.current_role.title)}, ${esc(a.current_role.employer)})` : "");
    if (k === "same_industry") return `Candidate: ${esc(o.candidate_industry)}<br>Hiring: ${esc(o.hiring_industry)}`;
    if (k === "competitor") return `Considered: ${arr(o.competitors_considered).map(esc).join(", ") || "none"}`;
    if (k === "supplier") return `Products or services: ${arr(o.products_or_services).map(esc).join(", ") || "none"}`;
    if (k === "top_firm") return `Market leader: ${esc(o.top_firm)}`;
    return `Considered: ${arr(o.firms_considered).map(esc).join(", ") || "none"}` + (o.candidate_firm ? `<br>Candidate firm: ${esc(o.candidate_firm)}` : "");
  };
  const rows = SUBS.map((k) => {
    const o = c1[k] || {};
    const verdict = k === "title" ? "" : o.match ? ' <span class="badge ok">match</span>' : ' <span class="badge">no match</span>';
    const noEv = !o.evidence || (!arr(o.evidence.source_ids).length && !arr(o.evidence.cv_quotes).length && k !== "title") ? ' <span class="badge bad">no evidence found</span>' : "";
    return [`<b>${esc(SUB_LABEL[k])}</b>${verdict}${noEv}`, detail(k, o), num(sub[k], 0), esc(trim(Number(sw[k]) || 0))];
  });
  let h = h4("Six sub-checks") + table(["Sub-check", "What was found", "Score", "Sub-weight"], rows, [2, 3]);
  h += SUBS.map((k) => {
    const o = c1[k]; if (!o || !o.evidence) return "";
    const inner = evidence(ctx, o.evidence, `c1.${k}.evidence`);
    return inner ? `<details class="inline"><summary>Evidence: ${esc(SUB_LABEL[k])}</summary>${inner}</details>` : "";
  }).join("");
  return h;
}

function bcgSvg(c2, risk) {
  const W = 360, H = 300, L = 40, T = 12, R = 12, B = 40;
  const pw = W - L - R, ph = H - T - B;
  // x: relative share on a log scale, high share on the left (BCG convention): 10x .. 0.1x
  const sx = (rs) => { const v = Math.max(0.1, Math.min(10, rs || 0.1)); return L + pw * (1 - (Math.log10(v) + 1) / 2); };
  const gMax = 20;
  const sy = (g) => T + ph * (1 - Math.max(0, Math.min(gMax, g || 0)) / gMax);
  const mx = L + pw / 2, my = T + ph / 2; // thresholds: share 1.0 -> centre; growth 10% -> centre
  const px = sx(c2.relative_share), py = sy(c2.market_growth_pct);
  const q = c2.quadrant;
  const hot = { star: [L, T], question_mark: [mx, T], cash_cow: [L, my], dog: [mx, my] }[q];
  const lab = (t, x, y) => `<text class="qlab" x="${x}" y="${y}" text-anchor="middle">${t}</text>`;
  return `<svg class="bcg" viewBox="0 0 ${W} ${H}" role="img" aria-label="BCG matrix: ${esc(q)}, growth ${esc(c2.market_growth_pct)} percent, relative share ${esc(c2.relative_share)}">` +
    (hot ? `<rect class="hot" x="${hot[0]}" y="${hot[1]}" width="${pw / 2}" height="${ph / 2}"/>` : "") +
    `<rect class="grid" x="${L}" y="${T}" width="${pw}" height="${ph}"/><line class="grid" x1="${mx}" y1="${T}" x2="${mx}" y2="${T + ph}"/><line class="grid" x1="${L}" y1="${my}" x2="${L + pw}" y2="${my}"/>` +
    lab("STAR", L + pw / 4, T + 18) + lab("QUESTION MARK", mx + pw / 4, T + 18) + lab("CASH COW", L + pw / 4, T + ph - 10) + lab("DOG", mx + pw / 4, T + ph - 10) +
    `<text x="${L + pw / 2}" y="${H - 8}" text-anchor="middle">Relative market share (high &larr; &rarr; low), threshold 1.0</text>` +
    `<text transform="translate(12 ${T + ph / 2}) rotate(-90)" text-anchor="middle">Market growth, threshold 10%</text>` +
    `<circle class="dot" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="7"/>` +
    `<text class="dlab" x="${px.toFixed(1)}" y="${(py - 12).toFixed(1)}" text-anchor="middle">${esc(num(c2.relative_share, 2))}x, ${esc(num(c2.market_growth_pct, 1))}%</text></svg>`;
}

function c2Detail(ctx, a, sc, w) {
  const c = a.c2 || {};
  const qv = (w.quadrant || {})[c.quadrant];
  const quad = ((ctx.defaults || {}).c2_quadrant_risk_aversion || { cash_cow: 100, star: 75, question_mark: 50, dog: 25 })[c.quadrant];
  const ra = typeof (ctx.cand || {}).risk_aversion_override === "number" ? ctx.cand.risk_aversion_override : c.candidate_risk_aversion;
  const left = (v) => Math.max(0, Math.min(100, v)) + "%";
  let h = h4("Where the hiring organisation sits") + bcgSvg(c, ra);
  h += `<p class="small muted">Unit assessed: ${esc(c.unit_assessed || "company")}. Quadrant: <b>${esc(String(c.quadrant || "").replace("_", " "))}</b>, market growth ${esc(num(c.market_growth_pct))}% a year, relative share ${esc(num(c.relative_share, 2))}.</p>`;
  h += h4("Candidate risk aversion vs quadrant fit");
  h += `<div class="rabar" aria-label="Risk aversion ${esc(ra)}, quadrant value ${esc(quad)}"><i style="left:${left(quad)}"><span>role suits ${esc(quad)}</span></i><b style="left:${left(ra)}"><span>candidate ${esc(ra)}</span></b></div>`;
  h += `<p class="small">c2 = 100 &minus; |${esc(quad)} &minus; ${esc(ra)}| = <b>${esc(num(sc.score))}</b>` +
    (typeof ctx.cand.risk_aversion_override === "number" ? " (risk aversion overridden by the candidate)" : "") + `</p>`;
  h += h4("Evidence for the quadrant") + evidence(ctx, c.evidence, "c2.evidence");
  h += h4("Evidence for risk aversion") + evidence(ctx, c.candidate_evidence, "c2.candidate_evidence");
  return h;
}

function c3Detail(ctx, a, sc, w) {
  const c = a.c3 || {};
  const defReq = Number(ctx.defaults && ctx.defaults.c3_default_required_years) || 3;
  const items = arr(c.items);
  if (!items.length) return "<p>The JD names no tools or suppliers.</p>";
  const rows = items.map((it) => {
    const req = it.required_years || defReq;
    const yrs = yearsCovered(it.cv_roles, a.meta && a.meta.assessed_on);
    return [`<b>${esc(it.name)}</b>`, esc(trim(req)) + (it.required_years ? "" : ' <span class="muted">(default)</span>'), esc(num(yrs)), esc(num(Math.min(yrs / req, 1) * 100, 0))];
  });
  let h = h4("Tools, services and suppliers") + table(["Item", "Required years", "Years found", "Score"], rows, [1, 2, 3]);
  h += `<p class="small muted">Years found = months of the CV roles that mention the item, overlaps counted once.</p>`;
  h += items.map((it, i) => {
    const inner = quoteBlock(ctx, it.jd_quote, "JD", `c3.items[${i}].jd_quote`) +
      arr(it.cv_roles).map((r, j) => `<p class="small"><b>${esc(r.employer)}</b> ${esc(r.start)} to ${esc(r.end || "present")}</p>` + quoteBlock(ctx, r.quote, "CV", `c3.items[${i}].cv_roles[${j}].quote`)).join("");
    return `<details class="inline"><summary>${esc(it.name)}</summary>${inner}</details>`;
  }).join("");
  return h;
}

function c4Detail(ctx, a, sc) {
  const c = a.c4 || {};
  const uses = arr(c.uses);
  const cats = {};
  uses.forEach((u, i) => { (cats[u.category || "other"] = cats[u.category || "other"] || []).push([u, i]); });
  const nc = Object.keys(cats).length, nq = uses.filter((u) => u.quantified).length, yrs = Number(c.years_using_ai) || 0;
  let h = `<p class="small">breadth = min(${nc}/4, 1) &times; 50 = ${num(Math.min(nc / 4, 1) * 50)}; depth = min(${nq}/3, 1) &times; 30 = ${num(Math.min(nq / 3, 1) * 30)}; tenure = min(${esc(trim(yrs))}/3, 1) &times; 20 = ${num(Math.min(yrs / 3, 1) * 20)}</p>`;
  h += h4("Uses of AI by outcome category");
  h += Object.keys(cats).map((cat) => `<h3 class="small">${esc(cat.replace(/_/g, " "))}</h3>` + cats[cat].map(([u, i]) =>
    `<p class="small" style="margin:6px 0 0">${esc(u.description)} ${u.quantified ? '<span class="badge ok">quantified</span>' : '<span class="badge">not quantified</span>'}</p>` + quoteBlock(ctx, u.quote, "CV", `c4.uses[${i}].quote`)).join("")).join("");
  h += h4("Reasoning") + evidence(ctx, c.evidence, "c4.evidence");
  return h;
}

function c5Detail(ctx, a, sc) {
  const c = a.c5 || {};
  let h = `<div class="caveat"><b>AI-detection is indicative only.</b> No detector is reliable, and a human can write in any of these patterns. Treat this as a prompt to review the CV, not as proof of how it was written.</div>`;
  h += `<p class="small">Estimated likelihood: <b>${esc(num(c.likelihood, 0))}%</b>. Direction: ${esc((sc.direction) || (a.c5_direction) || "negative")}.</p>`;
  h += h4("Signals") + table(["Signal", "Strength", "Quote"], arr(c.signals).map((s, i) => [esc(s.signal), `<span class="badge">${esc(s.weight)}</span>`, quoteBlock(ctx, s.quote, "CV", `c5.signals[${i}].quote`)]));
  h += evidence(ctx, c.evidence, "c5.evidence");
  return h;
}

function errList(ctx, items, key, withRule) {
  if (!items.length) return "<p>No errors found.</p>";
  const rows = items.map((e, i) => {
    const ok = ctx.verified(e.quote, `${key}.errors[${i}].quote`);
    return [`<span style="text-decoration:line-through;text-decoration-color:var(--bad)">${esc(e.quote && e.quote.text)}</span>${ok ? "" : ' <span class="badge bad">&#10007; unverified</span>'}`, `<b>${esc(e.correction)}</b>`].concat(withRule ? [esc(e.rule)] : []).concat([esc(e.line)]);
  });
  return table(["Original", "Correction"].concat(withRule ? ["Rule"] : []).concat(["Line"]), rows, [withRule ? 3 : 2]);
}
const c6Detail = (ctx, a, sc) => `<p class="small">Variety checked: ${esc((a.c6 || {}).variant || "en-GB")}. ${arr((a.c6 || {}).errors).length} error(s), 5 points each.</p>` + errList(ctx, arr((a.c6 || {}).errors), "c6", false);
const c7Detail = (ctx, a, sc) => `<p class="small">${arr((a.c7 || {}).errors).length} error(s), 5 points each.</p>` + errList(ctx, arr((a.c7 || {}).errors), "c7", true);

function c8Detail(ctx, a, sc) {
  const b = arr((a.c8 || {}).bullets);
  const n = (l) => b.filter((x) => x.level === l).length;
  let h = `<p class="small">${b.length} bullets: ${n("full")} full, ${n("partial")} partial, ${n("none")} none.</p>`;
  h += `<div class="legend"><span class="lf">full: situation, action, result</span><span class="lp">partial</span><span class="ln">none</span></div>`;
  h += b.map((x, i) => {
    const p = x.parts || {};
    const chip = (k, l) => `<span class="chip${p[k] ? " on" : ""}" title="${esc(k)}${p[k] ? " found" : " missing"}">${l}</span>`;
    const ok = ctx.verified(x.quote, `c8.bullets[${i}].quote`);
    const lvl = ["full", "partial", "none"].includes(x.level) ? x.level : "none";
    return `<div class="bullet ${lvl}"><div>${chip("situation", "S")}${chip("action", "A")}${chip("result", "R")} ${esc(x.quote && x.quote.text)}${ok ? "" : ' <span class="badge bad">&#10007; unverified</span>'}</div></div>`;
  }).join("");
  return h;
}

function c9Detail(ctx, a, sc) {
  const c = a.c9 || {};
  return table(["Institution", "Tier", "Graduated"], [[esc(c.institution), esc(String(c.tier || "").replace(/_/g, " ")), c.graduated ? '<span class="badge ok">yes</span>' : '<span class="badge bad">not evidenced</span>']]) + evidence(ctx, c.evidence, "c9.evidence");
}

function c10Detail(ctx, a, sc) {
  const items = arr((a.c10 || {}).items);
  if (!items.length) return "<p>The JD asks for no qualifications.</p>";
  const rows = items.map((it) => [esc(it.requirement), it.required ? "required (x2)" : "desirable", `<span class="badge ${it.status === "met" ? "ok" : it.status === "not_met" ? "bad" : ""}">${esc(String(it.status).replace("_", " "))}</span>`]);
  let h = table(["Requirement", "Type", "Status"], rows);
  h += items.map((it, i) => {
    const inner = quoteBlock(ctx, it.jd_quote, "JD", `c10.items[${i}].jd_quote`) + evidence(ctx, it.evidence, `c10.items[${i}].evidence`);
    return inner ? `<details class="inline"><summary>${esc(it.requirement)}</summary>${inner}</details>` : "";
  }).join("");
  return h;
}

// ---------- card
function card(ctx, id, detail, w) {
  const sc = ctx.scored.criteria[id] || {};
  const na = !!sc.not_applicable;
  const a = ctx.a;
  const key = id;
  const ev = (a[key] && a[key].evidence) || null;
  let body = "";
  try { body = detail(ctx, a, sc, w); } catch (e) { body = `<p class="muted">Detail unavailable: ${esc(e.message)}</p>`; }
  if (id === "c1") body += h4("Current role") + (a.current_role ? `<p class="small"><b>${esc(a.current_role.title)}</b>, ${esc(a.current_role.employer)}, from ${esc(a.current_role.start)} ${a.current_role.end ? "to " + esc(a.current_role.end) : "(current)"}</p>` + evidence(ctx, a.current_role.evidence, "current_role.evidence") : "");
  const score = na ? "n/a" : num(sc.score);
  const conf = sc.confidence || (ev && ev.confidence);
  return `<details class="card${na ? " na" : ""}" id="card-${id}"><summary>
    <span class="cid">${id}</span><span class="ctitle">${esc(NAMES[id])}</span><span class="cscore">${esc(score)}</span>
    <span class="bar" role="img" aria-label="score ${esc(score)} of 100"><i style="width:${na ? 0 : Math.max(0, Math.min(100, Number(sc.score) || 0))}%"></i></span>
    <span class="cmeta"><span class="chev">&#9656;</span>${na ? '<span class="badge">not applicable: weight dropped, rest renormalised</span>' : `<span data-weight-for="${id}">weight ${esc(trim(Number(sc.weight) || 0))}</span>`}${confBadge(conf)}</span>
    <span class="working">${esc(sc.working || "")}</span></summary>
    <div class="cbody">${na ? `<p>This criterion could not be assessed, so it does not count towards the total.</p>` : ""}${body}</div></details>`;
}

// ---------- page
function buildHtml(d) {
  const { scored, a, cand, weights, keys } = d;
  const ctx = Ctx(a, scored);
  ctx.defaults = d.defaults; ctx.cand = cand;
  const meta = a.meta || scored.meta || {};
  const name = meta.candidate || cand.name || "Candidate";
  const total = Number(scored.total), core = Number(scored.core);
  const bonusTotal = Number((scored.bonus || {}).total) || 0;
  const band = scored.band || bandOf(total);
  const ver = scored.verification || {};

  // formula + arithmetic
  const live = IDS.map((id) => ({ id, sc: scored.criteria[id] || {} })).filter((x) => !x.sc.not_applicable && typeof x.sc.score === "number");
  const sumW = live.reduce((s, x) => s + (Number(x.sc.weight) || 0), 0);
  const sumWS = live.reduce((s, x) => s + (Number(x.sc.weight) || 0) * x.sc.score, 0);
  const na = IDS.filter((id) => (scored.criteria[id] || {}).not_applicable);
  const formula = `<div class="formula">
    <p>core = &Sigma;(weight &times; score) / &Sigma;(weight) = ${esc(num(sumWS, 1))} / ${esc(num(sumW, 2))} = <span class="eq">${esc(num(core))}</span></p>
    <p>bonus = ${esc(bonusTotal >= 0 ? "+" : "")}${esc(trim(bonusTotal))}</p>
    <p>total = clamp(core + bonus, 0, 100) = clamp(${esc(num(core))} ${bonusTotal < 0 ? "&minus;" : "+"} ${esc(trim(Math.abs(bonusTotal)))}, 0, 100) = <span class="eq">${esc(num(total))}</span></p>
    ${na.length ? `<p class="muted">Not applicable, weight dropped: ${na.join(", ")}</p>` : ""}</div>
    <details class="inline"><summary>Show the arithmetic for each criterion</summary>${table(["Criterion", "Weight", "Score", "Weight &times; score"].map((x) => x.replace("&times;", "x")),
      IDS.map((id) => { const s = scored.criteria[id] || {}; const n = s.not_applicable; return [`${id} ${esc(NAMES[id])}`, n ? "dropped" : esc(trim(Number(s.weight) || 0)), n ? "n/a" : esc(num(s.score)), n ? "" : esc(num((Number(s.weight) || 0) * s.score, 1))]; }), [1, 2, 3])}
    <p class="small muted">c1 itself is the weighted mean of its six sub-scores, see its card.</p></details>`;

  const bonusItems = arr((scored.bonus || {}).items);
  const bonusCard = `<details class="card" id="card-c11"><summary><span class="cid">c11</span><span class="ctitle">Candidate's own access (bonus)</span><span class="cscore">${bonusTotal >= 0 ? "+" : ""}${esc(trim(bonusTotal))}</span>
    <span class="cmeta"><span class="chev">&#9656;</span><span>self-reported, never inferred by the AI</span></span></summary><div class="cbody">` +
    (bonusItems.length ? table(["Item", "Points"], bonusItems.map((i) => [esc(i.label), esc((i.points >= 0 ? "+" : "") + trim(i.points))]), [1]) : "<p>No bonus items were reported.</p>") +
    (cand.previously_worked_here && cand.previously_worked_here.note ? `<p class="small">Previously worked here: ${esc(cand.previously_worked_here.note)}</p>` : "") +
    arr(cand.referrals).map((r) => `<p class="small">Referral (${esc(String(r.type).replace(/_/g, " "))}${r.seniority ? ", " + esc(r.seniority) : ""}${r.visibility ? ", " + esc(r.visibility) + " visibility" : ""})${r.note ? ": " + esc(r.note) : ""}</p>`).join("") +
    `</div></details>`;

  const cards = IDS.map((id) => card(ctx, id, { c1: c1Detail, c2: c2Detail, c3: c3Detail, c4: c4Detail, c5: c5Detail, c6: c6Detail, c7: c7Detail, c8: c8Detail, c9: c9Detail, c10: c10Detail }[id], weights)).join("") + bonusCard;

  const sm = a.summary || {};
  const list = (t, items) => `<div><h3>${esc(t)}</h3><ul>${arr(items).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;

  const sources = arr(a.sources).map((s) => {
    const u = safeUrl(s.url);
    return `<li id="src-${esc(s.id)}"><span class="sid">[${esc(s.id)}]</span><b>${esc(s.title)}</b><br>` +
      (u ? `<a class="url" href="${esc(u)}" rel="noopener noreferrer nofollow" target="_blank">${esc(u)}</a>` : `<span class="url badge bad">no valid URL</span>`) +
      `<div class="small muted">Accessed ${esc(s.accessed)}</div><blockquote>${esc(s.quote)}</blockquote></li>`;
  }).join("");

  const unv = Number(ver.quotes_unverified) || 0;
  const verLine = ver.quotes_total != null ? `${ver.quotes_total - unv} of ${ver.quotes_total} quotes verified verbatim against the CV and JD text.` : "";

  // client data
  const D = {
    names: NAMES, keys, weights, total, core, bonusTotal,
    criteria: Object.fromEntries(IDS.map((id) => { const s = scored.criteria[id] || {}; return [id, { score: s.score == null ? null : s.score, weight: s.weight, na: !!s.not_applicable, sub: s.sub || null }]; })),
  };
  if (!D.criteria.c1.sub) D.criteria.c1.sub = {};

  const css = fs.readFileSync(path.join(ROOT, "lib", "report.css"), "utf8");
  const client = fs.readFileSync(path.join(ROOT, "lib", "report-client.js"), "utf8").replace(/<\/script/gi, "<\\/script");
  let scoringSrc = "";
  const sp = path.join(ROOT, "lib", "scoring.js");
  if (fs.existsSync(sp)) scoringSrc = fs.readFileSync(sp, "utf8").replace(/<\/script/gi, "<\\/script");

  const C = 2 * Math.PI * 80;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>CV fit report: ${esc(name)} for ${esc(meta.role_title)} at ${esc(meta.hiring_company)}</title>
<style>${css}</style></head><body><div class="wrap">
<header>
  <p class="eyebrow">CV fit report</p>
  <div class="hero">
    <div class="hero-text">
      <h1>${esc(meta.role_title)}<br><span class="muted">at ${esc(meta.hiring_company)}${meta.division_or_product ? ", " + esc(meta.division_or_product) : ""}</span></h1>
      <ul class="hero-meta"><li>Candidate: <b>${esc(name)}</b></li><li>Assessed: <b>${esc(meta.assessed_on)}</b></li><li>Model: <b>${esc(meta.assessed_by)}</b></li>${verLine ? `<li>${esc(verLine)}</li>` : ""}</ul>
      ${unv ? `<p class="warn-note">${unv} quote(s) could not be verified against the source text. They are marked in red and the affected criteria carry low confidence.</p>` : ""}
    </div>
    <div class="gauge">
      <svg viewBox="0 0 200 200" role="img" aria-label="Total score ${esc(num(total))} out of 100, ${esc(band)}">
        <circle class="ring-bg" cx="100" cy="100" r="80"/>
        <circle id="ring-fg" class="ring-fg" cx="100" cy="100" r="80" transform="rotate(-90 100 100)" stroke-dasharray="${(C * Math.max(0, Math.min(100, total)) / 100).toFixed(1)} ${C.toFixed(1)}"/>
        <text id="gauge-num" class="gauge-num" x="100" y="108" text-anchor="middle">${esc(num(total))}</text>
        <text class="gauge-sub" x="100" y="132" text-anchor="middle">OUT OF 100</text>
      </svg>
      <span class="band" id="band">${esc(band)}</span>
    </div>
  </div>
  <div class="split">
    <div><div class="k">Core (c1 to c10)</div><div class="v" id="v-core">${esc(num(core))}</div></div>
    <div><div class="k">Bonus (c11)</div><div class="v">${bonusTotal >= 0 ? "+" : ""}${esc(trim(bonusTotal))}</div></div>
    <div><div class="k">Total</div><div class="v" data-live-total>${esc(num(total))}</div></div>
  </div>
  <div class="banner" id="custom-banner" role="status"></div>
</header>

<section id="how"><h2>How this score was calculated</h2>
<p class="lede">Scores are computed by a script from the evidence below. The AI gathers evidence and makes the judgements, it never states a score.</p>${formula}</section>

<section id="weights"><h2>Weights</h2>
<p class="lede">Disagree with the emphasis? Move a slider and the total updates. Nothing is saved or sent anywhere.</p>
<div class="panel"><h3>Core criteria</h3><div class="sliders" id="sl-core"></div><h3>c1 sub-checks</h3><div class="sliders" id="sl-c1"></div>
<div class="btns"><button id="reset" type="button">Reset</button><button id="copy" class="primary" type="button">Copy weights JSON</button><span class="copied" id="copied" role="status"></span></div>
<pre id="snippet" class="mono small tablewrap" hidden></pre>
<p class="small muted" id="calc-source"></p></div></section>

<section id="criteria"><h2>Criteria</h2><p class="lede">Open a card to see the evidence behind its score. Quotes marked verified were found verbatim in the CV or job description.</p><div class="cards">${cards}</div></section>

<section id="summary"><h2>Summary</h2><div class="cols">${list("Strengths", sm.strengths)}${list("Risks", sm.risks)}${list("Actions", sm.actions)}</div></section>

<section id="sources"><h2>Sources</h2><ol class="sources">${sources || '<li class="muted">No web sources were used.</li>'}</ol></section>

<footer>Every number above can be recomputed from docs/rubric.md and the evidence shown.</footer>
</div>
<script type="application/json" id="report-data">${jsonForScript(D)}</script>
${scoringSrc ? `<script>var __m={exports:{}};(function(module,exports,require){try{\n${scoringSrc}\n}catch(e){}})(__m,__m.exports,function(){return {};});window.__scoring=__m.exports;</script>` : ""}
<script>${client}</script>
</body></html>`;
}

// ---------- PDF
async function buildPdf(d, outPath) {
  const pdfmake = require("pdfmake");
  const FONT_DIR = path.join(ROOT, "fonts");
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy((p) => path.resolve(p).startsWith(FONT_DIR + path.sep));
  pdfmake.setFonts({ Arimo: {
    normal: path.join(FONT_DIR, "Arimo_400Regular.ttf"), bold: path.join(FONT_DIR, "Arimo_700Bold.ttf"),
    italics: path.join(FONT_DIR, "Arimo_400Regular_Italic.ttf"), bolditalics: path.join(FONT_DIR, "Arimo_700Bold_Italic.ttf") } });
  const { scored, a, cand } = d;
  const meta = a.meta || scored.meta || {};
  const ACC = "#1f6f6b", GREY = "#666666", LINE = "#cccccc";
  const total = Number(scored.total), core = Number(scored.core), bonus = Number((scored.bonus || {}).total) || 0;
  const hdr = (t) => ({ text: t, fontSize: 13, bold: true, margin: [0, 16, 0, 6] });
  const ul = (items) => ({ ul: arr(items).map((x) => String(x)), margin: [0, 0, 0, 4], fontSize: 9.5 });
  const rows = IDS.map((id) => {
    const s = scored.criteria[id] || {};
    return [
      { text: id, bold: true, color: ACC }, { text: NAMES[id], bold: true },
      { text: s.not_applicable ? "n/a" : num(s.score), alignment: "right" },
      { text: s.not_applicable ? "dropped" : trim(Number(s.weight) || 0), alignment: "right" },
      { text: (s.not_applicable ? "Not applicable: weight dropped. " : "") + (s.working || ""), fontSize: 8, color: GREY },
    ];
  });
  const doc = {
    info: { title: `CV fit report: ${meta.candidate || ""}`, author: "cv-fit-report", subject: "CV fit report" },
    pageSize: "A4", pageMargins: [40, 44, 40, 48],
    defaultStyle: { font: "Arimo", fontSize: 10, color: "#1a1a1a" },
    footer: (cur, cnt) => ({ text: `Every number can be recomputed from docs/rubric.md and the evidence shown.   ${cur}/${cnt}`, fontSize: 7.5, color: GREY, alignment: "center", margin: [0, 14, 0, 0] }),
    content: [
      { text: "CV FIT REPORT", fontSize: 8, color: GREY, characterSpacing: 1.5 },
      { columns: [
        { width: "*", stack: [
          { text: String(meta.role_title || ""), fontSize: 20, bold: true, margin: [0, 4, 0, 0] },
          { text: `at ${meta.hiring_company || ""}${meta.division_or_product ? ", " + meta.division_or_product : ""}`, fontSize: 12, color: GREY },
          { text: `Candidate: ${meta.candidate || cand.name || ""}\nAssessed: ${meta.assessed_on || ""}\nModel: ${meta.assessed_by || ""}`, fontSize: 9, color: GREY, margin: [0, 8, 0, 0] } ] },
        { width: 120, stack: [
          { text: num(total), fontSize: 38, bold: true, color: ACC, alignment: "right" },
          { text: String(scored.band || bandOf(total)), fontSize: 11, bold: true, alignment: "right" },
          { text: `core ${num(core)}  bonus ${bonus >= 0 ? "+" : ""}${trim(bonus)}`, fontSize: 8.5, color: GREY, alignment: "right" } ] } ] },
      { text: `total = clamp(core + bonus, 0, 100) = clamp(${num(core)} ${bonus < 0 ? "-" : "+"} ${trim(Math.abs(bonus))}, 0, 100) = ${num(total)}`, fontSize: 8.5, color: GREY, margin: [0, 10, 0, 0] },
      hdr("Criteria"),
      { table: { headerRows: 1, widths: [22, 130, 34, 38, "*"], body: [
        ["", "Criterion", "Score", "Weight", "Working"].map((t, i) => ({ text: t, bold: true, fontSize: 8, color: GREY, alignment: i === 2 || i === 3 ? "right" : "left" })), ...rows ] },
        layout: { hLineColor: () => LINE, vLineWidth: () => 0, hLineWidth: (i) => (i === 0 ? 0 : 0.5), paddingTop: () => 4, paddingBottom: () => 4 } },
      hdr("Strengths"), ul((a.summary || {}).strengths),
      hdr("Risks"), ul((a.summary || {}).risks),
      hdr("Actions"), ul((a.summary || {}).actions),
      hdr("Sources"),
      ...arr(a.sources).map((s) => ({ margin: [0, 0, 0, 5], stack: [
        { text: [{ text: `[${s.id}] `, bold: true, color: ACC }, { text: String(s.title || ""), bold: true }], fontSize: 9 },
        { text: `${safeUrl(s.url) || "(no valid URL)"}  accessed ${s.accessed || ""}`, fontSize: 7.5, color: GREY },
        { text: `"${s.quote || ""}"`, fontSize: 8, italics: true } ] })),
    ],
  };
  const buf = await pdfmake.createPdf(doc).getBuffer();
  fs.writeFileSync(outPath, buf);
}

// ---------- main
(async () => {
  const dir = process.argv[2];
  if (!dir) { console.error("Usage: node bin/report.js <report-dir>"); process.exit(1); }
  const abs = path.resolve(dir);
  const d = load(abs);
  fs.writeFileSync(path.join(abs, "report.html"), buildHtml(d));
  console.log("Wrote " + path.join(abs, "report.html"));
  try { await buildPdf(d, path.join(abs, "report.pdf")); console.log("Wrote " + path.join(abs, "report.pdf")); }
  catch (e) { console.error("PDF failed: " + e.message + (e.code === "MODULE_NOT_FOUND" ? " (run npm install)" : "")); process.exitCode = 1; }
})();
