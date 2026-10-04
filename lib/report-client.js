(function () {
  "use strict";
  var D = JSON.parse(document.getElementById("report-data").textContent);
  var NAMES = D.names;
  var IDS = ["c1", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c12"];
  var SUBS = ["title", "headline", "same_industry", "competitor", "supplier", "top_firm"];
  var ST = D.strictness || {};
  var $ = function (id) { return document.getElementById(id); };
  var round1 = function (n) { return Math.round(n * 10) / 10; };

  // ---- fallback combine (used only if the embedded lib/scoring.js is absent or disagrees with scored.json)
  function fallbackCombine(scores, coreW, c1Sub, c1SubW, bonus, gamma) {
    var sub = 0, sw = 0;
    SUBS.forEach(function (k) {
      var w = Number(c1SubW[k]); if (!isFinite(w)) w = 1;
      if (c1Sub[k] != null) { sub += w * c1Sub[k]; sw += w; }
    });
    var c1 = sw > 0 ? sub / sw : 0;
    var num = 0, den = 0;
    IDS.forEach(function (id) {
      var s = id === "c1" ? c1 : scores[id];
      var w = Number(coreW[D.keys[id]]);
      if (s == null || !isFinite(w)) return;
      num += w * s; den += w;
    });
    var core = den > 0 ? num / den : 0;
    var g = isFinite(gamma) ? gamma : 1;
    var adjusted = 100 * Math.pow(Math.min(100, Math.max(0, core)) / 100, g);
    return { core: core, adjusted: adjusted, total: Math.min(100, Math.max(0, adjusted + bonus)) };
  }

  function normalise(r) {
    if (typeof r === "number") return { total: r, core: r - D.bonusTotal, adjusted: r - D.bonusTotal };
    if (r && typeof r === "object") {
      var total = r.total;
      if (total != null && isFinite(total)) return { total: total, core: r.core, adjusted: r.adjusted != null ? r.adjusted : r.core };
    }
    return null;
  }

  var scoring = window.__scoring || {};
  var embeddedFns = [];
  if (typeof scoring.combine === "function") {
    // the signature is combine(criteriaScores, coreWeights, c1Sub, c1Subweights, bonusTotal, gamma);
    // criteriaScores may be keyed by c1.. or by config key: pick whichever reproduces scored.json.
    embeddedFns.push(function (s, w, a, b, c, g) { return scoring.combine(s, w, a, b, c, g); });
    embeddedFns.push(function (s, w, a, b, c, g) {
      var k = {}; IDS.forEach(function (id) { k[D.keys[id]] = s[id]; });
      return scoring.combine(k, w, a, b, c, g);
    });
  }
  var combineImpl = fallbackCombine, source = "fallback (inline)";
  for (var i = 0; i < embeddedFns.length; i++) {
    try {
      var r = normalise(embeddedFns[i](scoreMap(), clone(D.weights.core), clone(D.criteria.c1.sub || {}), clone(D.weights.c1_subweights), D.bonusTotal, ST.gamma));
      if (r && Math.abs(r.total - D.total) < 0.06) {
        (function (fn) { combineImpl = fn; })(embeddedFns[i]); source = "lib/scoring.js"; break;
      }
    } catch (e) { /* try next */ }
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function scoreMap() {
    var m = {};
    IDS.forEach(function (id) { var c = D.criteria[id]; m[id] = c && !c.na && c.score != null ? c.score : null; });
    return m;
  }
  function combine(w, sw, gamma) {
    var raw = combineImpl(scoreMap(), clone(w), clone(D.criteria.c1.sub || {}), clone(sw), D.bonusTotal, gamma);
    var r = normalise(raw);
    return r || fallbackCombine(scoreMap(), w, D.criteria.c1.sub || {}, sw, D.bonusTotal, gamma);
  }
  var src = $("calc-source"); if (src) src.textContent = "Live total computed with " + source + ".";

  // ---- state
  var W = clone(D.weights.core), SW = clone(D.weights.c1_subweights), STRICT = ST.value;
  function gammaOf(v) { return ST.gammaBase + v; }
  var gauge = $("ring-fg"), CIRC = 2 * Math.PI * 80;

  function band(t) { return t >= 75 ? "Strong" : t >= 60 ? "Competitive" : t >= 45 ? "Stretch" : "Long shot"; }

  function render() {
    var r = combine(W, SW, gammaOf(STRICT));
    var total = round1(r.total);
    $("gauge-num").textContent = total.toFixed(1);
    gauge.setAttribute("stroke-dasharray", (CIRC * Math.max(0, Math.min(100, total)) / 100).toFixed(1) + " " + CIRC.toFixed(1));
    $("band").textContent = band(total);
    $("v-core").textContent = round1(r.core).toFixed(1);
    $("v-adjusted").textContent = round1(r.adjusted).toFixed(1);
    var live = { core: round1(r.core).toFixed(1), adjusted: round1(r.adjusted).toFixed(1), strictness: trim(STRICT), gamma: trim(gammaOf(STRICT)) };
    document.querySelectorAll("[data-live]").forEach(function (e) { var v = live[e.getAttribute("data-live")]; if (v !== undefined) e.textContent = v; });
    var changed = JSON.stringify(W) !== JSON.stringify(D.weights.core) || JSON.stringify(SW) !== JSON.stringify(D.weights.c1_subweights) || Math.abs(STRICT - ST.value) > 1e-9;
    var b = $("custom-banner");
    b.classList.toggle("on", changed);
    b.textContent = changed ? "Custom weights: total " + total.toFixed(1) + " (as scored: " + round1(D.total).toFixed(1) + "). The evidence and criterion scores below are unchanged." : "";
    var tw = 0; IDS.forEach(function (id) { var c = D.criteria[id]; if (!c.na) tw += Number(W[D.keys[id]]) || 0; });
    IDS.forEach(function (id) {
      var el = document.querySelector('[data-weight-for="' + id + '"]');
      var c = D.criteria[id];
      if (!el || c.na) return;
      var w = Number(W[D.keys[id]]) || 0;
      el.textContent = "weight " + trim(w) + " (" + (tw ? (100 * w / tw).toFixed(1) : "0") + "% of core)";
    });
    document.querySelectorAll("[data-live-total]").forEach(function (e) { e.textContent = total.toFixed(1); });
  }
  function trim(n) { return String(Math.round(n * 100) / 100); }

  function slider(host, label, key, isCore, min, max, step) {
    var store = isCore ? W : SW;
    var wrap = document.createElement("div"); wrap.className = "sl";
    var lab = document.createElement("label");
    var t = document.createElement("span"); t.textContent = label;
    var out = document.createElement("output"); out.textContent = trim(store[key]);
    lab.appendChild(t); lab.appendChild(out);
    var inp = document.createElement("input");
    inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = store[key];
    inp.setAttribute("aria-label", label);
    inp.addEventListener("input", function () { (isCore ? W : SW)[key] = Number(inp.value); out.textContent = trim(Number(inp.value)); render(); });
    wrap.appendChild(lab); wrap.appendChild(inp); host.appendChild(wrap);
    return { input: inp, out: out, key: key, isCore: isCore };
  }
  var controls = [];
  IDS.forEach(function (id) {
    var c = D.criteria[id];
    controls.push(slider($("sl-core"), id + " " + NAMES[id] + (c.na ? " (n/a)" : ""), D.keys[id], true, 0, 100, 0.5));
  });
  SUBS.forEach(function (k) { controls.push(slider($("sl-c1"), k.replace(/_/g, " "), k, false, 0, 5, 0.25)); });

  // strictness slider (c2): strictness 0.25 to 1.25, gamma = gamma base + strictness
  var sIn, sOut;
  (function () {
    var wrap = document.createElement("div"); wrap.className = "sl";
    var lab = document.createElement("label");
    var t = document.createElement("span"); t.textContent = "Strictness (" + String(ST.quadrant || "").replace(/_/g, " ") + " base " + trim(ST.base) + ", buzz " + trim(ST.buzz || 0) + ")";
    sOut = document.createElement("output");
    lab.appendChild(t); lab.appendChild(sOut);
    sIn = document.createElement("input");
    sIn.type = "range"; sIn.min = 0.25; sIn.max = 1.25; sIn.step = 0.05; sIn.value = STRICT;
    sIn.setAttribute("aria-label", "Employer strictness");
    function show() { sOut.textContent = trim(STRICT) + " (gamma " + trim(gammaOf(STRICT)) + ")"; }
    sIn.addEventListener("input", function () { STRICT = Number(sIn.value); show(); render(); });
    sIn._show = show; show();
    wrap.appendChild(lab); wrap.appendChild(sIn); $("sl-c2").appendChild(wrap);
  })();

  $("reset").addEventListener("click", function () {
    W = clone(D.weights.core); SW = clone(D.weights.c1_subweights); STRICT = ST.value; sIn.value = STRICT; sIn._show();
    controls.forEach(function (c) { var v = (c.isCore ? W : SW)[c.key]; c.input.value = v; c.out.textContent = trim(v); });
    render();
  });
  $("copy").addEventListener("click", function () {
    // c2_strictness holds base values; the slider sets the final strictness, so the base is the slider value minus the buzz adjustment.
    var bases = clone(ST.bases || {}); if (ST.quadrant) bases[ST.quadrant] = Math.round((STRICT - (ST.buzz || 0)) * 100) / 100;
    var snippet = JSON.stringify({ core: W, c1_subweights: SW, c2_strictness: bases }, null, 2);
    var done = function (ok) { var m = $("copied"); m.textContent = ok ? "Copied. Save as config/weights.local.json" : "Copy failed: select the text below"; };
    var box = $("snippet"); box.textContent = snippet; box.hidden = false;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(snippet).then(function () { done(true); }, function () { done(false); });
    else { try { var rg = document.createRange(); rg.selectNodeContents(box); var s = getSelection(); s.removeAllRanges(); s.addRange(rg); done(document.execCommand("copy")); } catch (e) { done(false); } }
  });

  // print: open every card, then restore
  var opened = [];
  window.addEventListener("beforeprint", function () {
    opened = [];
    document.querySelectorAll("details").forEach(function (d) { if (!d.open) { d.open = true; opened.push(d); } });
  });
  window.addEventListener("afterprint", function () { opened.forEach(function (d) { d.open = false; }); });

  // follow footnote links into collapsed cards
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a.fn");
    if (!a) return;
    var t = document.getElementById(a.getAttribute("href").slice(1));
    if (t) { setTimeout(function () { t.scrollIntoView({ behavior: "smooth", block: "center" }); }, 0); }
  });

  render();
})();
