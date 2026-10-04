#!/usr/bin/env node
"use strict";
// node bin/report.js <report-dir>
// Reads scored.json + assessment.json (+ candidate.json) and writes report.html and report.pdf.
// report.html is a single self-contained file. Every string from the JSON files is escaped.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
// IDS are the weighted core criteria. c2 is a strictness modifier, c11 and c13 are bonuses.
const IDS = ["c1", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c12"];
const ORDER = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c12"];
const NAMES = {
  c1: "Current or most recent role",
  c2: "Employer strictness (BCG growth-share)",
  c3: "Years with the JD's tools and suppliers",
  c4: "AI experience and outcomes",
  c5: "Likelihood the CV was AI-generated",
  c6: "Spelling",
  c7: "Grammar",
  c8: "STAR / Problem-Action-Result bullets",
  c9: "Top university",
  c10: "Qualifications against the JD",
  c12: "Tenure against expected longevity",
  c13: "Consulting experience (bonus)",
  c14: "Screening signals (plus and minus points)",
};
const DEFAULT_KEYS = {
  c1: "c1_current_role", c3: "c3_tools_years", c4: "c4_ai_experience",
  c5: "c5_ai_generated", c6: "c6_spelling", c7: "c7_grammar", c8: "c8_star_par",
  c9: "c9_top_university", c10: "c10_qualifications", c12: "c12_tenure",
};
const SUBS = ["title", "headline", "same_industry", "competitor", "supplier", "top_firm"];
const SUB_LABEL = {
  title: "Job title", headline: "CV headline", same_industry: "Same industry", competitor: "Employer is a competitor",
  supplier: "Employer is a supplier", top_firm: "Worked at the market leader",
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
    if (k === "headline") { const q = arr((o.evidence || {}).cv_quotes)[0]; return `Level: <b>${esc(o.level)}</b>` + (q ? ` (CV headline: ${esc(q.text)})` : ""); }
    if (k === "same_industry") return `Candidate: ${esc(o.candidate_industry)}<br>Hiring: ${esc(o.hiring_industry)}`;
    if (k === "competitor") return `Considered: ${arr(o.competitors_considered).map(esc).join(", ") || "none"}`;
    if (k === "supplier") return `Products or services: ${arr(o.products_or_services).map(esc).join(", ") || "none"}`;
    if (k === "top_firm") return `Market leader: ${esc(o.top_firm)}`;
    return "";
  };
  const rows = SUBS.map((k) => {
    const o = c1[k] || {};
    const verdict = k === "title" || k === "headline" ? "" : o.match ? ' <span class="badge ok">match</span>' : ' <span class="badge">no match</span>';
    const noEv = !o.evidence || (!arr(o.evidence.source_ids).length && !arr(o.evidence.cv_quotes).length && k !== "title" && k !== "headline") ? ' <span class="badge bad">no evidence found</span>' : "";
    return [`<b>${esc(SUB_LABEL[k])}</b>${verdict}${noEv}`, detail(k, o), num(sub[k], 0), esc(trim(Number(sw[k]) || 0))];
  });
  let h = h4("Six sub-checks (the headline carries a quarter of the weight of the others)") + table(["Sub-check", "What was found", "Score", "Sub-weight"], rows, [2, 3]);
  h += SUBS.map((k) => {
    const o = c1[k]; if (!o || !o.evidence) return "";
    const inner = evidence(ctx, o.evidence, `c1.${k}.evidence`);
    return inner ? `<details class="inline"><summary>Evidence: ${esc(SUB_LABEL[k])}</summary>${inner}</details>` : "";
  }).join("");
  return h;
}

