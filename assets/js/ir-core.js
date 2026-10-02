/* RetailAIM IR showcase — the pure half. No DOM, no three.js: the rules the
   interactive demos in ir-showcase.js run on, kept here so node:test can
   require() them. Mirrors the shape of the real product's workflows (product
   survey capture, recognition compliance against hurdle rates, final-appeal
   verdicts) on sample data only; nothing here talks to a server. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IR_CORE = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---- capture: barcode + pack size ---- */

  var DIM_MIN = 1;    /* cm — anything smaller is a typo, not a product */
  var DIM_MAX = 60;   /* cm — the demo pack stays a shelf item */

  /* GS1 check digit for EAN-8, UPC-A (12) and EAN-13: weights 3,1 from the right. */
  function isValidGtin(code) {
    var digits = String(code == null ? "" : code).replace(/\s+/g, "");
    if (!/^\d+$/.test(digits)) return false;
    if (digits.length !== 8 && digits.length !== 12 && digits.length !== 13) return false;
    var sum = 0;
    for (var i = digits.length - 2, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
      sum += Number(digits[i]) * w;
    }
    return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
  }

  /* Field input → centimetres. Accepts "12.5" and the Malay decimal comma "12,5";
     returns null for anything that is not a usable size. */
  function parseCm(value) {
    var text = String(value == null ? "" : value).trim().replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(text)) return null;
    var n = Number(text);
    if (!isFinite(n) || n < DIM_MIN || n > DIM_MAX) return null;
    return Math.round(n * 10) / 10;
  }

  /* World-space box size for the 3D pack. The longest side always maps to `fit`
     so the pack never leaves its frame; depth follows width, as a carton does. */
  function packSize(widthCm, heightCm, fit) {
    var w = parseCm(widthCm), h = parseCm(heightCm);
    var span = typeof fit === "number" && fit > 0 ? fit : 2;
    if (w == null || h == null) return null;
    var d = Math.max(DIM_MIN, Math.round(w * 0.42 * 10) / 10);
    var longest = Math.max(w, h, d);
    return {
      x: (w / longest) * span,
      y: (h / longest) * span,
      z: (d / longest) * span,
      depthCm: d
    };
  }

  /* A survey item is complete when every captured field is valid. */
  function surveyStatus(item) {
    var ok = isValidGtin(item && item.barcode) && parseCm(item && item.width) != null && parseCm(item && item.height) != null;
    return ok ? "completed" : "incomplete";
  }

  /* ---- recognise: compliance against a hurdle rate ---- */

  /* Share of expected SKUs found on the shelf, judged against the client's hurdle. */
  function compliance(found, expected, hurdlePct) {
    if (!(expected > 0)) return { pct: 0, pass: false, gap: hurdlePct || 0 };
    var pct = Math.round(Math.max(0, Math.min(found, expected)) / expected * 1000) / 10;
    var hurdle = typeof hurdlePct === "number" ? hurdlePct : 0;
    return { pct: pct, pass: pct >= hurdle, gap: Math.round((hurdle - pct) * 10) / 10 };
  }

  /* ---- resolve: final-appeal verdicts ---- */

  var BULK_MAX = 200; /* the hub's multi-select ceiling, one transaction */
  var VERDICTS = { approve: true, reject: true };

  /* Toggle an id in a selection without ever exceeding the bulk ceiling.
     Returns a new array; the input is not mutated. */
  function toggleSelection(selected, id, max) {
    var limit = typeof max === "number" ? max : BULK_MAX;
    var list = (selected || []).slice();
    var at = list.indexOf(id);
    if (at >= 0) { list.splice(at, 1); return list; }
    if (list.length >= limit) return list;
    list.push(id);
    return list;
  }

  /* Apply one verdict to every selected appeal line still pending. Lines that
     already carry a verdict keep it: a judged line is not re-judged by a bulk action. */
  function applyVerdict(lines, ids, verdict) {
    if (!VERDICTS[verdict]) throw new Error("unknown verdict: " + verdict);
    var pick = {};
    (ids || []).forEach(function (id) { pick[id] = true; });
    return (lines || []).map(function (line) {
      if (!pick[line.id] || line.verdict) return line;
      var next = {};
      for (var k in line) if (Object.prototype.hasOwnProperty.call(line, k)) next[k] = line[k];
      next.verdict = verdict;
      return next;
    });
  }

  /* KPI tiles after verdicts. Each appeal line names the KPI it contests and the
     points approving it restores; rejected and pending lines change nothing. */
  function kpisAfter(baseline, lines) {
    var out = {};
    Object.keys(baseline || {}).forEach(function (k) { out[k] = baseline[k]; });
    (lines || []).forEach(function (line) {
      if (line.verdict !== "approve" || !(line.kpi in out)) return;
      out[line.kpi] = Math.min(100, Math.round((out[line.kpi] + (line.restores || 0)) * 10) / 10);
    });
    return out;
  }

  function tally(lines) {
    var t = { pending: 0, approve: 0, reject: 0 };
    (lines || []).forEach(function (line) { t[line.verdict || "pending"] += 1; });
    return t;
  }

  return {
    DIM_MIN: DIM_MIN,
    DIM_MAX: DIM_MAX,
    BULK_MAX: BULK_MAX,
    isValidGtin: isValidGtin,
    parseCm: parseCm,
    packSize: packSize,
    surveyStatus: surveyStatus,
    compliance: compliance,
    toggleSelection: toggleSelection,
    applyVerdict: applyVerdict,
    kpisAfter: kpisAfter,
    tally: tally
  };
});
