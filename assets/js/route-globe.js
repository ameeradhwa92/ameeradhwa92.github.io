/* Route globe — the DOM/WebGL adapter. Reads the stops list, decides whether
   this device may render, lazily imports the vendored three.js when the
   section approaches, then scrubs the camera with scroll. Every geometry and
   choreography decision comes from route-globe-core.js; this file only owns
   browser objects. Off the happy path (reduced motion, no WebGL2, save-data,
   load failure, lost context) the section stays the poster + list it renders
   without JS, and the reason is written to section.dataset.globe. */
(function () {
  "use strict";

  var core = window.ROUTE_GLOBE_CORE;
  var section = document.getElementById("route");
  var track = document.getElementById("route-track");
  var stage = document.getElementById("route-stage");
  var canvas = document.getElementById("route-canvas");
  var list = document.getElementById("route-stops");
  if (!core || !section || !track || !stage || !canvas || !list) return;

  var SEGMENT_SCROLL_SHARE = 0.42; /* viewport heights of scroll per stop-to-stop hop */
  var FOV = 38;
  var DPR_MAX = 2;
  var IDLE_FRAME_MS = 32;          /* the breathing sway renders at ~30 fps */
  var THREE_URL = "../vendor/three/three.module.min.js";
  var DATA_URL = "../data/route-globe-coastlines.json";

  var root = document.documentElement;
  var state = "idle";

  function warn(where, reason) {
    if (window.console && console.warn) console.warn("[route-globe] " + where + ": " + reason);
  }
  function transition(event) { state = core.nextState(state, event); return state; }

  /* Same cache-busting discipline as chatbot.js: forward our own ?v= to the
     coastline fetch. The vendored three.js is pinned by filename instead. */
  var currentScript = document.currentScript;
  var scriptSrc = currentScript && currentScript.src;
  var versionMatch = scriptSrc ? String(scriptSrc).match(/[?&]v=([^&#]+)/) : null;
  var ASSET_VERSION_QUERY = versionMatch ? "?v=" + versionMatch[1] : "";
  var BASE = scriptSrc ? new URL(".", scriptSrc).href : new URL("assets/js/", location.href).href;
  function assetUrl(relative, versioned) {
    return new URL(relative, BASE).href + (versioned ? ASSET_VERSION_QUERY : "");
  }

  /* ---- stops: the <ol> is the data source and the caption ---- */
  var items = Array.prototype.slice.call(list.querySelectorAll("li[data-lat]"));
  var parsed = core.parseStops(items.map(function (li) {
    return {
      lat: li.getAttribute("data-lat"), lng: li.getAttribute("data-lng"),
      kind: li.getAttribute("data-kind"), zoom: li.getAttribute("data-zoom"),
      key: li.getAttribute("data-i18n") || undefined
    };
  }));
  var timeline = core.buildTimeline(parsed.stops);
  parsed.warnings.concat(timeline.warnings).forEach(function (w) { warn("stops", w); });
  var keyframes = core.buildCameraKeyframes(timeline.keyframable);
  var keyframeEls = timeline.keyframable.map(function (stop) { return items[stop.index]; });
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
      })
    ]).then(function (loaded) {
      build(loaded[0], loaded[1]);
    }, function (err) {
      transition("load-fail");
      section.dataset.globe = "error";
      warn("load", err && err.message ? err.message : String(err));
    });
  }

  var RIM_VERTEX = [
    "varying vec3 vNormal; varying vec3 vView;",
    "void main() {",
    "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
    "  vNormal = normalize(normalMatrix * normal);",
    "  vView = normalize(-mv.xyz);",
    "  gl_Position = projectionMatrix * mv;",
    "}"
  ].join("\n");
  var RIM_FRAGMENT = [
    "uniform vec3 base; uniform vec3 rim; uniform float strength;",
    "varying vec3 vNormal; varying vec3 vView;",
    "void main() {",
    "  float f = pow(1.0 - max(dot(vNormal, vView), 0.0), 3.0);",
    "  gl_FragColor = vec4(mix(base, rim, f * strength), 1.0);",
    "  #include <colorspace_fragment>",
    "}"
  ].join("\n");

  function build(THREE, data) {
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: "low-power" });
    } catch (e) {
      transition("load-fail"); section.dataset.globe = "error"; warn("renderer", e && e.message); return;
    }
    renderer.setClearColor(0x000000, 0);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 20);
    var globe = new THREE.Group();
    scene.add(globe);

    /* The sphere occludes the far side; its shader adds a teal rim so the limb reads as a glow. */
    var sphereMat = new THREE.ShaderMaterial({
      uniforms: { base: { value: new THREE.Color(0x12171a) }, rim: { value: new THREE.Color(0x3ecfbb) }, strength: { value: 0.55 } },
      vertexShader: RIM_VERTEX, fragmentShader: RIM_FRAGMENT
    });
    globe.add(new THREE.Mesh(new THREE.SphereGeometry(0.996, 72, 48), sphereMat));

    function lines(positions, material, LineType) {
      var geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      var obj = new (LineType || THREE.LineSegments)(geo, material);
      globe.add(obj);
      return obj;
    }
    var graticuleMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.16 });
    lines(core.graticulePositions(15, 1.0005), graticuleMat);
    var coastMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.62 });
    lines(core.buildLinePositions(data, 1.001), coastMat);

    var path = core.buildRoutePath(keyframes, { samples: 32, radius: 1.004 });
    var routeMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95 });
    var route = lines(path.positions, routeMat, THREE.Line);
    route.geometry.setDrawRange(0, 0);

    /* Markers stay a constant size on screen: the group is rescaled per frame. */
    var dotGeo = new THREE.CircleGeometry(1, 28);
    var ringGeo = new THREE.RingGeometry(1.7, 2.1, 40);
    var haloGeo = new THREE.RingGeometry(2.8, 3.1, 48);
    var dotMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthTest: false });
    var ringMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthTest: false });
    var footDotMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false });
    var arcMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0 });

    function marker(dir, dot, ring, halo) {
      var group = new THREE.Group();
      group.add(new THREE.Mesh(dotGeo, dot));
      var ringMesh = new THREE.Mesh(ringGeo, ring);
      group.add(ringMesh);
      var haloMesh = null;
      if (halo) { haloMesh = new THREE.Mesh(haloGeo, ring); group.add(haloMesh); }
      group.position.set(dir.x * 1.006, dir.y * 1.006, dir.z * 1.006);
      group.lookAt(dir.x * 2, dir.y * 2, dir.z * 2);
      group.renderOrder = 2;
      globe.add(group);
      return { group: group, ring: ringMesh, halo: haloMesh };
    }
    /* One marker per place; several keyframes (the Dungun years, the two KL
       jobs) share it, so each marker remembers which keyframe indices it
       stands for and lights up when any of them is active. */
    var markersByPlace = {};
    var placeMarkers = [];
    keyframes.forEach(function (kf, i) {
      if (kf.kind === "region") return;
      var id = kf.lat + "," + kf.lng;
      var m = markersByPlace[id];
      if (!m) {
        m = markersByPlace[id] = marker(kf.dir, dotMat, ringMat, kf.kind === "remote");
        m.indices = [];
        placeMarkers.push(m);
      } else if (kf.kind === "remote" && !m.halo) {
        m.halo = new THREE.Mesh(haloGeo, ringMat);
        m.group.add(m.halo);
      }
      m.indices.push(i);
    });
    var footprintMarkers = timeline.footprints.map(function (fp) {
      var target = core.latLngToVector(fp.stop.lat, fp.stop.lng, 1);
      var origin = keyframes[fp.originIndex].dir;
      var pts = core.greatCircleArc(origin, target, { segments: 48, radius: 1.004, arcHeight: 0.16 });
      var arr = new Float32Array(pts.length * 3);
      pts.forEach(function (p, i) { arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; });
      lines(arr, arcMat, THREE.Line);
      return marker(target, footDotMat, footDotMat, false);
    });

    /* ---- theme: colours come from the palette custom properties ---- */
    function cssColor(styles, name, fallback) {
      return core.parseCssColor(styles.getPropertyValue(name)) || fallback;
    }
    function tint(color, rgb) { color.setRGB(rgb.r, rgb.g, rgb.b, THREE.SRGBColorSpace); }
    function applyTheme() {
      var styles = getComputedStyle(root);
      var teal = cssColor(styles, "--teal", { r: 0.24, g: 0.81, b: 0.73 });
      var panel = cssColor(styles, "--panel", { r: 0.07, g: 0.09, b: 0.1 });
      var paper = cssColor(styles, "--paper", { r: 0.91, g: 0.9, b: 0.87 });
      var muted = cssColor(styles, "--muted", { r: 0.55, g: 0.58, b: 0.6 });
      tint(sphereMat.uniforms.base.value, panel);
      tint(sphereMat.uniforms.rim.value, teal);
      tint(graticuleMat.color, muted);
      tint(coastMat.color, teal);
      tint(routeMat.color, paper);
      tint(dotMat.color, teal);
      tint(ringMat.color, teal);
      tint(footDotMat.color, teal);
      tint(arcMat.color, paper); /* paper, like the route: teal arcs vanish against teal coastlines */
      requestRender();
    }
    new MutationObserver(applyTheme).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
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
    var dead = false; /* set once the context is lost: nothing schedules again */

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
      var dir = core.applyOrbitOffset(pose.direction,
        offset.yaw + drift.yaw * closeness, offset.pitch + drift.pitch * closeness);
      camera.position.set(dir.x * pose.distance, dir.y * pose.distance, dir.z * pose.distance);
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);

      route.geometry.setDrawRange(0, core.routeDrawCount(core.routeProgress(fraction, keyframes), path.segmentSamples));
      var reveal = core.footprintReveal(fraction, keyframes);
      arcMat.opacity = reveal * 0.85;
      footDotMat.opacity = reveal * 0.95;

      var radius = core.markerRadius(pose.distance);
      placeMarkers.forEach(function (m) {
        var active = m.indices.indexOf(pose.activeIndex) !== -1;
        m.group.scale.setScalar(radius * (active ? 1.4 : 1));
        m.ring.visible = active;
        if (m.halo) m.halo.visible = active;
      });
      footprintMarkers.forEach(function (m) { m.group.scale.setScalar(radius * 0.8); m.ring.visible = false; });
      setActive(pose.activeIndex);

      renderer.render(scene, camera);
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
      renderer.setPixelRatio(core.capDevicePixelRatio(window.devicePixelRatio, DPR_MAX));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
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
      section.dataset.globe = "error";
      track.style.height = "";
      if (activeEl) { activeEl.classList.remove("is-active"); activeEl = null; }
      warn("render", "webgl context lost");
    });

    /* ---- go live ---- */
    transition("load-success");
    section.classList.add("is-live");
    section.dataset.globe = "live";
    applyTheme();
    layout();
  }
})();
