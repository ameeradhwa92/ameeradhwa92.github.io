(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.AIMEER_DEVICE = factory();
  }
}(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var MIN_BUFFER_SIZE = 1500000000;

  var flagshipPattern = /(?:galaxy\s*[sz]\d+\b|galaxy\s*[sz]\b|sm-[szf]\d+|pixel\s+(?:\d+\s*(?:pro|xl)|xl|fold)|oneplus\s+\d+\b|oppo\s+find\s+[xn]\d*\b|vivo\s+x\d+\b|vivo\s+x\s*fold|honor\s+magic\b|xiaomi\s+\d+\s+(?:ultra|pro\s+max)\b|huawei\s+(?:pura|mate)\b|asus\s+(?:rog|zenfone)\b|sony\s+xperia\s+1\b|redmagic\b)/i;

  var midRangePattern = /(?:galaxy\s+[amf]\d+\b|sm-[amf]\d+|pixel\s+[a-z]\b)/i;

  function evaluate(options) {
    options = options || {};
    var userAgent = String(options.userAgent || "");
    var platform = String(options.platform || "");
    var touchPoints = Number(options.maxTouchPoints || 0);
    var isIOS = /iPad|iPhone|iPod/i.test(userAgent) ||
      (/Mac/i.test(platform) && touchPoints > 1);
    var isAndroid = /Android/i.test(userAgent);
    var isDesktop = !isIOS && !isAndroid;
    var androidTier = !isAndroid ? null : (
      flagshipPattern.test(userAgent) ? "flagship" :
      midRangePattern.test(userAgent) ? "mid" : "unknown"
    );
    var hasWebGPU = options.hasWebGPU === true;
    var enoughBuffer = Number(options.maxBufferSize || 0) >= MIN_BUFFER_SIZE;
    var hardwareEligible = hasWebGPU && enoughBuffer;
    var localEligible = !isIOS && hardwareEligible &&
      (!isAndroid || androidTier === "flagship");
    var cloudPreferred = Boolean(options.saveData) || !localEligible;
    var reason;

    if (isIOS) reason = "ios-cloud-only";
    else if (options.saveData) reason = "save-data";
    else if (!hasWebGPU) reason = "webgpu-unavailable";
    else if (!enoughBuffer) reason = "insufficient-buffer";
    else if (isAndroid && androidTier !== "flagship") reason = "android-not-flagship";
    else reason = "local-eligible";

    return {
      isIOS: isIOS,
      isAndroid: isAndroid,
      isDesktop: isDesktop,
      androidTier: androidTier,
      localEligible: localEligible,
      cloudPreferred: cloudPreferred,
      reason: reason
    };
  }

  return { evaluate: evaluate };
}));
