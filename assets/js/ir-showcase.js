/* RetailAIM IR showcase — the DOM half. Wires the three workflow demos in
   #work (capture, recognise, resolve) to the rules in ir-core.js, and renders
   the capture demo's pack with the vendored three.js when the device can.
   Everything here runs on sample data; the production app is private.

   Off the happy path (no WebGL2, save-data, a failed import) the pack stays
   the CSS 3D box it renders without JS and the reason is written to
   #cap-stage's data-pack. Reduced motion keeps every demo working, without
   the idle spin, sweeps or count-ups. */
(function () {
  "use strict";

  var core = window.IR_CORE;
  var section = document.getElementById("work");
  if (!core || !section) return;

  var gsap = window.gsap || null;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var saveData = !!(navigator.connection && navigator.connection.saveData);
  var root = document.documentElement;

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
  /* count a number up (or down) in place; instant under reduced motion */
  function countTo(el, to, opts) {
    if (!el) return;
    var o = opts || {};
    var from = parseFloat(el.textContent) || 0;
    var fmt = function (v) { return (o.decimals ? v.toFixed(o.decimals) : String(Math.round(v))) + (o.suffix || ""); };
    if (!gsap || reduced) { el.textContent = fmt(to); return; }
    var box = { v: from };
    gsap.to(box, { v: to, duration: o.duration || 0.9, ease: "power3.out", overwrite: true,
      onUpdate: function () { el.textContent = fmt(box.v); } });
  }

  /* ======================= 01 · capture ======================= */
  (function capture() {
    var stage = $("cap-stage"), canvas = $("cap-canvas"), box = $("cap-box"), dims = $("cap-dims");
    var barcode = $("cap-barcode"), scanBtn = $("cap-scan"), check = $("cap-check"), status = $("cap-status");
    var w = $("cap-w"), h = $("cap-h"), wr = $("cap-w-range"), hr = $("cap-h-range");
    var inc = $("cap-inc"), done = $("cap-done"), form = $("cap-form");
    if (!stage || !barcode || !w || !h) return;

    var SAMPLE_CODE = "9551234000706";   /* a valid EAN-13 under the Malaysian GS1 prefix */
    var BASE_INC = 3, BASE_DONE = 9;
    var pack = null;                     /* the three.js adapter, once loaded */
    var scanning = false;

    function update() {
      var size = core.packSize(w.value, h.value, 2.2);
      if (size) {
        /* CSS fallback box: the stage is ~170px tall, so 2.2 world units ≈ 124px */
        var k = 124 / 2.2;
        box.style.setProperty("--bw", (size.x * k).toFixed(1) + "px");
        box.style.setProperty("--bh", (size.y * k).toFixed(1) + "px");
        box.style.setProperty("--bd", (size.z * k).toFixed(1) + "px");
        dims.textContent = core.parseCm(w.value) + " × " + core.parseCm(h.value) + " × " + size.depthCm + " cm";
        if (pack) pack.resize(size);
      }
      var code = barcode.value.replace(/\s+/g, "");
      check.setAttribute("data-state", code === "" ? "empty" : core.isValidGtin(code) ? "ok" : "bad");
      var state = core.surveyStatus({ barcode: code, width: w.value, height: h.value });
      if (status.getAttribute("data-state") !== state) {
        status.setAttribute("data-state", state);
        var completed = state === "completed";
        inc.textContent = String(BASE_INC - (completed ? 1 : 0));
        done.textContent = String(BASE_DONE + (completed ? 1 : 0));
        if (completed && gsap && !reduced) {
          gsap.fromTo(status, { scale: 0.94 }, { scale: 1, duration: 0.6, ease: "back.out(3)" });
          if (pack) pack.celebrate();
        }
      }
    }

    function syncFromText(text, range) {
      var v = core.parseCm(text.value);
      if (v != null) range.value = String(Math.min(Number(range.max), v));
      update();
    }
    function syncFromRange(range, text) { text.value = range.value; update(); }
    w.addEventListener("input", function () { syncFromText(w, wr); });
    h.addEventListener("input", function () { syncFromText(h, hr); });
    wr.addEventListener("input", function () { syncFromRange(wr, w); });
    hr.addEventListener("input", function () { syncFromRange(hr, h); });
    barcode.addEventListener("input", function () {
      barcode.value = barcode.value.replace(/[^\d]/g, "").slice(0, 13);
      update();
    });
    form.addEventListener("submit", function (e) { e.preventDefault(); });

    scanBtn.addEventListener("click", function () {
      if (scanning) return;
      if (reduced) { barcode.value = SAMPLE_CODE; update(); return; }
      scanning = true;
      barcode.value = "";
      update();
      stage.classList.remove("is-scanning");
      void stage.offsetWidth;
      stage.classList.add("is-scanning");
      var i = 0;
      setTimeout(function type() {
        barcode.value = SAMPLE_CODE.slice(0, ++i);
        update();
        if (i < SAMPLE_CODE.length) setTimeout(type, 45);
        else { stage.classList.remove("is-scanning"); scanning = false; }
      }, 1300);
    });

    update();

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
    if (saveData) { stage.dataset.pack = "save-data"; return; }
    onVisible(stage, function () {
      if (!probeWebGL2()) { stage.dataset.pack = "no-webgl2"; return; }
      stage.dataset.pack = "loading";
      import(THREE_URL).then(function (THREE) {
        try {
          pack = buildPack(THREE, stage, canvas);
          stage.classList.add("is-webgl");
          stage.dataset.pack = "live";
          update();
          pack.resize(core.packSize(w.value, h.value, 2.2), true);
        } catch (err) { packFail(err); }
      }, packFail);
    }, { rootMargin: "400px 0px" });
    function packFail(err) {
      stage.dataset.pack = "error";
      if (window.console && console.warn) console.warn("[ir-showcase] pack: " + (err && err.message ? err.message : String(err)));
    }
  })();

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

  /* ======================= 02 · recognise ======================= */
  (function recognise() {
    var shelf = $("rec-shelf"), photo = shelf && shelf.parentNode;
    var countEl = $("rec-count"), totalEl = $("rec-total"), list = $("rec-kpis"), spark = $("rec-spark");
    if (!shelf || !list) return;
    var units = section.querySelectorAll(".rec-units button");
    var ROWS = 3, PER_ROW = 7, TOTAL = ROWS * PER_ROW;
    /* sample data: which facings are empty, the KPIs and the client's hurdle rates */
    var DATA = {
      a: { gaps: [3, 9, 16], sos: 44, promo: 78, hurdle: { osa: 80, sos: 40, promo: 75 }, traffic: [42, 55, 48, 61, 70, 52, 78] },
      b: { gaps: [1, 5, 8, 12, 19], sos: 37, promo: 69, hurdle: { osa: 85, sos: 35, promo: 70 }, traffic: [30, 38, 51, 44, 36, 58, 63] }
    };
    var facings = [];
    var seed = 7;
    function rand() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    for (var r = 0; r < ROWS; r++) {
      var row = document.createElement("div");
      row.className = "rec-row";
      for (var i = 0; i < PER_ROW; i++) {
        var f = document.createElement("span");
        f.className = "facing";
        f.style.setProperty("--h", (58 + Math.round(rand() * 34)) + "%");
        f.style.setProperty("--a", (0.35 + rand() * 0.45).toFixed(2));
        row.appendChild(f);
        facings.push(f);
      }
      shelf.appendChild(row);
    }
    if (totalEl) totalEl.textContent = String(TOTAL);
    var timers = [];
    function clearTimers() { timers.forEach(clearTimeout); timers = []; }

    function run(unit) {
      var d = DATA[unit];
      clearTimers();
      units.forEach(function (b) {
        var on = b.getAttribute("data-unit") === unit;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      var gapSet = {};
      d.gaps.forEach(function (g) { gapSet[g] = true; });
      var found = TOTAL - d.gaps.length;
      var osa = core.compliance(found, TOTAL, d.hurdle.osa);
      var kpis = {
        osa: { pct: osa.pct, pass: osa.pass, hurdle: d.hurdle.osa },
        sos: { pct: d.sos, pass: d.sos >= d.hurdle.sos, hurdle: d.hurdle.sos },
        promo: { pct: d.promo, pass: d.promo >= d.hurdle.promo, hurdle: d.hurdle.promo }
      };
      function finish() {
        Array.prototype.forEach.call(list.children, function (li) {
          var k = kpis[li.getAttribute("data-kpi")];
          var bar = li.querySelector(".rec-bar");
          bar.style.setProperty("--v", k.pct + "%");
          bar.style.setProperty("--hurdle", k.hurdle + "%");
          li.classList.toggle("is-under", !k.pass);
          countTo(li.querySelector(".rec-v"), k.pct, { suffix: "%", decimals: k.pct % 1 ? 1 : 0 });
        });
        Array.prototype.forEach.call(spark.children, function (bar, i) {
          bar.style.setProperty("--h", d.traffic[i] + "%");
        });
      }
      facings.forEach(function (f, i) {
        f.classList.remove("is-hit");
        f.classList.toggle("is-gap", !!gapSet[i]);
      });
      if (reduced) {
        facings.forEach(function (f) { f.classList.add("is-hit"); });
        countEl.textContent = String(found);
        finish();
        return;
      }
      countEl.textContent = "0";
      photo.classList.remove("is-scanning");
      void photo.offsetWidth;
      photo.classList.add("is-scanning");
      var hits = 0;
      facings.forEach(function (f, i) {
        timers.push(setTimeout(function () {
          f.classList.add("is-hit");
          if (!gapSet[i]) countEl.textContent = String(++hits);
        }, 420 + i * 55));
      });
      timers.push(setTimeout(finish, 420 + TOTAL * 55 - 300));
    }

    units.forEach(function (b) {
      b.addEventListener("click", function () { run(b.getAttribute("data-unit")); });
    });
    onVisible(photo, function () { run("a"); });
  })();

  /* ======================= 03 · resolve ======================= */
  (function resolve() {
    var listEl = $("res-lines"), tiles = $("res-kpis"), tallyEl = $("res-tally"), task = $("res-task");
    var approveBtn = $("res-approve"), rejectBtn = $("res-reject"), resetBtn = $("res-reset");
    if (!listEl || !tiles) return;
    var items = Array.prototype.slice.call(listEl.children);
    var baseline = {};
    Array.prototype.forEach.call(tiles.children, function (t) {
      baseline[t.getAttribute("data-kpi")] = Number(t.querySelector("b").textContent);
    });
    function fresh() {
      return items.map(function (li) {
        return { id: li.getAttribute("data-id"), kpi: li.getAttribute("data-kpi"), restores: Number(li.getAttribute("data-restores")) };
      });
    }
    var lines = fresh(), selected = [];

    function render(prevKpis) {
      var byId = {};
      lines.forEach(function (l) { byId[l.id] = l; });
      items.forEach(function (li) {
        var line = byId[li.getAttribute("data-id")];
        var box = li.querySelector("input");
        if (line.verdict) li.setAttribute("data-verdict", line.verdict); else li.removeAttribute("data-verdict");
        box.disabled = !!line.verdict;
        box.checked = selected.indexOf(line.id) >= 0;
        li.classList.toggle("is-selected", box.checked);
      });
      approveBtn.disabled = rejectBtn.disabled = selected.length === 0;
      approveBtn.querySelector(".res-n").textContent = String(selected.length);
      var kpis = core.kpisAfter(baseline, lines);
      Array.prototype.forEach.call(tiles.children, function (t) {
        var k = t.getAttribute("data-kpi");
        var changed = prevKpis && prevKpis[k] !== kpis[k];
        countTo(t.querySelector("b"), kpis[k]);
        if (changed) {
          t.classList.add("is-bumped");
          setTimeout(function () { t.classList.remove("is-bumped"); }, 1400);
        }
      });
      var tally = core.tally(lines);
      ["pending", "approve", "reject"].forEach(function (key) {
        var el = tallyEl.querySelector('[data-t="' + key + '"]');
        if (el) el.textContent = String(tally[key]);
      });
      var closed = tally.pending === 0;
      if (closed && task.hidden) {
        task.hidden = false;
        if (gsap && !reduced) gsap.from(task, { y: 16, opacity: 0, duration: 0.7, ease: "power3.out" });
      } else if (!closed) {
        task.hidden = true;
      }
      return kpis;
    }

    listEl.addEventListener("change", function (e) {
      if (!e.target || e.target.type !== "checkbox") return;
      selected = core.toggleSelection(selected, e.target.value);
      render();
    });
    function judge(verdict) {
      if (!selected.length) return;
      var before = core.kpisAfter(baseline, lines);
      var judged = selected.slice();
      lines = core.applyVerdict(lines, selected, verdict);
      selected = [];
      render(before);
      if (gsap && !reduced) {
        judged.forEach(function (id, i) {
          var li = listEl.querySelector('[data-id="' + id + '"]');
          if (li) gsap.fromTo(li, { x: verdict === "approve" ? 10 : -10 }, { x: 0, duration: 0.5, delay: i * 0.05, ease: "power3.out" });
        });
      }
    }
    approveBtn.addEventListener("click", function () { judge("approve"); });
    rejectBtn.addEventListener("click", function () { judge("reject"); });
    resetBtn.addEventListener("click", function () {
      var before = core.kpisAfter(baseline, lines);
      lines = fresh(); selected = [];
      render(before);
    });
    render();
  })();

  /* ======================= step pills follow the chapter in view ======================= */
  /* The chapters stack (sticky) on tall screens, so "in view" is ambiguous: the
     active one is the last whose top has passed the middle of the viewport. */
  (function steps() {
    var links = Array.prototype.slice.call(section.querySelectorAll(".ir-steps a"));
    var chapters = Array.prototype.slice.call(section.querySelectorAll(".ir-chapter"));
    if (!links.length || !chapters.length) return;
    var current = -1, queued = false;
    function sync() {
      queued = false;
      var mid = window.innerHeight * 0.55, active = 0;
      chapters.forEach(function (c, i) { if (c.getBoundingClientRect().top <= mid) active = i; });
      if (active === current) return;
      current = active;
      links.forEach(function (a, i) { a.classList.toggle("is-active", i === active); });
    }
    window.addEventListener("scroll", function () {
      if (!queued) { queued = true; requestAnimationFrame(sync); }
    }, { passive: true });
    sync();
  })();
})();
