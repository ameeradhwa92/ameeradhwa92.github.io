/* RetailAIM IR showcase — the DOM half. #work shows real IR Workforce screens
   (demo mode, sample data); this script adds the one live piece: the product
   survey's 3D pack from IR Ops, floating over those screens.

   The pack sits on the first chapter's screenshot by default. Where the chapters
   stack (the same query as style.css and motion.js) it moves to #ir-pack-rail, an
   overlay above every chapter where it sticks, so each screen slides in under it and the
   pack turns as the chapter changes. Off the happy path (no WebGL2, save-data, a
   failed import) it stays the CSS 3D box it renders without JS, and the reason is
   written to #cap-stage's data-pack. Reduced motion keeps drag and "Next pack",
   without the idle spin. */
(function () {
  "use strict";

  var core = window.IR_CORE;
  var section = document.getElementById("work");
  if (!core || !section) return;

  var gsap = window.gsap || null;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var saveData = !!(navigator.connection && navigator.connection.saveData);
  var root = document.documentElement;
  var STACK_QUERY = "(min-width: 1101px) and (min-height: 820px)";

  /* Same base-URL discipline as route-globe.js: three.js is imported by the very
     same absolute URL, so the module cache hands both scripts one copy. */
  var currentScript = document.currentScript;
  var scriptSrc = currentScript && currentScript.src;
  var BASE = scriptSrc ? new URL(".", scriptSrc).href : new URL("assets/js/", location.href).href;
  var THREE_URL = new URL("../vendor/three/three.module.min.js", BASE).href;

  function $(id) { return document.getElementById(id); }
  function cssVar(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }
  function onVisible(el, cb, opts) {
    if (!("IntersectionObserver" in window)) { cb(); return; }
    var io = new IntersectionObserver(function (entries) {
      if (!entries.some(function (e) { return e.isIntersecting; })) return;
      io.disconnect();
      cb();
    }, opts || { threshold: 0.35 });
    io.observe(el);
  }

  var packEl = $("ir-pack"), stage = $("cap-stage"), canvas = $("cap-canvas"), box = $("cap-box");
  var dims = $("cap-dims"), nextBtn = $("cap-next"), rail = $("ir-pack-rail"), slot = $("ir-pack-slot");
  if (!packEl || !stage || !box) return;

  var pack = null;   /* the three.js adapter, once loaded */
  var current = 0;   /* index into core.SAMPLE_PACKS */

  /* ======================= the survey pack ======================= */
  function sizeFor(i) {
    var p = core.SAMPLE_PACKS[i];
    return { w: p[0], h: p[1], size: core.packSize(String(p[0]), String(p[1]), 2.2) };
  }
  function showSize(i, instant) {
    var s = sizeFor(i);
    if (!s.size) return;
    /* CSS fallback box: 2.2 world units ≈ 56% of the stage height */
    var k = (stage.clientHeight || 200) * 0.56 / 2.2;
    box.style.setProperty("--bw", (s.size.x * k).toFixed(1) + "px");
    box.style.setProperty("--bh", (s.size.y * k).toFixed(1) + "px");
    box.style.setProperty("--bd", (s.size.z * k).toFixed(1) + "px");
    if (dims) dims.textContent = s.w + " × " + s.h + " × " + s.size.depthCm + " cm";
    if (pack) pack.resize(s.size, instant);
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", function () {
      current = core.nextPack(current);
      showSize(current);
      if (pack) pack.celebrate();
    });
  }

  /* ---- where the pack lives: on the first screen, or riding above the stack ---- */
  var stackMq = window.matchMedia(STACK_QUERY);
  function placeInRail() {
    var chapter = slot.closest(".ir-chapter");
    var shots = slot.parentNode;
    if (!chapter || !shots) return;
    /* offsets ignore transforms, so the chapter's scale-down does not skew this */
    var w = Math.round(Math.max(170, Math.min(240, shots.offsetWidth * 0.28)));
    packEl.style.setProperty("--pack-w", w + "px");
    var h = packEl.offsetHeight || w * 1.4;
    var left = shots.offsetLeft - w * 0.18;
    /* every chapter passes under the pack, so it has to fit inside the shortest */
    var floor = Math.min.apply(null, Array.prototype.map.call(section.querySelectorAll(".ir-chapter"), function (c) { return c.offsetHeight; }));
    var top = Math.min(shots.offsetTop + shots.offsetHeight - h * 0.82, floor - h - 30);
    packEl.style.setProperty("--pack-left", Math.round(left) + "px");
    packEl.style.setProperty("--pack-top", Math.round(Math.max(0, top)) + "px");
  }
  function place() {
    var floating = !!(rail && stackMq.matches);
    var host = floating ? rail : slot;
    if (packEl.parentNode !== host) host.appendChild(packEl);
    packEl.classList.toggle("is-floating", floating);
    if (floating) placeInRail();
    else ["--pack-w", "--pack-left", "--pack-top"].forEach(function (k) { packEl.style.removeProperty(k); });
    showSize(current, true);
    if (pack) pack.fit();
  }
  if (stackMq.addEventListener) stackMq.addEventListener("change", place);
  else if (stackMq.addListener) stackMq.addListener(place);
  window.addEventListener("resize", function () { if (packEl.classList.contains("is-floating")) placeInRail(); });
  place();

  /* ---- the three.js pack ---- */
  function probeWebGL2() {
    try {
      var gl = window.WebGL2RenderingContext && document.createElement("canvas").getContext("webgl2");
      if (!gl) return false;
      var lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
      return true;
    } catch (e) { return false; }
  }
  function packFail(err) {
    stage.dataset.pack = "error";
    if (window.console && console.warn) console.warn("[ir-showcase] pack: " + (err && err.message ? err.message : String(err)));
  }
  if (saveData) stage.dataset.pack = "save-data";
  else {
    onVisible(section.querySelector(".ir-chapters") || stage, function () {
      if (!probeWebGL2()) { stage.dataset.pack = "no-webgl2"; return; }
      stage.dataset.pack = "loading";
      import(THREE_URL).then(function (THREE) {
        try {
          pack = buildPack(THREE, stage, canvas);
          stage.classList.add("is-webgl");
          stage.dataset.pack = "live";
          showSize(current, true);
        } catch (err) { packFail(err); }
      }, packFail);
    }, { rootMargin: "400px 0px", threshold: 0 });
  }

  /* A small on-demand three.js scene: one carton, its edges, a contact shadow.
     Frames draw only while the stage is on screen and something moves. */
  function buildPack(THREE, stage, canvas) {
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(0, 0.55, 6.4);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x223, 1.4));
    var key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-2.5, 3, 4);
    scene.add(key);

    var group = new THREE.Group();
    scene.add(group);

    function labelTexture(colors) {
      var c = document.createElement("canvas");
      c.width = 256; c.height = 512;
      var g = c.getContext("2d");
      var grad = g.createLinearGradient(0, 0, 256, 512);
      grad.addColorStop(0, colors.accent); grad.addColorStop(1, colors.deep);
      g.fillStyle = grad; g.fillRect(0, 0, 256, 512);
      g.fillStyle = "rgba(255,255,255,0.9)"; g.fillRect(0, 300, 256, 14);
      g.fillStyle = "rgba(255,255,255,0.95)";
      g.font = "italic 300 64px Fraunces, Georgia, serif"; g.textAlign = "center";
      g.fillText("sample", 128, 200);
      g.font = "600 22px system-ui, sans-serif";
      g.fillText("320 ml", 128, 250);
      /* a barcode block, drawn from the sample code's digits */
      g.fillStyle = "#fff"; g.fillRect(58, 380, 140, 78);
      g.fillStyle = "#111";
      var digits = "9551234000706", x = 66;
      for (var i = 0; i < digits.length && x < 190; i++) {
        var d = Number(digits[i]);
        g.fillRect(x, 388, 1 + (d % 3), 56); x += 3 + (d % 4);
      }
      var t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    }
    function readColors() {
      return { accent: cssVar("--accent") || "#9ba1ff", deep: cssVar("--accent-deep") || "#5c62d8", hover: cssVar("--accent-hover") || "#b3b7ff" };
    }

    var colors = readColors();
    var side = new THREE.MeshStandardMaterial({ color: colors.deep, roughness: 0.5, metalness: 0.05 });
    var top = new THREE.MeshStandardMaterial({ color: colors.hover, roughness: 0.45 });
    var front = new THREE.MeshStandardMaterial({ map: labelTexture(colors), roughness: 0.42 });
    var geo = new THREE.BoxGeometry(1, 1, 1);
    /* face order: +x, -x, +y, -y, +z (front), -z */
    var mesh = new THREE.Mesh(geo, [side, side, top, side, front, side]);
    var edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: colors.hover, transparent: true, opacity: 0.55 }));
    mesh.add(edges);
    group.add(mesh);

    /* contact shadow: a radial-gradient sprite on the floor */
    var sc = document.createElement("canvas"); sc.width = sc.height = 128;
    var sg = sc.getContext("2d");
    var rg = sg.createRadialGradient(64, 64, 4, 64, 64, 64);
    rg.addColorStop(0, "rgba(0,0,0,0.45)"); rg.addColorStop(1, "rgba(0,0,0,0)");
    sg.fillStyle = rg; sg.fillRect(0, 0, 128, 128);
    var shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    scene.add(shadow);

    var yaw = -0.6, pitch = 0.12, vel = reduced ? 0 : 0.35, dragging = false, lastX = 0, lastT = 0;
    var visible = false, raf = 0, last = 0, bob = 0;

    function placeShadow() {
      var half = mesh.scale.y / 2;
      shadow.position.y = -half - 0.02;
      shadow.scale.set(mesh.scale.x * 1.9, mesh.scale.z * 2.6 + 0.4, 1);
      group.position.y = 0.05;
    }
    function sizeCanvas() {
      var r = stage.getBoundingClientRect();
      if (!r.width || !r.height) return;
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / r.height;
      camera.updateProjectionMatrix();
    }
    function draw() {
      group.rotation.y = yaw;
      group.rotation.x = pitch + Math.sin(bob) * 0.03;
      renderer.render(scene, camera);
    }
    function loop(t) {
      raf = 0;
      var dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016;
      last = t;
      if (!dragging) { yaw += vel * dt; if (!reduced) vel += (0.35 - vel) * Math.min(1, dt * 1.5); }
      if (!reduced) bob += dt * 1.6;
      draw();
      if (visible && !reduced) raf = requestAnimationFrame(loop);
    }
    function kick() { if (!raf) { last = 0; raf = requestAnimationFrame(loop); } }

    /* drag to turn the pack; a flick keeps it spinning, then it settles back to idle */
    stage.addEventListener("pointerdown", function (e) {
      dragging = true; lastX = e.clientX; lastT = performance.now();
      if (stage.setPointerCapture) stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var now = performance.now(), dx = e.clientX - lastX;
      yaw += dx * 0.012;
      vel = (dx * 0.012) / Math.max(0.008, (now - lastT) / 1000);
      lastX = e.clientX; lastT = now;
      kick();
    });
    function release() { dragging = false; if (reduced) vel = 0; kick(); }
    stage.addEventListener("pointerup", release);
    stage.addEventListener("pointercancel", release);

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) kick();
      }).observe(stage);
    } else { visible = true; }
    window.addEventListener("resize", function () { sizeCanvas(); kick(); });

    /* scrolling past gives the pack a push, in the direction of travel */
    var lastScroll = window.scrollY;
    if (!reduced) {
      window.addEventListener("scroll", function () {
        var dy = window.scrollY - lastScroll;
        lastScroll = window.scrollY;
        if (!visible || dragging) return;
        vel = Math.max(-6, Math.min(6, vel + dy * 0.006));
        kick();
      }, { passive: true });
    }

    /* palette follows the theme toggle and the OS preference */
    function recolor() {
      colors = readColors();
      side.color.set(colors.deep);
      top.color.set(colors.hover);
      edges.material.color.set(colors.hover);
      if (front.map) front.map.dispose();
      front.map = labelTexture(colors);
      front.needsUpdate = true;
      kick();
    }
    new MutationObserver(recolor).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    var scheme = window.matchMedia("(prefers-color-scheme: light)");
    if (scheme.addEventListener) scheme.addEventListener("change", recolor);

    sizeCanvas();
    mesh.scale.set(0.8, 2, 0.34);
    placeShadow();
    draw();

    return {
      fit: function () { sizeCanvas(); kick(); draw(); },
      resize: function (size, instant) {
        if (!size) return;
        if (!gsap || reduced || instant) {
          mesh.scale.set(size.x, size.y, size.z); placeShadow(); kick(); draw(); return;
        }
        gsap.to(mesh.scale, { x: size.x, y: size.y, z: size.z, duration: 0.7, ease: "elastic.out(1, 0.7)",
          overwrite: true, onUpdate: function () { placeShadow(); kick(); } });
      },
      celebrate: function () {
        if (!gsap || reduced) return;
        vel = 9;
        gsap.fromTo(group.position, { y: 0.05 }, { y: 0.35, duration: 0.35, yoyo: true, repeat: 1, ease: "power2.out", onUpdate: kick });
        kick();
      }
    };
  }

  /* ======================= step pills follow the chapter in view ======================= */
  /* The chapters stack (sticky) on tall screens, so "in view" is ambiguous: the
     active one is the last whose top has passed the middle of the viewport. */
  (function steps() {
    var links = Array.prototype.slice.call(section.querySelectorAll(".ir-steps a"));
    var chapters = Array.prototype.slice.call(section.querySelectorAll(".ir-chapter"));
    if (!links.length || !chapters.length) return;
    var shown = -1, queued = false;
    function sync() {
      queued = false;
      var mid = window.innerHeight * 0.55, active = 0;
      chapters.forEach(function (c, i) { if (c.getBoundingClientRect().top <= mid) active = i; });
      if (active === shown) return;
      var first = shown < 0;
      shown = active;
      links.forEach(function (a, i) { a.classList.toggle("is-active", i === active); });
      /* a new screen slid in under the floating pack: give it a turn */
      if (!first && pack && packEl.classList.contains("is-floating")) pack.celebrate();
    }
    window.addEventListener("scroll", function () {
      if (!queued) { queued = true; requestAnimationFrame(sync); }
    }, { passive: true });
    sync();
  })();
})();
