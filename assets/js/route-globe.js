/* Route globe — the DOM/WebGL adapter. Reads the stops list, decides whether
   this device may render, lazily imports the vendored three.js (and its Line2
   addon for fat lines) when the section approaches, then scrubs the camera with
   scroll. Every geometry, framing and choreography decision comes from
   route-globe-core.js; this file only owns browser objects: the renderer, the
   shader materials, the projected DOM labels and the caption rail. Off the
   happy path (reduced motion, no WebGL2, save-data, load failure, lost
   context) the section stays the poster + list it renders without JS, and the
   reason is written to section.dataset.globe. If only the Line2 addon fails,
   the globe still renders with 1px lines and reports "live-thin". */
(function () {
  "use strict";

  var core = window.ROUTE_GLOBE_CORE;
  var section = document.getElementById("route");
  var track = document.getElementById("route-track");
  var stage = document.getElementById("route-stage");
  var canvas = document.getElementById("route-canvas");
  var rail = document.getElementById("route-rail");
  var list = document.getElementById("route-stops");
  if (!core || !section || !track || !stage || !canvas || !rail || !list) return;

  var SEGMENT_SCROLL_SHARE = 0.42; /* viewport heights of scroll per stop-to-stop hop */
  var DPR_MAX = 1.75;              /* the stage is full-bleed now; 2 was fill-rate hungry */
  var IDLE_FRAME_MS = 32;          /* the breathing sway, pulses and the travelling light run at ~30 fps */
  var NARROW_MAX_WIDTH = 899;      /* matches the CSS breakpoint for the caption layout */
  var STAR_COUNT = 600;
  var STAR_SEED = 1992;
  var PULSE_MS = 1800;             /* active-marker ring period */
  var TRAVEL_MS = 2600;            /* one lap of the light along the drawn route */
  var MARKER_SCALE = 3.6;          /* plane half-size per unit of core.markerRadius() */
  var RAIL_NODE_Y = 22;            /* node centre below the li top: 14px top + 8px radius (style.css) */
  var THREE_URL = "../vendor/three/three.module.min.js";
  var LINES_DIR = "../vendor/three/lines/";
  var LINE_MODULES = ["Line2", "LineSegments2", "LineGeometry", "LineSegmentsGeometry", "LineMaterial"];
  var DATA_URL = "../data/route-globe-coastlines.json";
  var LIGHT_DIR = { x: -0.6, y: 0.7, z: 0.5 }; /* view space: upper-left, like the CSS atmosphere */
  /* dx, dy, anchor translate — mirrors .route-label.dir-* leader lines in style.css */
  var LABEL_OFFSETS = {
    e: [18, 0, "0, -50%"], w: [-18, 0, "-100%, -50%"], n: [0, -18, "-50%, -100%"], s: [0, 18, "-50%, 0"],
    ne: [14, -14, "0, -100%"], nw: [-14, -14, "-100%, -100%"], se: [14, 14, "0, 0"], sw: [-14, 14, "-100%, 0"]
  };

  var root = document.documentElement;
  var state = "idle";

  function warn(where, reason) {
    if (window.console && console.warn) console.warn("[route-globe] " + where + ": " + reason);
  }
  function transition(event) { state = core.nextState(state, event); return state; }

  /* 100vw includes the vertical scrollbar; publish its width so the CSS
     full-bleed track can subtract it (see .route-track in style.css). This
     runs before the gate so the poster fallback is exact too. */
  function publishGutter() {
    root.style.setProperty("--route-gutter", Math.max(0, window.innerWidth - root.clientWidth) + "px");
  }
  publishGutter();
  window.addEventListener("resize", publishGutter);

  /* Same cache-busting discipline as chatbot.js: forward our own ?v= to the
     coastline fetch. The vendored three.js and its addon are pinned by path
     instead — and the import map resolves the addon's bare "three" to the very
     same URL imported here, so exactly one copy of three.js loads. */
  var currentScript = document.currentScript;
  var scriptSrc = currentScript && currentScript.src;
  var versionMatch = scriptSrc ? String(scriptSrc).match(/[?&]v=([^&#]+)/) : null;
  var ASSET_VERSION_QUERY = versionMatch ? "?v=" + versionMatch[1] : "";
  var BASE = scriptSrc ? new URL(".", scriptSrc).href : new URL("assets/js/", location.href).href;
  function assetUrl(relative, versioned) {
    return new URL(relative, BASE).href + (versioned ? ASSET_VERSION_QUERY : "");
  }

  /* ---- stops: the <ol> is the data source and the caption rail ---- */
  var items = Array.prototype.slice.call(list.querySelectorAll("li[data-lat]"));
  var parsed = core.parseStops(items.map(function (li) {
    return {
      lat: li.getAttribute("data-lat"), lng: li.getAttribute("data-lng"),
      kind: li.getAttribute("data-kind"), zoom: li.getAttribute("data-zoom"),
      labelDir: li.getAttribute("data-label-dir") || undefined,
      key: li.getAttribute("data-i18n") || undefined
    };
  }));
  var timeline = core.buildTimeline(parsed.stops);
  parsed.warnings.concat(timeline.warnings).forEach(function (w) { warn("stops", w); });
  var keyframes = core.buildCameraKeyframes(timeline.keyframable);
  var keyframeEls = timeline.keyframable.map(function (stop) { return items[stop.index]; });
  var keyframeStops = timeline.keyframable;
  if (keyframes.length < 2) { section.dataset.globe = "too-few-stops"; return; }

  /* ---- gate ---- */
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var saveData = !!(navigator.connection && navigator.connection.saveData);
  function probeWebGL2() {
    try {
      var probe = document.createElement("canvas");
      return !!(window.WebGL2RenderingContext && probe.getContext("webgl2"));
    } catch (e) { return false; }
  }
  function gate(withProbe) {
    return core.evaluateGate({
      reducedMotion: reduced,
      saveData: saveData,
      hasWebGL2: withProbe ? probeWebGL2() : true,
      hasIntersectionObserver: "IntersectionObserver" in window
    });
  }
  var early = gate(false);
  if (!early.eligible) { transition("gate-fail"); section.dataset.globe = early.reason; return; }

  /* Load only when the visitor is heading this way. */
  var approach = new IntersectionObserver(function (entries) {
    if (!entries.some(function (e) { return e.isIntersecting; })) return;
    approach.disconnect();
    start();
  }, { rootMargin: "600px 0px" });
  approach.observe(section);

  /* The addon is optional: a failure here degrades to 1px lines, never to the poster. */
  function loadLines() {
    return Promise.all(LINE_MODULES.map(function (name) {
      return import(assetUrl(LINES_DIR + name + ".js", false));
    })).then(function (mods) {
      var out = {};
      LINE_MODULES.forEach(function (name, i) { out[name] = mods[i][name]; });
      return out;
    }, function (err) {
      warn("lines", err && err.message ? err.message : String(err));
      return null;
    });
  }

  function start() {
    var full = gate(true);
    if (!full.eligible) { transition("gate-fail"); section.dataset.globe = full.reason; return; }
    transition("enter-viewport");
    section.dataset.globe = "loading";
    Promise.all([
      import(assetUrl(THREE_URL, false)),
      fetch(assetUrl(DATA_URL, true)).then(function (res) {
        if (!res.ok) throw new Error("coastlines HTTP " + res.status);
        return res.json();
      }),
      loadLines()
    ]).then(function (loaded) {
      /* build() runs outside the promise chain's rejection handler, so a throw
         in there (malformed coastline data, a renderer refusing to construct)
         would otherwise leave dataset.globe stuck on "loading" and say nothing. */
      try { build(loaded[0], loaded[1], loaded[2]); } catch (err) { fail(err); }
    }, fail);
  }
  function fail(err) {
    transition("load-fail");
    section.dataset.globe = "error";
    warn("load", err && err.message ? err.message : String(err));
  }

  /* ---- shaders ---- */
  var SURFACE_VERTEX = [
    "varying vec3 vNormal; varying vec3 vView; varying vec3 vPos;",
    "void main() {",
    "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
    "  vNormal = normalize(normalMatrix * normal);",
    "  vView = normalize(-mv.xyz);",
    "  vPos = position;",
    "  gl_Position = projectionMatrix * mv;",
    "}"
  ].join("\n");
  /* Hemisphere-lit surface whose shadow side falls into the page background,
     a little value noise so the ocean is not a flat fill, and a fresnel rim. */
  var SURFACE_FRAGMENT = [
    "uniform vec3 base; uniform vec3 shadow; uniform vec3 rim; uniform vec3 lightDir;",
    "uniform float strength; uniform float noiseAmp;",
    "varying vec3 vNormal; varying vec3 vView; varying vec3 vPos;",
    "float hash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }",
    "float vnoise(vec3 x) {",
    "  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),",
    "             mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);",
    "}",
    "void main() {",
    "  float wrap = 0.35;",
    "  float lit = clamp((dot(vNormal, lightDir) + wrap) / (1.0 + wrap), 0.0, 1.0);",
    "  lit = lit * lit * (3.0 - 2.0 * lit);",
    "  float n = vnoise(vPos * 9.0) * 2.0 - 1.0;",
    "  vec3 col = mix(shadow, base, lit) * (1.0 + noiseAmp * n);",
    "  float f = pow(1.0 - max(dot(vNormal, vView), 0.0), 3.0);",
    "  gl_FragColor = vec4(mix(col, rim, f * strength), 1.0);",
    "  #include <colorspace_fragment>",
    "}"
  ].join("\n");
  var ATMO_VERTEX = [
    "varying vec3 vNormal; varying vec3 vView;",
    "void main() {",
    "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
    "  vNormal = normalize(normalMatrix * normal);",
    "  vView = normalize(-mv.xyz);",
    "  gl_Position = projectionMatrix * mv;",
    "}"
  ].join("\n");
  /* Back faces of a slightly larger sphere: the outward normal faces away from
     the camera, so -dot runs 0 at the outer edge to ~0.45 at the globe's limb. */
  var ATMO_FRAGMENT = [
    "uniform vec3 glow; uniform float peak;",
    "varying vec3 vNormal; varying vec3 vView;",
    "void main() {",
    "  float f = smoothstep(0.0, 0.45, -dot(vNormal, vView));",
    "  gl_FragColor = vec4(glow, f * f * peak);",
    "  #include <colorspace_fragment>",
    "}"
  ].join("\n");
  /* Line vertices fade as they turn away from the camera, so the far side and
     the crowded limb dissolve instead of reading as a flat outline. */
  var FADE_VERTEX = [
    "varying float vFade;",
    "void main() {",
    "  vec4 wp = modelMatrix * vec4(position, 1.0);",
    "  vec3 toCam = normalize(cameraPosition - wp.xyz);",
    "  vFade = smoothstep(-0.15, 0.30, dot(normalize(position), toCam));",
    "  gl_Position = projectionMatrix * viewMatrix * wp;",
    "}"
  ].join("\n");
  var FADE_FRAGMENT = [
    "uniform vec3 color; uniform float opacity; varying float vFade;",
    "void main() {",
    "  gl_FragColor = vec4(color, opacity * vFade);",
    "  #include <colorspace_fragment>",
    "}"
  ].join("\n");
  /* A soft dot, an expanding pulse ring while active, and a static halo for
     remote stops — one quad per marker, additive on dark. */
  var MARKER_VERTEX = [
    "varying vec2 vUv;",
    "void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }"
  ].join("\n");
  var MARKER_FRAGMENT = [
    "uniform vec3 color; uniform float opacity; uniform float pulse; uniform float halo;",
    "varying vec2 vUv;",
    "void main() {",
    "  float r = length(vUv);",
    "  float dotR = 0.28;",
    "  float a = 1.0 - smoothstep(dotR * 0.75, dotR, r);",
    "  float ring = 0.0;",
    "  if (pulse >= 0.0) {",
    "    float pr = mix(dotR * 1.5, 0.98, pulse);",
    "    ring = (1.0 - smoothstep(0.0, 0.05, abs(r - pr))) * (1.0 - pulse) * 0.8;",
    "  }",
    "  ring += halo * (1.0 - smoothstep(0.0, 0.035, abs(r - 0.7))) * 0.5;",
    "  a = max(a, ring);",
    "  if (a < 0.01) discard;",
    "  gl_FragColor = vec4(color, a * opacity);",
    "  #include <colorspace_fragment>",
    "}"
  ].join("\n");

  function build(THREE, data, LINES) {
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: "low-power" });
    } catch (e) {
      transition("load-fail"); section.dataset.globe = "error"; warn("renderer", e && e.message); return;
    }
    renderer.setClearColor(0x000000, 0);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(38, 1, 0.01, 40);
    var globe = new THREE.Group();
    scene.add(globe);

    function tint(color, rgb) { color.setRGB(rgb.r, rgb.g, rgb.b, THREE.SRGBColorSpace); }

    /* ---- surface + atmosphere ---- */
    var sphereMat = new THREE.ShaderMaterial({
      uniforms: {
        base: { value: new THREE.Color(0x12171a) }, shadow: { value: new THREE.Color(0x0b0e10) },
        rim: { value: new THREE.Color(0x3ecfbb) }, strength: { value: 0.45 },
        lightDir: { value: new THREE.Vector3(LIGHT_DIR.x, LIGHT_DIR.y, LIGHT_DIR.z).normalize() },
        noiseAmp: { value: 0.03 }
      },
      vertexShader: SURFACE_VERTEX, fragmentShader: SURFACE_FRAGMENT
    });
    globe.add(new THREE.Mesh(new THREE.SphereGeometry(0.996, 96, 64), sphereMat));

    var atmoMat = new THREE.ShaderMaterial({
      uniforms: { glow: { value: new THREE.Color(0x3ecfbb) }, peak: { value: 0.55 } },
      vertexShader: ATMO_VERTEX, fragmentShader: ATMO_FRAGMENT,
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    var atmo = new THREE.Mesh(new THREE.SphereGeometry(1.09, 64, 48), atmoMat);
    atmo.renderOrder = 1;
    globe.add(atmo);

    /* ---- coastlines + graticule: 1px, fading away from the camera ---- */
    function fadeLineMaterial(opacity) {
      return new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Color(0xffffff) }, opacity: { value: opacity } },
        vertexShader: FADE_VERTEX, fragmentShader: FADE_FRAGMENT, transparent: true, depthWrite: false
      });
    }
    function thinSegments(positions, material) {
      var geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      var obj = new THREE.LineSegments(geo, material);
      globe.add(obj);
      return obj;
    }
    var graticuleMat = fadeLineMaterial(0.16);
    thinSegments(core.graticulePositions(15, 1.0005), graticuleMat);
    var coastMat = fadeLineMaterial(0.62);
    thinSegments(core.buildLinePositions(data, 1.001), coastMat);

    /* ---- stars (dark only) ---- */
    var starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(core.starPositions(STAR_COUNT, STAR_SEED), 3));
    var starMat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.35, depthWrite: false });
    var stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    /* ---- route + arcs: fat Line2 when the addon loaded, 1px lines otherwise ---- */
    var path = core.buildRoutePath(keyframes, { samples: 32, radius: 1.004 });
    var routeLengths = cumulativeLengths(path.positions);
    function cumulativeLengths(pos) {
      var out = [0];
      for (var i = 3; i < pos.length; i += 3) {
        var dx = pos[i] - pos[i - 3], dy = pos[i + 1] - pos[i - 2], dz = pos[i + 2] - pos[i - 1];
        out.push(out[out.length - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz));
      }
      return out;
    }
    var arcPairs = (function () {
      var arr = [];
      timeline.footprints.forEach(function (fp) {
        var target = core.latLngToVector(fp.stop.lat, fp.stop.lng, 1);
        var origin = keyframes[fp.originIndex].dir;
        var pts = core.greatCircleArc(origin, target, { segments: 48, radius: 1.004, arcHeight: 0.16 });
        for (var i = 0; i + 1 < pts.length; i++) {
          arr.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
        }
      });
      return new Float32Array(arr);
    })();

    /* Both builders return the same small interface so frame() never cares
       which one it got. setCount is in vertices of the polyline. */
    function thinPolyline(positions, LineType) {
      var geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      var mat = new THREE.LineBasicMaterial({ transparent: true, opacity: 1 });
      var obj = new LineType(geo, mat);
      globe.add(obj);
      return {
        setColor: function (rgb) { tint(mat.color, rgb); },
        setOpacity: function (o) { mat.opacity = o; },
        setCount: function (k) { geo.setDrawRange(0, k); },
        setResolution: function () {},
        setPulse: function () {}
      };
    }
    function fatPolyline(positions, segments) {
      var geo = segments ? new LINES.LineSegmentsGeometry() : new LINES.LineGeometry();
      geo.setPositions(positions);
      var Type = segments ? LINES.LineSegments2 : LINES.Line2;
      function make(width, opacity, extra) {
        var opts = { linewidth: width, worldUnits: false, transparent: true, opacity: opacity, depthWrite: false };
        if (extra) for (var k in extra) opts[k] = extra[k];
        var mat = new LINES.LineMaterial(opts);
        var obj = new Type(geo, mat);
        globe.add(obj);
        return obj;
      }
      var main = make(2.5, 0.95);
      var glow = make(7, 0.12);
      var pulse = segments ? null : make(3.5, 1, { dashed: true, dashSize: 0.005, gapSize: 100 });
      if (pulse) pulse.computeLineDistances();
      var mats = [main.material, glow.material];
      if (pulse) mats.push(pulse.material);
      return {
        setColor: function (rgb) { mats.forEach(function (m) { tint(m.color, rgb); }); },
        setOpacity: function (o) {
          main.material.opacity = 0.95 * o; glow.material.opacity = 0.12 * o;
          if (pulse) pulse.material.opacity = o;
        },
        setCount: function (k) {
          var n = Math.max(0, k - 1);
          geo.instanceCount = n;
          main.visible = glow.visible = n > 0;
          if (pulse) pulse.visible = n > 0;
        },
        setResolution: function (w, h) { mats.forEach(function (m) { m.resolution.set(w, h); }); },
        setPulse: function (head) { if (pulse) pulse.material.dashOffset = -head; }
      };
    }
    var route = LINES ? fatPolyline(path.positions, false) : thinPolyline(path.positions, THREE.Line);
    var arcs = LINES ? fatPolyline(arcPairs, true) : thinPolyline(arcPairs, THREE.LineSegments);
    route.setCount(0);
    arcs.setOpacity(0);

    /* ---- markers: one quad per distinct place, plus one per footprint ---- */
    var markerGeo = new THREE.PlaneGeometry(2, 2);
    function markerMaterial(halo) {
      return new THREE.ShaderMaterial({
        uniforms: {
          color: { value: new THREE.Color(0x3ecfbb) }, opacity: { value: 0.95 },
          pulse: { value: -1 }, halo: { value: halo ? 1 : 0 }
        },
        vertexShader: MARKER_VERTEX, fragmentShader: MARKER_FRAGMENT,
        transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending
      });
    }
    function marker(dir, halo) {
      var mat = markerMaterial(halo);
      var mesh = new THREE.Mesh(markerGeo, mat);
      mesh.position.set(dir.x * 1.006, dir.y * 1.006, dir.z * 1.006);
      mesh.lookAt(dir.x * 2, dir.y * 2, dir.z * 2);
      mesh.renderOrder = 3;
      globe.add(mesh);
      return { mesh: mesh, mat: mat, dir: dir, indices: [] };
    }
    /* One marker per place; several keyframes (the Dungun years, the two KL
       jobs, the two Shah Alam stops) share it and any of them lights it. */
    var markersByPlace = {};
    var placeMarkers = [];
    keyframes.forEach(function (kf, i) {
      if (kf.kind === "region") return;
      var id = kf.lat + "," + kf.lng;
      var m = markersByPlace[id];
      if (!m) {
        m = markersByPlace[id] = marker(kf.dir, kf.kind === "remote");
        m.labelDir = keyframeStops[i].labelDir;
        m.labelEl = keyframeEls[i];
        placeMarkers.push(m);
      } else if (kf.kind === "remote") {
        m.mat.uniforms.halo.value = 1;
      }
      m.indices.push(i);
    });
    var footprintMarkers = timeline.footprints.map(function (fp) {
      var m = marker(core.latLngToVector(fp.stop.lat, fp.stop.lng, 1), false);
      m.labelDir = fp.stop.labelDir;
      m.labelEl = items[fp.stop.index];
      m.footprint = true;
      return m;
    });
    var allMaterials = placeMarkers.concat(footprintMarkers).map(function (m) { return m.mat; });
    /* The stop the arcs fan out of: the only place label kept at the region
       pull-back, where all four Malaysian places project into ~30px. */
    var hubIndex = timeline.footprints.length ? timeline.footprints[0].originIndex : -1;

    /* ---- labels: DOM, projected each frame, text from the stops themselves ---- */
    var labelLayer = document.createElement("div");
    labelLayer.className = "route-labels";
    labelLayer.setAttribute("aria-hidden", "true");
    stage.appendChild(labelLayer);
    function labelText(li, footprint) {
      if (footprint) return (li.textContent || "").trim();
      var place = li.querySelector(".route-stop-place");
      return ((place ? place.textContent : "") || "").split(" · ")[0].trim();
    }
    var labels = placeMarkers.concat(footprintMarkers).map(function (m) {
      var el = document.createElement("span");
      el.className = "route-label dir-" + (m.labelDir || "e");
      el.hidden = true;
      labelLayer.appendChild(el);
      return { el: el, marker: m, world: new THREE.Vector3(m.dir.x * 1.006, m.dir.y * 1.006, m.dir.z * 1.006) };
    });
    function refreshLabelText() {
      labels.forEach(function (l) { l.el.textContent = labelText(l.marker.labelEl, !!l.marker.footprint); });
    }
    refreshLabelText();
    var projected = new THREE.Vector3();
    /* limit and regionActive come from frame() so the marker meshes and their
       labels cannot drift apart on the horizon rule. */
    function projectLabels(pose, reveal, limit, regionActive) {
      labels.forEach(function (l) {
        var m = l.marker;
        var hidden = !facingCamera(m, limit) || (m.footprint && reveal <= 0.02);
        if (!m.footprint && regionActive && m.indices.indexOf(hubIndex) === -1) hidden = true;
        if (l.el.hidden !== hidden) l.el.hidden = hidden;
        if (hidden) return;
        projected.copy(l.world).project(camera);
        var off = LABEL_OFFSETS[m.labelDir] || LABEL_OFFSETS.e;
        var x = (projected.x + 1) * 0.5 * viewW + off[0];
        var y = (1 - projected.y) * 0.5 * viewH + off[1];
        l.el.style.transform = "translate(" + x.toFixed(1) + "px, " + y.toFixed(1) + "px) translate(" + off[2] + ")";
        if (m.footprint) l.el.style.opacity = reveal.toFixed(2);
        var active = m.indices.indexOf(pose.activeIndex) !== -1;
        if (l.el.classList.contains("is-active") !== active) l.el.classList.toggle("is-active", active);
      });
    }

    /* ---- theme: every colour comes from the palette custom properties ---- */
    function cssColor(styles, name, fallback) {
      return core.parseCssColor(styles.getPropertyValue(name)) || fallback;
    }
    function applyTheme() {
      var styles = getComputedStyle(root);
      var teal = cssColor(styles, "--teal", { r: 0.24, g: 0.81, b: 0.73 });
      var tealDeep = cssColor(styles, "--teal-deep", { r: 0.09, g: 0.46, b: 0.43 });
      var ink = cssColor(styles, "--ink", { r: 0.04, g: 0.05, b: 0.06 });
      var panel = cssColor(styles, "--panel", { r: 0.07, g: 0.09, b: 0.1 });
      var panel2 = cssColor(styles, "--panel-2", { r: 0.09, g: 0.11, b: 0.13 });
      var paper = cssColor(styles, "--paper", { r: 0.91, g: 0.9, b: 0.87 });
      var muted = cssColor(styles, "--muted", { r: 0.55, g: 0.58, b: 0.6 });
      var light = ink.r + ink.g + ink.b > 1.5;

      tint(sphereMat.uniforms.base.value, panel);
      tint(sphereMat.uniforms.shadow.value, light ? panel2 : ink);
      tint(sphereMat.uniforms.rim.value, light ? tealDeep : teal);
      sphereMat.uniforms.strength.value = light ? 0.18 : 0.45;

      tint(atmoMat.uniforms.glow.value, light ? tealDeep : teal);
      atmoMat.uniforms.peak.value = light ? 0.16 : 0.55;
      atmoMat.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
      atmoMat.needsUpdate = true;

      tint(graticuleMat.uniforms.color.value, muted);
      tint(coastMat.uniforms.color.value, teal);
      tint(starMat.color, paper);
      stars.visible = !light;

      route.setColor(teal);        /* the route rhymes with the timeline spine */
      arcs.setColor(paper);        /* paper: teal arcs vanish against teal coastlines */
      allMaterials.forEach(function (m) {
        tint(m.uniforms.color.value, teal);
        m.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
        m.needsUpdate = true;
      });
      requestRender();
    }
    new MutationObserver(function (mutations) {
      var lang = mutations.some(function (mu) { return mu.attributeName === "data-lang"; });
      if (lang) refreshLabelText();
      if (mutations.some(function (mu) { return mu.attributeName === "data-theme"; })) applyTheme();
    }).observe(root, { attributes: true, attributeFilter: ["data-theme", "data-lang"] });
    var scheme = window.matchMedia("(prefers-color-scheme: light)");
    if (scheme.addEventListener) scheme.addEventListener("change", applyTheme);

    /* ---- frame state ---- */
    var fraction = 0;
    var offset = { yaw: 0, pitch: 0 };
    var dragging = false;
    var onScreen = false;
    var idleStart = performance.now();
    var lastRender = 0;
    var needsRender = true;
    var raf = null;
    var activeEl = null;
    var lastPose = core.resolvePose(0, keyframes);
    var viewW = 1, viewH = 1, aspect = 1, layoutMode = "wide";
    var dead = false; /* set once the context is lost: nothing schedules again */
    var progressEl = rail.querySelector(".route-rail-progress");

    function requestRender() {
      if (dead) return;
      needsRender = true;
      if (raf === null) raf = requestAnimationFrame(frame);
    }
    function setActive(index) {
      var el = keyframeEls[index];
      if (el === activeEl) return;
      if (activeEl) activeEl.classList.remove("is-active");
      activeEl = el;
      if (el) el.classList.add("is-active");
      if (progressEl && el) progressEl.style.height = Math.max(0, el.offsetTop - keyframeEls[0].offsetTop) + "px";
    }

    var camDir = { x: 0, y: 0, z: 1 };
    /* A surface point is hidden by the sphere below `limit`. The markers draw
       with depthTest off, so without this test a long drag (yaw is unclamped)
       floats the far side's dots over the globe; the labels use the same rule. */
    function facingCamera(m, limit) {
      return m.dir.x * camDir.x + m.dir.y * camDir.y + m.dir.z * camDir.z >= limit;
    }
    function frame(now) {
      raf = null;
      if (dead) return;
      var settling = offset.yaw !== 0 || offset.pitch !== 0;
      var breathing = onScreen && !dragging;
      if (!needsRender && !settling && breathing && now - lastRender < IDLE_FRAME_MS) {
        raf = requestAnimationFrame(frame);
        return;
      }
      if (!dragging && settling) offset = core.decayOffset(offset, 0.9);

      var pose = core.resolvePose(fraction, keyframes);
      lastPose = pose;
      var closeness = Math.min(Math.max(pose.distance - 1, 0), 1);
      var drift = breathing ? core.idleDriftOffset(now - idleStart) : { yaw: 0, pitch: 0 };
      camDir = core.applyOrbitOffset(pose.direction,
        offset.yaw + drift.yaw * closeness, offset.pitch + drift.pitch * closeness);

      var fr = core.framing(pose.distance, aspect, layoutMode);
      camera.fov = fr.fov;
      if (camera.setViewOffset) camera.setViewOffset(viewW, viewH, -fr.offsetX * viewW, -fr.offsetY * viewH, viewW, viewH);
      camera.updateProjectionMatrix();
      camera.position.set(camDir.x * pose.distance, camDir.y * pose.distance, camDir.z * pose.distance);
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);
      if (pose.bank) camera.rotateZ(pose.bank);
      stars.rotation.y = offset.yaw * 0.3;

      var count = core.routeDrawCount(core.routeProgress(fraction, keyframes), path.segmentSamples);
      route.setCount(count);
      var drawn = routeLengths[Math.min(Math.max(count, 1), routeLengths.length) - 1];
      route.setPulse(((now / TRAVEL_MS) % 1) * drawn);
      var reveal = core.footprintReveal(fraction, keyframes);
      arcs.setOpacity(reveal * 0.85);

      var scale = core.markerRadius(pose.distance) * MARKER_SCALE;
      var phase = (now % PULSE_MS) / PULSE_MS;
      var limit = 1 / pose.distance + 0.04;
      var regionActive = keyframes[pose.activeIndex].kind === "region";
      placeMarkers.forEach(function (m) {
        var active = m.indices.indexOf(pose.activeIndex) !== -1;
        m.mesh.scale.setScalar(scale * (active ? 1.15 : 1));
        m.mat.uniforms.pulse.value = active && breathing ? phase : -1;
        m.mat.uniforms.opacity.value = active ? 1 : 0.8;
        m.mesh.visible = facingCamera(m, limit);
      });
      footprintMarkers.forEach(function (m) {
        m.mesh.scale.setScalar(scale * 0.8);
        m.mat.uniforms.opacity.value = reveal * 0.95;
        m.mesh.visible = reveal > 0.02 && facingCamera(m, limit);
      });
      setActive(pose.activeIndex);

      renderer.render(scene, camera);
      /* after render: project() reads the camera's world inverse */
      projectLabels(pose, reveal, limit, regionActive);
      lastRender = now;
      needsRender = false;
      if (breathing || settling || dragging) raf = requestAnimationFrame(frame);
    }

    /* ---- layout + scroll ---- */
    function stickyTop() { return parseFloat(getComputedStyle(stage).top) || 0; }
    function layout() {
      track.style.height = core.trackHeight(stage.clientHeight, keyframes.length, window.innerHeight, SEGMENT_SCROLL_SHARE) + "px";
      var w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      viewW = w; viewH = h; aspect = w / h;
      layoutMode = window.innerWidth <= NARROW_MAX_WIDTH ? "narrow" : "wide";
      renderer.setPixelRatio(core.capDevicePixelRatio(window.devicePixelRatio, DPR_MAX));
      renderer.setSize(w, h, false);
      camera.aspect = aspect;
      route.setResolution(w, h);
      arcs.setResolution(w, h);
      if (progressEl) progressEl.style.top = (keyframeEls[0].offsetTop + RAIL_NODE_Y) + "px";
      if (activeEl && progressEl) progressEl.style.height = Math.max(0, activeEl.offsetTop - keyframeEls[0].offsetTop) + "px";
      onScroll();
      requestRender();
    }
    function onScroll() {
      var rect = track.getBoundingClientRect();
      var next = core.scrollFraction(rect.top, rect.height, stage.clientHeight, stickyTop());
      if (next === fraction) return;
      fraction = next;
      requestRender();
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", layout);

    var visibility = new IntersectionObserver(function (entries) {
      onScreen = entries.some(function (e) { return e.isIntersecting; });
      if (onScreen) { idleStart = performance.now(); requestRender(); }
    }, { threshold: 0 });
    visibility.observe(stage);

    /* ---- drag to orbit (fine pointers only, like the cursor glow) ---- */
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      var lastX = 0, lastY = 0;
      canvas.addEventListener("pointerdown", function (e) {
        if (e.button !== 0) return;
        dragging = true;
        lastX = e.clientX; lastY = e.clientY;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
        section.classList.add("is-dragging", "has-dragged");
        e.preventDefault();
        requestRender();
      });
      canvas.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        var sensitivity = 0.0045 * Math.min(Math.max(lastPose.distance - 1, 0.06), 1);
        offset.yaw -= (e.clientX - lastX) * sensitivity;
        offset.pitch = Math.min(Math.max(offset.pitch - (e.clientY - lastY) * sensitivity, -1.2), 1.2);
        lastX = e.clientX; lastY = e.clientY;
        requestRender();
      });
      function endDrag() {
        if (!dragging) return;
        dragging = false;
        section.classList.remove("is-dragging");
        requestRender();
      }
      canvas.addEventListener("pointerup", endDrag);
      canvas.addEventListener("pointercancel", endDrag);
      canvas.addEventListener("lostpointercapture", endDrag);
    }

    /* A lost context (driver reset, too many contexts, Safari reclaiming
       memory) is terminal: tear the loop down and fall back to the poster.
       Recovery needs a reload; nothing here listens for webglcontextrestored. */
    canvas.addEventListener("webglcontextlost", function (e) {
      e.preventDefault();
      transition("context-lost");
      dead = true;
      if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
      visibility.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", layout);
      section.classList.remove("is-live");
      canvas.classList.remove("route-fade");
      labelLayer.hidden = true;
      section.dataset.globe = "error";
      track.style.height = "";
      if (progressEl) { progressEl.style.height = ""; progressEl.style.top = ""; }
      if (activeEl) { activeEl.classList.remove("is-active"); activeEl = null; }
      warn("render", "webgl context lost");
    });

    /* ---- go live ---- */
    transition("load-success");
    section.classList.add("is-live");
    canvas.classList.add("route-fade");
    section.dataset.globe = LINES ? "live" : "live-thin";
    applyTheme();
    layout();
  }
})();
