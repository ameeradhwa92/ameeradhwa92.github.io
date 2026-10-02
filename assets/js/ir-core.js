/* RetailAIM IR showcase — the pure half. No DOM, no three.js: the sizing rules
   the product-survey pack in ir-showcase.js runs on, kept here so node:test can
   require() them. Sample data only; nothing here talks to a server. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IR_CORE = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DIM_MIN = 1;    /* cm — anything smaller is a typo, not a product */
  var DIM_MAX = 60;   /* cm — the demo pack stays a shelf item */

  /* Sample packs the survey demo cycles through: width × height in cm. */
  var SAMPLE_PACKS = [[8, 20], [14, 9], [6, 14.5], [11, 26], [18, 12]];

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

  /* Index of the pack after `i`, wrapping round the sample list. */
  function nextPack(i) {
    var n = SAMPLE_PACKS.length;
    var k = Math.floor(Number(i));
    if (!isFinite(k)) return 0;
    return ((k + 1) % n + n) % n;
  }

  return {
    DIM_MIN: DIM_MIN,
    DIM_MAX: DIM_MAX,
    SAMPLE_PACKS: SAMPLE_PACKS,
    parseCm: parseCm,
    packSize: packSize,
    nextPack: nextPack
  };
});