function bcgSvg(c2) {
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
  const st = ctx.scored.strictness || {};
  const bases = (ctx.scored.weights_used || {}).c2_strictness || (ctx.defaults || {}).c2_strictness || { cash_cow: 1, star: 0.75, question_mark: 0.5, dog: 0.25 };
  const gb = Number((ctx.scored.weights_used || {}).c2_gamma_base);
  const gammaBase = isFinite(gb) ? gb : 0.5;
  const buzz = c.buzz || {};
  const L = (k, v) => `<span data-live="${k}">${esc(v)}</span>`;
  let h = h4("Where the hiring organisation sits") + bcgSvg(c);
  h += `<p class="small muted">Unit assessed: ${esc(c.unit_assessed || "company")}. Quadrant: <b>${esc(String(c.quadrant || "").replace("_", " "))}</b>, market growth ${esc(num(c.market_growth_pct))}% a year, relative share ${esc(num(c.relative_share, 2))}.</p>`;
  h += `<p class="small">This does not add points. It sets how strictly the employer treats any gap between the CV and the job description: a Cash Cow protects a profitable franchise and hires for a close match, a Dog has little to lose and will take a chance.</p>`;
  h += h4("Base strictness by quadrant");
  h += table(["Quadrant", "Base strictness"], ["cash_cow", "star", "question_mark", "dog"].map((q) => [q === c.quadrant ? `<b>${esc(q.replace("_", " "))}</b> <span class="badge ok">this employer</span>` : esc(q.replace("_", " ")), esc(trim(Number(bases[q])))]), [1]);
  h += h4("Hiring buzz adjustment");
  h += `<p class="small">Adjustment <b>${esc(trim(Number(st.buzz) || 0))}</b> (range &minus;0.25 to +0.25)${buzz.summary ? ": " + esc(buzz.summary) : ""}</p>` + evidence(ctx, buzz.evidence, "c2.buzz.evidence");
  h += h4("Worked formula");
  h += `<div class="formula"><p>strictness = clamp(base ${esc(trim(Number(st.base)))} + buzz ${esc(trim(Number(st.buzz) || 0))}, 0.25, 1.25) = ${L("strictness", trim(Number(st.strictness)))}</p>
<p>gamma = ${esc(trim(gammaBase))} + strictness = ${L("gamma", trim(Number(st.gamma)))}</p>
<p>adjusted = 100 &times; (core / 100) ^ gamma = 100 &times; (${L("core", num(Number(ctx.scored.core)))} / 100) ^ ${L("gamma", trim(Number(st.gamma)))} = <span class="eq">${L("adjusted", num(Number(ctx.scored.adjusted)))}</span></p></div>`;
  h += `<p class="small muted">A core of 100 stays 100 in every quadrant. Move the strictness slider under Weights to see another employer's view.</p>`;
  h += h4("Evidence for the quadrant") + evidence(ctx, c.evidence, "c2.evidence");
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
  const all = arr((a.c8 || {}).bullets);
  const scoredB = all.filter((x) => x.section !== "other");
  const n = (l) => scoredB.filter((x) => x.level === l).length;
  const ex = all.length - scoredB.length;
  let h = `<p class="small">${scoredB.length} achievement and experience bullets scored: ${n("full")} full, ${n("partial")} partial, ${n("none")} none.${ex ? ` ${ex} other bullet(s) (skills, certifications, education) are listed but not scored.` : ""}</p>`;
  h += `<div class="legend"><span class="lf">full: situation, action, result</span><span class="lp">partial</span><span class="ln">none</span></div>`;
  h += all.map((x, i) => {
    const p = x.parts || {};
    const chip = (k, l) => `<span class="chip${p[k] ? " on" : ""}" title="${esc(k)}${p[k] ? " found" : " missing"}">${l}</span>`;
    const ok = ctx.verified(x.quote, `c8.bullets[${i}].quote`);
    const lvl = ["full", "partial", "none"].includes(x.level) ? x.level : "none";
    const sec = x.section ? ` <span class="badge">${esc(x.section)}</span>` : "";
    if (x.section === "other") return `<div class="bullet excluded"><div>${esc(x.quote && x.quote.text)}${ok ? "" : ' <span class="badge bad">&#10007; unverified</span>'} <span class="badge">other: not scored</span></div></div>`;
    return `<div class="bullet ${lvl}"><div>${chip("situation", "S")}${chip("action", "A")}${chip("result", "R")} ${esc(x.quote && x.quote.text)}${sec}${ok ? "" : ' <span class="badge bad">&#10007; unverified</span>'}</div></div>`;
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

function c12Detail(ctx, a, sc) {
  const c = a.c12 || {};
  const roles = arr(c.roles);
  const d = sc.detail || {};
  const asOf = a.meta && a.meta.assessed_on;
  const now = parseYM(asOf, new Date().getFullYear() * 12 + new Date().getMonth());
  const total = roles.map((r) => { const s0 = parseYM(r.start, null), e0 = parseYM(r.end, now); return s0 == null ? 0 : Math.max(0, e0 - s0 + 1); });
  const nEmp = roles.map((r) => (Number.isInteger(r.employer_count) && r.employer_count > 1 ? r.employer_count : 1));
  const wu12 = (ctx.scored && ctx.scored.weights_used) || {};
  const oShare = typeof wu12.c12_others_share === "number" ? wu12.c12_others_share : 0.4;
  const others = roles.map((r) => r.has_others === true);
  const months = total.map((m, i) => (others[i] ? m * (1 - oShare) / nEmp[i] : m / nEmp[i]));
  const mLabel = (i) => (others[i]
    ? `${total[i]} &times; ${trim(1 - oShare)} &divide; ${nEmp[i]} = ${trim(months[i])} each; &ldquo;others&rdquo; ${total[i]} &times; ${trim(oShare)} = ${trim(total[i] * oShare)}`
    : nEmp[i] > 1 ? `${total[i]} &divide; ${nEmp[i]} = ${trim(months[i])}` : String(total[i]));
  const counted = new Set(arr(d.role_indexes));
  const ev = c.expected_years || {};
  const expM = Number(d.expected_months) || (Number(ev.value) || 3) * 12;
  const scale = Math.max(expM, ...months, 1);
  let h = `<p class="small">Expected tenure: <b>${esc(trim(expM / 12))} years</b> (${esc(ev.from || "default")}). Median tenure of the counted roles: <b>${esc(trim(Number(d.median_months) || 0))} months</b>. c12 = min(median / (${esc(trim(expM / 12))} &times; 12), 1) &times; 100 = <b>${esc(num(sc.score))}</b>.</p>`;
  h += h4("Role timeline against expected tenure");
  h += `<div class="tl" role="img" aria-label="Tenure of each role in months against the expected ${esc(trim(expM))} months">` +
    roles.map((r, i) => `<div class="tl-row${counted.has(i) ? "" : " ex"}"><span class="tl-name">${esc(r.employer)}</span><span class="tl-track"><i style="width:${(months[i] / scale * 100).toFixed(1)}%"></i><u style="left:${(expM / scale * 100).toFixed(1)}%" title="expected ${esc(trim(expM))} months"></u></span><span class="tl-m">${trim(months[i])} m</span></div>`).join("") +
    `<p class="small muted">The vertical mark is the expected ${esc(trim(expM))} months.</p></div>`;
  h += table(["Employer", "Title", "Dates", "Months", "Counted"], roles.map((r, i) => [`<b>${esc(r.employer)}</b>`, esc(r.title), `${esc(r.start)} to ${esc(r.end || "present")}`, mLabel(i) + (others[i] ? ` <span class="small muted">(${nEmp[i]} named employers share ${trim((1 - oShare) * 100)}%, &ldquo;& others&rdquo; ${trim(oShare * 100)}%)</span>` : nEmp[i] > 1 ? ` <span class="small muted">(${nEmp[i]} employers, split equally)</span>` : ""), counted.has(i) ? '<span class="badge ok">counted</span>' : '<span class="badge">current role: excluded</span>']), [3]);
  h += h4("Expected years") + evidence(ctx, ev.evidence, "c12.expected_years.evidence");
  h += roles.map((r, i) => r.quote ? `<details class="inline"><summary>${esc(r.employer)}</summary>${quoteBlock(ctx, r.quote, "CV", `c12.roles[${i}].quote`)}</details>` : "").join("");
  h += evidence(ctx, c.evidence, "c12.evidence");
  return h;
}

function c13Body(ctx, a) {
  const c = a.c13 || {};
  const roles = arr(c.roles);
  const items = arr((ctx.scored.bonus || {}).items).filter((i) => i.group === "c13");
  let h = `<p class="small">Per consulting role: +3 if the firm is in the top 10 for the hiring company's industry, and +3 more if its work relates to this JD (only for a top-10 firm). Capped at +10.</p>`;
  if (!roles.length) return h + "<p>No consulting roles on the CV.</p>";
  h += table(["Role", "Top 10 for the industry", "Related to the JD"], roles.map((r) => [`<b>${esc(r.employer)}</b>${r.title ? ", " + esc(r.title) : ""}`, r.top_in_industry ? '<span class="badge ok">yes +3</span>' : '<span class="badge">no</span>', r.related_to_jd ? (r.top_in_industry ? '<span class="badge ok">yes +3</span>' : '<span class="badge">yes, but not a top-10 firm: +0</span>') : '<span class="badge">no</span>']));
  if (items.length) h += table(["Item", "Points"], items.map((i) => [esc(i.label), esc((i.points >= 0 ? "+" : "") + trim(i.points))]), [1]);
  h += roles.map((r, i) => `<details class="inline"><summary>${esc(r.employer)}</summary>${quoteBlock(ctx, r.quote, "CV", `c13.roles[${i}].quote`)}${evidence(ctx, r.evidence, `c13.roles[${i}].evidence`)}</details>`).join("");
  return h;
}

function getPath(o, p) {
  return String(p).replace(/\[(\d+)\]/g, ".$1").split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
}
function c14Body(ctx, a) {
  const c14 = ctx.scored.c14;
  if (!c14) return "<p>This report was scored before screening signals existed. Run <code>node bin/score.js</code> again to add them.</p>";
  const sg = (n) => (n >= 0 ? "+" : "") + trim(n);
  let h = `<p class="small">Automated screeners reject many CVs before a person reads them. Each item below is computed by the script from the dates and text, or from the tags the AI recorded. The total is clamped between ${esc(sg(c14.cap_min))} and ${esc(sg(c14.cap_max))}.</p>`;
  const seen = new Set();
  const ev = (it) => arr(it.evidence_paths).filter((p) => !seen.has(it.key + p) && seen.add(it.key + p)).map((p) => {
    const v = getPath(a, p);
    if (!v) return "";
    if (typeof v === "object" && v.text !== undefined) return quoteBlock(ctx, v, "CV", p);
    if (typeof v === "object" && v.text === undefined) return evidence(ctx, v, p);
    return "";
  }).join("");
  const rows = arr(c14.items).map((it) => [
    `<b>${esc(it.label)}</b>`,
    `<span class="${it.points > 0 ? "pos" : it.points < 0 ? "neg" : ""}">${esc(sg(it.points))}</span>`,
    `<span class="small">${esc(it.working)}</span>`,
  ]);
  h += table(["Item", "Points", "Working"], rows, [1]);
  if (c14.total !== c14.raw_total) h += `<p class="small">Items sum to ${esc(sg(c14.raw_total))}, clamped to <b>${esc(sg(c14.total))}</b>.</p>`;
  arr(c14.notes).forEach((n) => (h += `<p class="small muted">Note: ${esc(n)}.</p>`));
  h += h4("Phrases copied from the JD");
  const ph = arr(c14.echo_phrases);
  h += ph.length
    ? `<p class="small">Runs of ${esc(trim(Number(((ctx.scored.weights_used || {}).c14 || {}).echo_words) || 6))} or more consecutive words found in both the CV and the JD (case and punctuation ignored). Screeners may read copied wording as keyword stuffing.</p><ul class="echo">${ph.map((x) => `<li><mark>${esc(x)}</mark> <span class="small muted">(${x.split(" ").length} words)</span></li>`).join("")}</ul>`
    : "<p>No copied phrases found, or the texts were not supplied.</p>";
  h += arr(c14.items).map((it) => { const inner = ev(it); return inner ? `<details class="inline"><summary>Evidence: ${esc(it.label)}</summary>${inner}</details>` : ""; }).join("");
  return h;
}

// ---------- flags banner
function flagsHtml(ctx) {
  const c14 = ctx.scored.c14;
  if (!c14 || !c14.flags) return "";
  const f = c14.flags;
  let h = "";
  if (arr(f.ats_dates).length) {
    h += `<div class="flag"><h3>Date ranges a screening system may not read</h3><p class="small">Many applicant tracking systems split a date range only on a hyphen. These lines use &ldquo;to&rdquo; or a typographic dash, so the role may be read as lasting zero months. Suggested fix on each line.</p><ul>` +
      arr(f.ats_dates).map((x) => `<li><span class="ln">line ${esc(x.line)}</span> ${esc(x.text)}<br>` + arr(x.matches).map((m) => `<span class="fix">${esc(m.found)} &rarr; ${esc(m.fix)}</span>`).join(" ") + `</li>`).join("") + `</ul></div>`;
  }
  if (f.education_blank) h += `<div class="flag"><h3>Education shows no institution</h3><p class="small">No institution was found for the top university check (c9). Some systems reject a CV with a blank education field, so add the institution, degree and year if you have them.</p></div>`;
  h += `<div class="flag"><h3>Application form questions that often reject within a day</h3><p class="small">The CV cannot show these. Check each answer before you submit.</p><ul>${arr(f.form_checklist).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
  return `<section id="flags" class="flags" aria-label="Flags to check before applying"><h2>Check before you apply</h2>${h}</section>`;
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
  const st = ctx.scored.strictness || {};
  const score = na ? "n/a" : sc.modifier ? "\u03b3 " + trim(Number(st.gamma)) : num(sc.score);
  const barPct = na ? 0 : sc.modifier ? Math.max(0, Math.min(100, (Number(st.strictness) || 0) / 1.25 * 100)) : Math.max(0, Math.min(100, Number(sc.score) || 0));
  const metaTxt = sc.modifier ? `<span>strictness <span data-live="strictness">${esc(trim(Number(st.strictness)))}</span>, modifier: not weighted</span>` : `<span data-weight-for="${id}">weight ${esc(trim(Number(sc.weight) || 0))}</span>`;
  const conf = sc.confidence || (ev && ev.confidence);
  return `<details class="card${na ? " na" : ""}" id="card-${id}"><summary>
    <span class="cid">${id}</span><span class="ctitle">${esc(NAMES[id])}</span><span class="cscore">${esc(score)}</span>
    <span class="bar" role="img" aria-label="score ${esc(score)} of 100"><i style="width:${barPct}%"></i></span>
    <span class="cmeta"><span class="chev">&#9656;</span>${na ? '<span class="badge">not applicable: weight dropped, rest renormalised</span>' : metaTxt}${confBadge(conf)}</span>
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
  const st = scored.strictness || {};
  const adjusted = typeof scored.adjusted === "number" ? scored.adjusted : core;
  const live = IDS.map((id) => ({ id, sc: scored.criteria[id] || {} })).filter((x) => !x.sc.not_applicable && typeof x.sc.score === "number");
  const sumW = live.reduce((s, x) => s + (Number(x.sc.weight) || 0), 0);
  const sumWS = live.reduce((s, x) => s + (Number(x.sc.weight) || 0) * x.sc.score, 0);
  const na = IDS.filter((id) => (scored.criteria[id] || {}).not_applicable);
  const bt = scored.bonus || {};
  const bc11 = Number(bt.c11) || 0, bc13 = Number(bt.c13) || 0, bc14 = Number(bt.c14) || 0;
  const sg = (n) => (n >= 0 ? "+" : "") + trim(n);
  const formula = `<div class="formula">
    <p>core = &Sigma;(weight &times; score) / &Sigma;(weight) = ${esc(num(sumWS, 1))} / ${esc(num(sumW, 2))} = <span class="eq">${esc(num(core))}</span></p>
    <p>adjusted = 100 &times; (core / 100) ^ gamma = 100 &times; (${esc(num(core))} / 100) ^ ${esc(trim(Number(st.gamma)))} = <span class="eq">${esc(num(adjusted))}</span> <span class="muted">(${esc(String(st.quadrant || "").replace("_", " "))}, strictness ${esc(trim(Number(st.strictness)))}, c2)</span></p>
    <p>bonus = c11 ${esc(sg(bc11))} + c13 ${esc(sg(bc13))} + c14 ${esc(sg(bc14))} = ${esc(sg(bonusTotal))}</p>
    <p>total = clamp(adjusted + bonus, 0, 100) = clamp(${esc(num(adjusted))} ${bonusTotal < 0 ? "&minus;" : "+"} ${esc(trim(Math.abs(bonusTotal)))}, 0, 100) = <span class="eq">${esc(num(total))}</span></p>
    ${na.length ? `<p class="muted">Not applicable, weight dropped: ${na.join(", ")}</p>` : ""}</div>
    <details class="inline"><summary>Show the arithmetic for each criterion</summary>${table(["Criterion", "Weight", "Score", "Weight x score"],
      IDS.map((id) => { const s = scored.criteria[id] || {}; const n = s.not_applicable; return [`${id} ${esc(NAMES[id])}`, n ? "dropped" : esc(trim(Number(s.weight) || 0)), n ? "n/a" : esc(num(s.score)), n ? "" : esc(num((Number(s.weight) || 0) * s.score, 1))]; }), [1, 2, 3])}
    <p class="small muted">c1 itself is the weighted mean of its six sub-scores, see its card. c2 sets gamma and carries no weight of its own.</p></details>`;

  const bonusItems = arr((scored.bonus || {}).items).filter((i) => i.group === "c11" || !i.group);
  const bonusCard = `<details class="card" id="card-c11"><summary><span class="cid">c11</span><span class="ctitle">Candidate's own access (bonus)</span><span class="cscore">${bc11 >= 0 ? "+" : ""}${esc(trim(bc11))}</span>
    <span class="cmeta"><span class="chev">&#9656;</span><span>self-reported, never inferred by the AI. Added after the strictness adjustment.</span></span></summary><div class="cbody">` +
    (bonusItems.length ? table(["Item", "Points"], bonusItems.map((i) => [esc(i.label), esc((i.points >= 0 ? "+" : "") + trim(i.points))]), [1]) : "<p>No bonus items were reported.</p>") +
    (cand.previously_worked_here && cand.previously_worked_here.note ? `<p class="small">Previously worked here: ${esc(cand.previously_worked_here.note)}</p>` : "") +
    arr(cand.referrals).map((r) => `<p class="small">Referral (${esc(String(r.type).replace(/_/g, " "))}${r.seniority ? ", " + esc(r.seniority) : ""}${r.visibility ? ", " + esc(r.visibility) + " visibility" : ""})${r.note ? ": " + esc(r.note) : ""}</p>`).join("") +
    `</div></details>`;
  const c13sc = scored.criteria.c13 || {};
  const c13Card = `<details class="card" id="card-c13"><summary><span class="cid">c13</span><span class="ctitle">${esc(NAMES.c13)}</span><span class="cscore">${bc13 >= 0 ? "+" : ""}${esc(trim(bc13))}</span>
    <span class="cmeta"><span class="chev">&#9656;</span><span>bonus, capped at +${esc(trim(Number(((scored.weights_used || {}).bonus || {}).c13_cap) || 10))}</span>${confBadge(c13sc.confidence)}</span>
    <span class="working">${esc(c13sc.working || "")}</span></summary><div class="cbody">${c13Body(ctx, a)}</div></details>`;

  const c14sc = scored.criteria.c14 || {};
  const c14Card = scored.c14 ? `<details class="card" id="card-c14"><summary><span class="cid">c14</span><span class="ctitle">${esc(NAMES.c14)}</span><span class="cscore">${bc14 >= 0 ? "+" : ""}${esc(trim(bc14))}</span>
    <span class="cmeta"><span class="chev">&#9656;</span><span>clamped between ${esc(sg(Number(scored.c14.cap_min)))} and ${esc(sg(Number(scored.c14.cap_max)))}, not weighted</span>${confBadge(c14sc.confidence)}</span>
    <span class="working">${esc(c14sc.working || "")}</span></summary><div class="cbody">${c14Body(ctx, a)}</div></details>` : "";
  const cards = ORDER.map((id) => card(ctx, id, { c1: c1Detail, c2: c2Detail, c3: c3Detail, c4: c4Detail, c5: c5Detail, c6: c6Detail, c7: c7Detail, c8: c8Detail, c9: c9Detail, c10: c10Detail, c12: c12Detail }[id], weights)).join("") + bonusCard + c13Card + c14Card;

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
    names: NAMES, keys, weights, total, core, adjusted, bonusTotal, bonusC11: bc11, bonusC13: bc13, bonusC14: bc14,
    strictness: { quadrant: st.quadrant, base: st.base, buzz: st.buzz, value: st.strictness, gamma: st.gamma,
      gammaBase: Number((scored.weights_used || {}).c2_gamma_base) || 0.5, bases: (scored.weights_used || {}).c2_strictness || (d.defaults || {}).c2_strictness || {} },
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
    <div><div class="k">Core</div><div class="v" id="v-core">${esc(num(core))}</div></div>
    <div><div class="k">Adjusted (gamma <span data-live="gamma">${esc(trim(Number(st.gamma)))}</span>)</div><div class="v" id="v-adjusted">${esc(num(adjusted))}</div></div>
    <div><div class="k">c11 access</div><div class="v">${esc(sg(bc11))}</div></div>
    <div><div class="k">c13 consulting</div><div class="v">${esc(sg(bc13))}</div></div>
    <div><div class="k">c14 screening</div><div class="v">${esc(sg(bc14))}</div></div>
    <div><div class="k">Total</div><div class="v" data-live-total>${esc(num(total))}</div></div>
  </div>
  <p class="small muted breakdown">core ${esc(num(core))} &rarr; adjusted ${esc(num(adjusted))} &rarr; c11 ${esc(sg(bc11))}, c13 ${esc(sg(bc13))}, c14 ${esc(sg(bc14))} &rarr; total ${esc(num(total))}</p>
  <div class="banner" id="custom-banner" role="status"></div>
</header>

${flagsHtml(ctx)}

<section id="how"><h2>How this score was calculated</h2>
<p class="lede">Scores are computed by a script from the evidence below. The AI gathers evidence and makes the judgements, it never states a score.</p>${formula}</section>

<section id="weights"><h2>Weights</h2>
<p class="lede">Disagree with the emphasis? Move a slider and the total updates. Nothing is saved or sent anywhere.</p>
<div class="panel"><h3>Core criteria</h3><div class="sliders" id="sl-core"></div><h3>c1 sub-checks</h3><div class="sliders" id="sl-c1"></div><h3>Employer strictness (c2)</h3><div class="sliders" id="sl-c2"></div>
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
function pdfFlags(scored) {
  const c14 = scored.c14;
  if (!c14 || !c14.flags) return [];
  const f = c14.flags, GREY = "#666666", out = [];
  const sgn = (n) => (n >= 0 ? "+" : "") + trim(n);
  out.push({ text: "Check before you apply", fontSize: 13, bold: true, margin: [0, 14, 0, 4] });
  if (arr(f.ats_dates).length) {
    out.push({ text: "Date ranges a screening system may not read (use a hyphen)", bold: true, fontSize: 9.5, margin: [0, 2, 0, 2] });
    out.push({ ul: arr(f.ats_dates).map((x) => `Line ${x.line}: ${x.text}. Suggested: ${arr(x.matches).map((m) => m.fix).join("; ")}`), fontSize: 9 });
  }
  if (f.education_blank) out.push({ text: "Education shows no institution: add the institution, degree and year.", fontSize: 9.5, margin: [0, 4, 0, 2] });
  out.push({ text: "Application form questions that often reject within a day", bold: true, fontSize: 9.5, margin: [0, 4, 0, 2] });
  out.push({ ul: arr(f.form_checklist), fontSize: 9 });
  out.push({ text: "Screening signals (c14) " + sgn(c14.total), bold: true, fontSize: 9.5, margin: [0, 6, 0, 2] });
  out.push({ ul: arr(c14.items).map((it) => `${it.label} ${sgn(it.points)}: ${it.working}`), fontSize: 8, color: GREY });
  if (arr(c14.echo_phrases).length) out.push({ text: "Copied from the JD: " + arr(c14.echo_phrases).map((x) => `"${x}"`).join("; "), fontSize: 8, color: GREY, margin: [0, 2, 0, 0] });
  return out;
}
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
  const stp = scored.strictness || {};
  const adjusted = typeof scored.adjusted === "number" ? scored.adjusted : core;
  const bonusOf = (id) => (id === "c13" ? Number((scored.bonus || {}).c13) || 0 : Number((scored.bonus || {}).c14) || 0);
  const rows = ORDER.concat(["c13"], scored.c14 ? ["c14"] : []).map((id) => {
    const s = scored.criteria[id] || {};
    const mod = id === "c2", bon = id === "c13" || id === "c14";
    return [
      { text: id, bold: true, color: ACC }, { text: NAMES[id], bold: true },
      { text: s.not_applicable ? "n/a" : mod ? "gamma " + trim(Number(stp.gamma)) : bon ? (bonusOf(id) >= 0 ? "+" : "") + trim(bonusOf(id)) : num(s.score), alignment: "right" },
      { text: s.not_applicable ? "dropped" : mod ? "modifier" : bon ? "bonus" : trim(Number(s.weight) || 0), alignment: "right" },
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
          { text: `core ${num(core)}  adjusted ${num(adjusted)}  bonus ${bonus >= 0 ? "+" : ""}${trim(bonus)} (c11 ${trim(Number((scored.bonus || {}).c11) || 0)}, c13 ${trim(Number((scored.bonus || {}).c13) || 0)}, c14 ${trim(Number((scored.bonus || {}).c14) || 0)})`, fontSize: 8.5, color: GREY, alignment: "right" } ] } ] },
      { text: `Core ${num(core)} -> adjusted ${num(adjusted)} (${String(stp.quadrant || "").replace("_", " ")}, gamma ${trim(Number(stp.gamma))}); total = clamp(adjusted + bonus, 0, 100) = clamp(${num(adjusted)} ${bonus < 0 ? "-" : "+"} ${trim(Math.abs(bonus))}, 0, 100) = ${num(total)}`, fontSize: 8.5, color: GREY, margin: [0, 10, 0, 0] },
      ...pdfFlags(scored),
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
