/* Route globe — the pure half: geometry, camera choreography, coastline
   decoding, the capability gate and the load state machine. No DOM, no
   three.js; assets/js/route-globe.js is the adapter that owns those and calls
   in here for every decision. UMD so tests/route-globe-core.test.js can
   require() it directly, the same way aimeer-device.js is tested. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ROUTE_GLOBE_CORE = factory();
  }
}(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var DEG = Math.PI / 180;
  var KINDS = { place: true, remote: true, region: true, footprint: true };
  /* Camera distance from the globe centre (radius 1) per stop kind, unless the
     stop carries its own data-zoom. A region is a pull-back framing, not a
     marker. */
  var DEFAULT_ZOOM = { place: 1.1, remote: 1.1, region: 2.6 };
  /* Share of each scroll segment spent holding still at either end, so every
     stop is readable before the camera leaves it. */
  var DWELL = 0.28;
  var MARKER_RADIUS_PER_UNIT = 0.0045; /* ≈1.3% of the stage width at any zoom */
  var STATES = {
    idle: { "gate-fail": "gated-off", "enter-viewport": "pending" },
    pending: { "load-success": "ready", "load-fail": "error" },
    ready: { "context-lost": "error" },
    "gated-off": {},
    error: {}
  };

  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
  function smooth(t) { return t * t * (3 - 2 * t); }

  /* ---- sphere geometry (radius 1, Y up, lng 0 faces +Z) ---- */
  function latLngToVector(lat, lng, radius) {
    var r = radius == null ? 1 : radius;
    var la = lat * DEG, lo = lng * DEG, c = Math.cos(la);
    return { x: r * c * Math.sin(lo), y: r * Math.sin(la), z: r * c * Math.cos(lo) };
  }
  function length(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
  function scale(v, s) { return { x: v.x * s, y: v.y * s, z: v.z * s }; }
  function normalize(v) {
    var l = length(v);
    return l > 0 ? scale(v, 1 / l) : { x: 0, y: 0, z: 1 };
  }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function cross(a, b) {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  }
  function angleBetween(a, b) { return Math.acos(clamp(dot(a, b), -1, 1)); }

  /* Spherical interpolation between two unit vectors. Nearly-coincident inputs
     short-circuit (the Dungun stops share one coordinate) and antipodal inputs
     pick a stable detour instead of dividing by zero. */
  function slerp(a, b, t) {
    var omega = angleBetween(a, b);
    if (omega < 1e-6) return { x: a.x, y: a.y, z: a.z };
    if (Math.PI - omega < 1e-6) {
      var axis = normalize(cross(a, Math.abs(a.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }));
      var mid = normalize(cross(axis, a));
      return t < 0.5 ? slerp(a, mid, t * 2) : slerp(mid, b, (t - 0.5) * 2);
    }
    var s = Math.sin(omega);
    var wa = Math.sin((1 - t) * omega) / s, wb = Math.sin(t * omega) / s;
    return { x: a.x * wa + b.x * wb, y: a.y * wa + b.y * wb, z: a.z * wa + b.z * wb };
  }

  /* Points along the great circle from a to b. arcHeight bows the path
     outward (0.15 = 15% of the radius at the apex) for the flight-path look. */
  function greatCircleArc(a, b, options) {
    options = options || {};
    var segments = Math.max(1, options.segments | 0 || 32);
    var radius = options.radius == null ? 1 : options.radius;
    var arcHeight = options.arcHeight || 0;
    var ua = normalize(a), ub = normalize(b), points = [];
    for (var i = 0; i <= segments; i++) {
      var t = i / segments;
      points.push(scale(slerp(ua, ub, t), radius * (1 + arcHeight * Math.sin(Math.PI * t))));
    }
    return points;
  }

  /* ---- stops ---- */
  function parseStops(raw) {
    var stops = [], warnings = [];
    (raw || []).forEach(function (item, index) {
      var lat = Number(item && item.lat), lng = Number(item && item.lng);
      if (!isFinite(lat) || lat < -90 || lat > 90 || !isFinite(lng) || lng < -180 || lng > 180) {
        warnings.push("stop " + index + ": invalid coordinates");
        return;
      }
      var kind = item.kind && KINDS[item.kind] ? item.kind : "place";
      var zoom = null; /* footprints are arc targets, never a camera framing */
      if (kind !== "footprint") {
        zoom = Number(item.zoom);
        if (item.zoom != null && !(zoom > 1)) warnings.push("stop " + index + ": zoom must exceed 1, using default");
        zoom = zoom > 1 ? zoom : DEFAULT_ZOOM[kind];
      }
      stops.push({
        index: index, lat: lat, lng: lng, kind: kind, zoom: zoom,
        key: item.key == null ? String(index) : String(item.key)
      });
    });
    return { stops: stops, warnings: warnings };
  }

  /* Keyframable stops drive the camera in DOM order; footprints are the
     reveal's arc targets. Each footprint flies out of the nearest preceding
     place/remote stop (originIndex is into the keyframable list). */
  function buildTimeline(stops) {
    var keyframable = [], footprints = [], warnings = [];
    var lastOrigin = -1;
    stops.forEach(function (stop) {
      if (stop.kind === "footprint") {
        if (lastOrigin < 0) { warnings.push("footprint " + stop.key + " has no origin stop"); return; }
        footprints.push({ stop: stop, originIndex: lastOrigin });
        return;
      }
      keyframable.push(stop);
      if (stop.kind !== "region") lastOrigin = keyframable.length - 1;
    });
    return { keyframable: keyframable, footprints: footprints, warnings: warnings };
  }

  function buildCameraKeyframes(keyframable) {
    return keyframable.map(function (stop, i) {
      return { index: i, kind: stop.kind, key: stop.key, lat: stop.lat, lng: stop.lng,
               dir: latLngToVector(stop.lat, stop.lng, 1), distance: stop.zoom };
    });
  }

  /* ---- scroll → camera ---- */
  function segmentFor(fraction, count) {
    if (!(count > 1)) return { from: 0, to: 0, local: 0, travel: 0 };
    var s = clamp(Number(fraction) || 0, 0, 1) * (count - 1);
    var from = Math.min(Math.floor(s), count - 2);
    var local = s - from;
    var travel = local <= DWELL ? 0 : local >= 1 - DWELL ? 1 : smooth((local - DWELL) / (1 - 2 * DWELL));
    return { from: from, to: from + 1, local: local, travel: travel };
  }

  function resolvePose(fraction, keyframes) {
    if (!keyframes || !keyframes.length) {
      return { activeIndex: 0, from: 0, to: 0, travel: 0, direction: { x: 0, y: 0, z: 1 },
               distance: DEFAULT_ZOOM.region, position: { x: 0, y: 0, z: DEFAULT_ZOOM.region } };
    }
    var seg = segmentFor(fraction, keyframes.length);
    var a = keyframes[seg.from], b = keyframes[seg.to];
    var dir = slerp(a.dir, b.dir, seg.travel);
    /* A gentle hop on long flights: pull out a little mid-way so the route
       reads as travel rather than a pan. */
    var hop = Math.min(angleBetween(a.dir, b.dir) * 0.6, 0.35);
    var distance = a.distance + (b.distance - a.distance) * seg.travel + hop * Math.sin(Math.PI * seg.travel);
    return {
      activeIndex: seg.travel < 0.5 ? seg.from : seg.to,
      from: seg.from, to: seg.to, travel: seg.travel,
      direction: dir, distance: distance, position: scale(dir, distance)
    };
  }

  /* 0..1 opacity for the footprint arcs: they fade in during the final
     segment's travel and are fully shown at rest on the last keyframe. */
  function footprintReveal(fraction, keyframes) {
    var n = keyframes ? keyframes.length : 0;
    if (n < 2) return 1;
    var seg = segmentFor(fraction, n);
    return seg.from < n - 2 ? 0 : seg.travel;
  }

  /* Segments travelled so far as a float, e.g. 2.5 = half-way from stop 2 to 3. */
  function routeProgress(fraction, keyframes) {
    var n = keyframes ? keyframes.length : 0;
    if (n < 2) return 0;
    var seg = segmentFor(fraction, n);
    return seg.from + seg.travel;
  }

  /* The travelled route as one polyline. Segments touching a region keyframe
     contribute no points: the pull-back is a camera move, not a journey. */
  function buildRoutePath(keyframes, options) {
    options = options || {};
    var samples = Math.max(1, options.samples | 0 || 24);
    var radius = options.radius == null ? 1.004 : options.radius;
    var positions = [], segmentSamples = [];
    for (var i = 0; i + 1 < keyframes.length; i++) {
      var a = keyframes[i], b = keyframes[i + 1];
      if (a.kind === "region" || b.kind === "region") { segmentSamples.push(0); continue; }
      var arcHeight = Math.min(angleBetween(a.dir, b.dir) * 0.25, 0.08);
      var pts = greatCircleArc(a.dir, b.dir, { segments: samples, radius: radius, arcHeight: arcHeight });
      for (var j = i === 0 ? 0 : 1; j < pts.length; j++) positions.push(pts[j].x, pts[j].y, pts[j].z);
      segmentSamples.push(i === 0 ? pts.length : pts.length - 1);
    }
    return { positions: new Float32Array(positions), segmentSamples: segmentSamples };
  }

  /* How many route vertices to draw for a given routeProgress(). */
  function routeDrawCount(progress, segmentSamples) {
    var count = 0, p = Math.max(0, Number(progress) || 0);
    for (var i = 0; i < segmentSamples.length; i++) {
      if (p >= i + 1) { count += segmentSamples[i]; continue; }
      if (p > i) count += Math.round((p - i) * segmentSamples[i]);
      break;
    }
    return count;
  }

  /* ---- drag, drift, markers ---- */
  function applyOrbitOffset(dir, yaw, pitch) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var d = { x: dir.x * cy + dir.z * sy, y: dir.y, z: -dir.x * sy + dir.z * cy };
    if (!pitch) return normalize(d);
    var k = normalize(cross({ x: 0, y: 1, z: 0 }, d));
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var kd = dot(k, d), kxd = cross(k, d);
    return normalize({
      x: d.x * cp + kxd.x * sp + k.x * kd * (1 - cp),
      y: d.y * cp + kxd.y * sp + k.y * kd * (1 - cp),
      z: d.z * cp + kxd.z * sp + k.z * kd * (1 - cp)
    });
  }

  function decayOffset(offset, factor) {
    var f = factor == null ? 0.88 : factor;
    var yaw = offset.yaw * f, pitch = offset.pitch * f;
    return { yaw: Math.abs(yaw) < 1e-4 ? 0 : yaw, pitch: Math.abs(pitch) < 1e-4 ? 0 : pitch };
  }

  /* A slow breathing sway while the globe idles on screen. */
  function idleDriftOffset(elapsedMs) {
    var t = Math.max(0, Number(elapsedMs) || 0);
    return { yaw: 0.05 * Math.sin(t / 5200 * Math.PI * 2), pitch: 0.018 * Math.sin(t / 7900 * Math.PI * 2) };
  }

  /* Marker radius that stays a near-constant size on screen as the camera zooms. */
  function markerRadius(distance) {
    return clamp((distance - 1) * MARKER_RADIUS_PER_UNIT, 0.0004, 0.03);
  }

  /* ---- framing: the limb must be in frame at every stop ---- */
  /* True when at least one edge of the sphere's silhouette lies inside the
     frame. The sphere subtends asin(1/distance); a view offset of a fraction
     of the frame moves the centre by atan(2 * offset * tan(halfFov)), so the
     near limb sits at (theta - offsetAngle) from the frame centre. marginDeg
     demands that much clearance from the frame edge. */
  function limbInFrame(distance, fovDeg, aspect, offsetX, offsetY, marginDeg) {
    if (!(distance > 1) || !(fovDeg > 0) || !(aspect > 0)) return false;
    var margin = (Number(marginDeg) || 0) * DEG;
    var theta = Math.asin(1 / distance);
    var halfV = fovDeg * DEG / 2;
    var halfH = Math.atan(Math.tan(halfV) * aspect);
    var ax = Math.atan(2 * Math.abs(Number(offsetX) || 0) * Math.tan(halfH));
    var ay = Math.atan(2 * Math.abs(Number(offsetY) || 0) * Math.tan(halfV));
    return theta - ax < halfH - margin || theta - ay < halfV - margin;
  }

  /* Wide (landscape) frames push the globe right so its left limb and
     atmosphere stay on screen beside the caption rail; the push relaxes as the
     camera pulls back so the final reveal shows the whole sphere. Narrow or
     portrait frames widen the FOV and lift the globe so the caption sits
     beneath it. Values are tuned so limbInFrame holds with a 2° margin for
     every distance in [1.5, 3.2] and aspect in [0.45, 2.4]. */
  function framing(distance, aspect, layout) {
    var a = aspect > 0 ? aspect : 1;
    if (layout === "narrow" || a < 1.05) return { fov: 66, offsetX: 0, offsetY: -0.16 };
    var t = clamp(1.7 - a, -0.7, 0.65);
    var relax = Math.pow(1.7 / Math.max(Number(distance) || 1.7, 1.7), 1.5);
    return {
      fov: clamp(38 + t * 22, 38, 60),
      offsetX: clamp(0.22 + t * 0.12, 0.14, 0.30) * relax,
      offsetY: 0.02
    };
  }

  /* ---- layout ---- */
  function scrollFraction(trackTop, trackHeight, stageHeight, stickyTop) {
    var travel = trackHeight - stageHeight;
    if (!(travel > 0)) return 0;
    return clamp((stickyTop - trackTop) / travel, 0, 1);
  }

  function trackHeight(stageHeight, keyframeCount, viewportHeight, segmentShare) {
    var share = segmentShare == null ? 0.42 : segmentShare;
    return Math.round(stageHeight + Math.max(0, keyframeCount - 1) * viewportHeight * share);
  }

  function capDevicePixelRatio(dpr, max) {
    return clamp(Number(dpr) || 1, 1, max == null ? 2 : max);
  }

  /* ---- theme ---- */
  /* Accepts "#3ecfbb", "#3cb", "62, 207, 187" (the --teal-rgb form) and
     rgb()/rgba(); returns {r,g,b} in 0..1 or null. */
  function parseCssColor(value) {
    var s = String(value == null ? "" : value).trim();
    var m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      var hex = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
      return { r: parseInt(hex.slice(0, 2), 16) / 255, g: parseInt(hex.slice(2, 4), 16) / 255, b: parseInt(hex.slice(4, 6), 16) / 255 };
    }
    m = s.match(/^(?:rgba?\()?\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
    if (m) {
      var r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
      if (r > 255 || g > 255 || b > 255) return null;
      return { r: r / 255, g: g / 255, b: b / 255 };
    }
    return null;
  }

  /* ---- coastline data → line segment positions ---- */
  function buildLinePositions(data, radius) {
    if (!data || !Array.isArray(data.runs) || !Array.isArray(data.points) || !(data.scale > 0)) {
      throw new Error("route-globe: malformed coastline data");
    }
    var total = data.runs.reduce(function (n, r) { return n + r; }, 0);
    if (total * 2 !== data.points.length) throw new Error("route-globe: coastline runs do not match points");
    var r = radius == null ? 1 : radius, inv = 1 / data.scale;
    var segments = data.runs.reduce(function (n, len) { return n + Math.max(0, len - 1); }, 0);
    var out = new Float32Array(segments * 6), o = 0, p = 0;
    data.runs.forEach(function (len) {
      var prev = null;
      for (var i = 0; i < len; i++, p += 2) {
        var v = latLngToVector(data.points[p + 1] * inv, data.points[p] * inv, r);
        if (prev) { out[o++] = prev.x; out[o++] = prev.y; out[o++] = prev.z; out[o++] = v.x; out[o++] = v.y; out[o++] = v.z; }
        prev = v;
      }
    });
    return out;
  }

  /* Meridians and parallels every stepDeg, as line segments. */
  function graticulePositions(stepDeg, radius) {
    var step = stepDeg > 0 ? stepDeg : 15, r = radius == null ? 1 : radius, out = [];
    var i, j, a, b;
    for (i = -180; i < 180; i += step) {
      for (j = -90; j < 90; j += 5) {
        a = latLngToVector(j, i, r); b = latLngToVector(j + 5, i, r);
        out.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    for (i = -90 + step; i < 90; i += step) {
      for (j = -180; j < 180; j += 5) {
        a = latLngToVector(i, j, r); b = latLngToVector(i, j + 5, r);
        out.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    return new Float32Array(out);
  }

  /* ---- gate + state ---- */
  function evaluateGate(options) {
    options = options || {};
    if (options.reducedMotion) return { eligible: false, reason: "reduced-motion" };
    if (options.saveData) return { eligible: false, reason: "save-data" };
    if (!options.hasWebGL2) return { eligible: false, reason: "webgl2-unavailable" };
    if (options.hasIntersectionObserver === false) return { eligible: false, reason: "no-intersection-observer" };
    return { eligible: true, reason: "eligible" };
  }

  function nextState(state, event) {
    var row = STATES[state];
    return row && row[event] ? row[event] : state;
  }

  return {
    DEFAULT_ZOOM: DEFAULT_ZOOM,
    latLngToVector: latLngToVector,
    slerp: slerp,
    greatCircleArc: greatCircleArc,
    angleBetween: angleBetween,
    parseStops: parseStops,
    buildTimeline: buildTimeline,
    buildCameraKeyframes: buildCameraKeyframes,
    resolvePose: resolvePose,
    footprintReveal: footprintReveal,
    routeProgress: routeProgress,
    buildRoutePath: buildRoutePath,
    routeDrawCount: routeDrawCount,
    applyOrbitOffset: applyOrbitOffset,
    decayOffset: decayOffset,
    idleDriftOffset: idleDriftOffset,
    markerRadius: markerRadius,
    scrollFraction: scrollFraction,
    trackHeight: trackHeight,
    capDevicePixelRatio: capDevicePixelRatio,
    limbInFrame: limbInFrame,
    framing: framing,
    parseCssColor: parseCssColor,
    buildLinePositions: buildLinePositions,
    graticulePositions: graticulePositions,
    evaluateGate: evaluateGate,
    nextState: nextState
  };
}));
