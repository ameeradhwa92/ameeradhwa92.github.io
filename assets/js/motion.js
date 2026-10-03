/* Page choreography — the 2026-10 redesign's motion layer, on the vendored GSAP.
   Owns: split-line heading reveals, stat count-ups, the stacked IR chapters and their screens,
   the scroll-velocity marquee, magnetic buttons, the custom cursor, the nav's
   hide-on-scroll and current-section dot, the Shah Alam clock, and the AIMeer JD report
   settling (count-up, staggered sections, decision-confidence bars).

   Rules it keeps:
   - Nothing is hidden unless GSAP *and* ScrollTrigger loaded, so a failed vendor
     load leaves the page static and fully visible.
   - prefers-reduced-motion: no transforms, no splits, no count-ups.
   - Split headings are short-lived: split on entry, reverted when they land, so
     the i18n swap in main.js always writes into plain markup. A language switch
     mid-animation reverts first (capture-phase listener, before main.js runs). */
(function () {
  "use strict";

  var root = document.documentElement;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var gsap = window.gsap;
  var ScrollTrigger = window.ScrollTrigger;
  var SplitText = window.SplitText;

  /* ---- the clock in the nav: Malaysia time, whatever the visitor's zone ---- */
  var clock = document.getElementById("nav-time");
  function tickClock() {
    if (!clock) return;
    try {
      clock.textContent = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kuala_Lumpur" }).format(new Date());
    } catch (e) { clock.textContent = ""; }
  }
  tickClock();
  setInterval(tickClock, 30000);

  /* ---- nav: hide while reading down, return on the way up; mark the current section ---- */
  var nav = document.querySelector(".nav");
  var navLinks = Array.prototype.slice.call(document.querySelectorAll(".nav-links > a[href^='#']"));
  var targets = navLinks.map(function (a) { return document.querySelector(a.getAttribute("href")); });
  var lastY = window.scrollY, queued = false;
  function onScroll() {
    queued = false;
    var y = window.scrollY;
    if (nav && !reduced) {
      var chatOpen = document.body.classList.contains("modal-open");
      nav.classList.toggle("is-hidden", !chatOpen && y > 320 && y > lastY + 4);
      if (y < lastY - 4 || y < 320) nav.classList.remove("is-hidden");
    }
    lastY = y;
    var mid = window.innerHeight * 0.4, current = -1;
    targets.forEach(function (t, i) { if (t && t.getBoundingClientRect().top <= mid) current = i; });
    navLinks.forEach(function (a, i) { a.classList.toggle("is-current", i === current); });
  }
  window.addEventListener("scroll", function () {
    if (!queued) { queued = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  onScroll();
  /* keyboard users tabbing into a hidden nav get it back */
  if (nav) nav.addEventListener("focusin", function () { nav.classList.remove("is-hidden"); });

  if (!gsap || !ScrollTrigger || reduced) return;
  gsap.registerPlugin(ScrollTrigger);
  if (SplitText) gsap.registerPlugin(SplitText);

  /* ================= split-line headings ================= */
  var live = [];   /* {split, tween} pairs still mid-flight */
  function landHeading(entry) {
    if (entry.tween) entry.tween.progress(1).kill();
    if (entry.split) entry.split.revert();
    var at = live.indexOf(entry);
    if (at >= 0) live.splice(at, 1);
  }
  /* main.js swaps innerHTML on the language toggle; a split heading must be plain markup first */
  document.addEventListener("click", function (e) {
    if (e.target && e.target.closest && e.target.closest("#lang-toggle")) live.slice().forEach(landHeading);
  }, true);

  function revealLines(el, delay) {
    if (!SplitText) { gsap.fromTo(el, { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 1, delay: delay || 0, ease: "power4.out" }); return; }
    gsap.set(el, { autoAlpha: 1 });
    var split = SplitText.create(el, { type: "lines", mask: "lines", linesClass: "split-line" });
    var entry = { split: split, tween: null };
    live.push(entry);
    entry.tween = gsap.from(split.lines, {
      yPercent: 110, duration: 1.15, ease: "power4.out", stagger: 0.09, delay: delay || 0,
      onComplete: function () { landHeading(entry); }
    });
  }

  var headings = document.querySelectorAll(".section-head h2, .ir-title, .ir-engine-head h3, .contact h2, .ir-copy h3");
  headings.forEach(function (el) {
    gsap.set(el, { autoAlpha: 0 });
    ScrollTrigger.create({ trigger: el, start: "top 88%", once: true, onEnter: function () { revealLines(el); } });
  });

  /* the hero headline waits for the loader to release the page */
  var heroTitle = document.querySelector(".hero-title");
  if (heroTitle) {
    gsap.set(heroTitle, { autoAlpha: 0 });
    var heroDone = false;
    var playHero = function () {
      if (heroDone) return;
      heroDone = true;
      revealLines(heroTitle, 0.15);
    };
    if (root.classList.contains("revealed")) playHero();
    else {
      new MutationObserver(function (_, obs) {
        if (root.classList.contains("revealed")) { obs.disconnect(); playHero(); }
      }).observe(root, { attributes: true, attributeFilter: ["class"] });
      document.addEventListener("site:revealed", playHero);
    }
  }

  /* ================= count-ups ================= */
  function countUp(el) {
    var text = el.textContent.trim();
    var target = Number(el.getAttribute("data-count")) || parseInt(text.replace(/[^\d]/g, ""), 10);
    if (!isFinite(target)) return;
    var plus = /\+$/.test(text) ? "+" : "";
    var comma = text.indexOf(",") >= 0;
    var box = { v: 0 };
    el.textContent = "0" + plus;
    ScrollTrigger.create({
      trigger: el, start: "top 90%", once: true,
      onEnter: function () {
        gsap.to(box, { v: target, duration: 1.8, ease: "power3.out", onUpdate: function () {
          var n = Math.round(box.v);
          el.textContent = (comma ? n.toLocaleString("en-US") : String(n)) + plus;
        } });
      }
    });
  }
  document.querySelectorAll(".stat b, .ir-number b").forEach(countUp);

  /* ================= the IR chapters stack =================
     Only where style.css makes them sticky; the same query as there. */
  var mm = gsap.matchMedia();
  mm.add("(min-width: 1101px) and (min-height: 820px)", function () {
    var chapters = gsap.utils.toArray(".ir-chapter");
    chapters.forEach(function (chapter, i) {
      var next = chapters[i + 1];
      if (!next) return;
      gsap.to(chapter, {
        scale: 0.94, "--dim": 0.6, ease: "none",
        scrollTrigger: { trigger: next, start: "top 85%", end: "top 150px", scrub: true }
      });
    });
  });
  /* every width: the screens drift against their copy, the front one of a pair faster */
  gsap.utils.toArray(".ir-shots").forEach(function (shots) {
    var chapter = shots.closest(".ir-chapter") || shots;
    gsap.fromTo(shots, { y: 36 }, {
      y: -16, ease: "none",
      scrollTrigger: { trigger: chapter, start: "top bottom", end: "bottom top", scrub: 0.6 }
    });
    /* the handsets rise at slightly different speeds, like cards dealt onto the table */
    gsap.utils.toArray(shots.querySelectorAll(".ir-phone-shot")).forEach(function (phone, i) {
      gsap.fromTo(phone, { y: 40 + i * 18 }, {
        y: -i * 4, ease: "none",
        scrollTrigger: { trigger: chapter, start: "top bottom", end: "center center", scrub: 0.8 }
      });
    });
    var front = shots.querySelector(".ir-shot-front");
    if (front) {
      gsap.fromTo(front, { y: 50, x: 24 }, {
        y: -10, x: 0, ease: "none",
        scrollTrigger: { trigger: chapter, start: "top bottom", end: "center center", scrub: 0.8 }
      });
    }
  });

  /* ================= parallax portraits ================= */
  var portraitImg = document.querySelector(".portrait-frame img");
  if (portraitImg) {
    gsap.to(".portrait-frame", { yPercent: -8, ease: "none",
      scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
  }
  var contactImg = document.querySelector(".contact-photo img");
  if (contactImg) {
    gsap.fromTo(contactImg, { y: 40 }, { y: -30, ease: "none",
      scrollTrigger: { trigger: ".contact-grid", start: "top bottom", end: "bottom top", scrub: true } });
  }

  /* ================= scroll-velocity marquees =================
     The tracks are CSS animations; the Web Animations API lets the scroll speed
     them up (and reverse them) without GSAP owning their transform. */
  var tracks = Array.prototype.slice.call(document.querySelectorAll(".marquee-track, .contact-big-track"));
  var anims = tracks.map(function (t) { return t.getAnimations ? t.getAnimations()[0] : null; }).filter(Boolean);
  if (anims.length) {
    var rate = { v: 1 };
    var apply = function () { anims.forEach(function (a) { a.playbackRate = rate.v; }); };
    ScrollTrigger.create({
      onUpdate: function (self) {
        var v = self.getVelocity();
        var target = gsap.utils.clamp(-6, 6, 1 + v / 300);
        if (Math.abs(target) < 1) target = target < 0 ? -1 : 1;
        gsap.to(rate, { v: target, duration: 0.3, overwrite: true, onUpdate: apply });
        gsap.to(rate, { v: self.direction < 0 ? -1 : 1, duration: 1.2, delay: 0.3, ease: "power2.out", onUpdate: apply });
      }
    });
  }

  /* ================= the recruiter report settling =================
     chatbot.js fires aimeer:jd-report once when a JD match report settles. The report is plain DOM
     that chatbot.js rebuilds on every render (a language switch included), so everything here is
     a from() that clears its props: a re-render mid-flight simply lands in the final state, and
     the count-up stops writing the moment its node leaves the document. */
  document.addEventListener("aimeer:jd-report", function (e) {
    var report = document.querySelector("#chat-jd-result .jd-report");
    if (!report) return;
    gsap.from(report.children, {
      autoAlpha: 0, y: 14, duration: 0.6, ease: "power3.out", stagger: 0.06,
      clearProps: "opacity,visibility,transform"
    });
    var bars = report.querySelectorAll(".chat-jd-meter-bar");
    if (bars.length) {
      gsap.from(bars, { scaleX: 0, duration: 0.9, ease: "power3.out", stagger: 0.05, delay: 0.3, clearProps: "transform" });
    }
    var score = report.querySelector(".jd-report-score");
    var match = score && e.detail && e.detail.mode === "ai" ? score.textContent.match(/^(\d+)%/) : null;
    if (match) {
      var rest = score.textContent.slice(match[0].length);
      var box = { v: 0 };
      gsap.to(box, {
        v: Number(match[1]), duration: 1.1, ease: "power3.out",
        onUpdate: function () { if (score.isConnected) score.textContent = Math.round(box.v) + "%" + rest; }
      });
    }
  });

  /* ================= Private mode: the lock =================
     chatbot.js fires aimeer:private on every visible change of the Private switch or its box,
     BEFORE it touches the DOM: {from: {sw, view}, to: {sw, view}}, sw being off | on | loading |
     ready. So this handler can still measure the box and the download chip it is about to lose;
     it snapshots synchronously and animates in a microtask, after the new DOM is in and before
     the browser paints. style.css owns every end state (the shackle's pose is two registered
     custom properties on the switch), so a closed panel, a missing GSAP or reduced motion all
     land on the same picture. Two beats: consent closes the lock, ready seals the chat. */
  (function privateMotion() {
    var panel = document.getElementById("chat-panel");
    var sw = document.getElementById("chat-private");
    var box = document.getElementById("chat-private-box");
    if (!panel || !sw || !box) return;
    var icon = sw.querySelector(".chat-private-icon");
    var shackle = sw.querySelector(".lk-shackle");
    var body = sw.querySelector(".lk-body");
    var key = sw.querySelector(".lk-key");
    var ring = sw.querySelector(".lk-ring");
    var statusText = panel.querySelector(".chat-status-text");
    var statusDot = panel.querySelector(".chat-status .dot");
    if (!icon || !shackle || !body || !key || !ring) return;

    var tl = null, made = [], safety = 0;
    var SVG_PROPS = "transform,opacity,visibility";
    function cleanup() {
      var old = tl;
      tl = null;
      if (old) old.progress(1).kill();
      clearTimeout(safety);
      made.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
      made = [];
      sw.classList.remove("is-sealing");
      /* the shackle is animated through inline custom properties; dropping them hands it back to CSS */
      shackle.style.removeProperty("--lk-tilt");
      shackle.style.removeProperty("--lk-lift");
      gsap.set([body, key, ring], { clearProps: SVG_PROPS });
      gsap.set([icon, box], { clearProps: "transform,opacity,visibility,height,overflow" });
      if (statusText) gsap.set(statusText, { clearProps: "transform,opacity,visibility" });
      if (statusDot) gsap.set(statusDot, { clearProps: "transform" });
    }
    function relTo(el) {
      var r = el.getBoundingClientRect(), p = panel.getBoundingClientRect();
      return { x: r.left - p.left - panel.clientLeft, y: r.top - p.top - panel.clientTop, w: r.width, h: r.height };
    }
    function ghostOf(height) {
      var g = box.cloneNode(true);
      ["id", "role", "aria-live"].forEach(function (a) { g.removeAttribute(a); });
      g.setAttribute("aria-hidden", "true");
      g.setAttribute("inert", "");
      g.hidden = false;
      g.classList.add("is-ghost");
      g.style.height = height + "px";
      return g;
    }
    function lockPose(tilt, lift) { return { "--lk-tilt": tilt + "deg", "--lk-lift": lift + "px" }; }
    function ringPulse(at, to) {
      tl.fromTo(ring, { scale: 0.5, autoAlpha: 0.9, transformOrigin: "50% 50%" },
        { scale: to || 1.9, autoAlpha: 0, duration: 0.55, ease: "power2.out" }, at);
    }

    /* the hero moment: the shackle swings shut, drops in, the body takes the weight */
    function closeLock() {
      tl.fromTo(shackle, lockPose(-22, -2), { "--lk-tilt": "0deg", duration: 0.24, ease: "power2.in" }, 0)
        .to(shackle, { "--lk-lift": "0.9px", duration: 0.12, ease: "power3.in" }, 0.2)
        .to(body, { scaleY: 0.86, scaleX: 1.06, transformOrigin: "50% 100%", duration: 0.08, ease: "power2.out" }, 0.3)
        .to(shackle, { "--lk-lift": "0px", duration: 0.53, ease: "elastic.out(1, 0.45)" }, 0.32)
        .to(body, { scaleY: 1, scaleX: 1, duration: 0.5, ease: "elastic.out(1, 0.4)" }, 0.38);
      ringPulse(0.32);
    }
    function openLock(at) {
      tl.fromTo(shackle, lockPose(0, 0), { "--lk-lift": "-2.6px", duration: 0.16, ease: "power2.out" }, at)
        .to(shackle, { "--lk-tilt": "-22deg", duration: 0.42, ease: "back.out(2.2)" }, at + 0.1)
        .to(shackle, { "--lk-lift": "-2px", duration: 0.3, ease: "power2.out" }, at + 0.2);
    }
    /* the seal: the keyhole takes the chip, lights, nods, and an iris wash crosses the panel */
    function seal(at) {
      tl.add(function () { sw.classList.remove("is-sealing"); }, at)
        .fromTo(key, { scale: 0, transformOrigin: "50% 50%" }, { scale: 1, duration: 0.4, ease: "back.out(3)" }, at)
        .to(shackle, { keyframes: { "--lk-lift": ["0px", "0.7px", "0px"] }, duration: 0.3, ease: "power2.out" }, at)
        .to(icon, { keyframes: { rotationX: [0, 22, 0] }, transformPerspective: 60, duration: 0.36, ease: "power2.inOut" }, at);
      ringPulse(at, 2.1);
      var c = relTo(key), p = panel.getBoundingClientRect();
      var wash = document.createElement("div");
      wash.className = "chat-seal";
      wash.setAttribute("aria-hidden", "true");
      wash.style.left = (c.x + c.w / 2) + "px";
      wash.style.top = (c.y + c.h / 2) + "px";
      panel.appendChild(wash);
      made.push(wash);
      var reach = Math.ceil(2 * Math.sqrt(p.width * p.width + p.height * p.height) / 120);
      tl.fromTo(wash, { scale: 0.1, autoAlpha: 0.95 }, { scale: reach, autoAlpha: 0, duration: 0.9, ease: "power2.out" }, at + 0.04);
      if (statusText) tl.from(statusText, { yPercent: 60, autoAlpha: 0, duration: 0.4, ease: "power3.out" }, at + 0.07);
      if (statusDot) tl.from(statusDot, { scale: 1.7, duration: 0.45, ease: "back.out(2)" }, at + 0.07);
    }

    document.addEventListener("aimeer:private", function (e) {
      var d = e.detail || {}, from = d.from || {}, to = d.to || {};
      var closing = from.sw === "off" && to.sw !== "off";
      var opening = from.sw !== "off" && to.sw === "off";
      var toReady = to.sw === "ready" && from.sw !== "ready";
      /* on → loading follows consent within a microtask and changes nothing worth a beat; letting
         it through would cut the closing lock off mid-swing */
      if (!closing && !opening && !toReady && from.view === to.view) return;
      cleanup();
      if (!panel.classList.contains("open")) return;
      /* synchronous snapshot: the DOM is still the old one */
      var h0 = box.hidden ? 0 : box.offsetHeight;
      var leaving = from.view && from.view !== to.view ? ghostOf(h0) : null;
      var chip = box.querySelector(".chat-private-chip");
      var flyer = null, flyFrom = null, angle = -35;
      if (to.sw === "ready" && from.view === "progress" && chip) {
        flyFrom = relTo(chip);
        flyer = chip.cloneNode(true);
        var cube = chip.querySelector(".chat-private-cube");
        var anim = cube && cube.getAnimations ? cube.getAnimations()[0] : null;
        if (anim && anim.currentTime != null) angle = -35 + (anim.currentTime % 7000) / 7000 * 360;
      }
      Promise.resolve().then(function () {
        tl = gsap.timeline({ onComplete: cleanup });
        safety = setTimeout(cleanup, 2600);
        /* the box: a leaving view collapses as a ghost, a new one grows in */
        if (leaving && !to.view) {
          box.parentNode.insertBefore(leaving, box.nextSibling);
          made.push(leaving);
          var inner = leaving.querySelector(".chat-private-chip");
          if (inner && opening) tl.to(inner, { scale: 0, rotationY: 90, duration: 0.25, ease: "power2.in" }, 0);
          if (inner && flyer) gsap.set(inner, { autoAlpha: 0 });
          tl.to(leaving, { height: 0, autoAlpha: 0, paddingTop: 0, paddingBottom: 0, duration: 0.36, ease: "power3.inOut" }, 0.05);
        }
        if (to.view && to.view !== from.view) {
          var h1 = box.offsetHeight;
          tl.fromTo(box, { height: h0, autoAlpha: h0 ? 1 : 0, overflow: "hidden" },
            { height: h1, autoAlpha: 1, duration: h0 ? 0.35 : 0.42, ease: h0 ? "power3.inOut" : "power3.out" }, 0);
          /* two from()s on one node would record each other's start as their end, so the chip
             has its own fromTo and stays out of the stagger */
          var newChip = to.view === "progress" ? box.querySelector(".chat-private-chip") : null;
          var rows = Array.prototype.filter.call(box.children, function (n) { return n !== newChip; });
          tl.fromTo(rows, { y: 6, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.3, ease: "power2.out", stagger: 0.05, clearProps: "transform,opacity,visibility" }, 0.08);
          if (newChip) tl.fromTo(newChip, { scale: 0, rotationY: -140, autoAlpha: 0 },
            { scale: 1, rotationY: 0, autoAlpha: 1, duration: 0.6, ease: "back.out(1.7)", clearProps: "transform,opacity,visibility" }, 0.28);
          if (to.view === "failed") tl.to(box, { keyframes: { x: [0, -5, 4, -2, 0] }, duration: 0.42, ease: "power2.out" }, 0.1);
          if (to.view === "unsupported") {
            /* it tries to close, then springs back open: this browser cannot keep it */
            tl.fromTo(shackle, lockPose(-22, -2), { "--lk-tilt": "-6deg", duration: 0.14, ease: "power2.in" }, 0)
              .to(shackle, { "--lk-tilt": "-22deg", duration: 0.5, ease: "elastic.out(1, 0.35)" }, 0.14)
              .to(body, { keyframes: { x: [0, -1.4, 1.2, -0.6, 0] }, duration: 0.38 }, 0.12);
          }
          if (to.view === "offer") tl.to(shackle, { keyframes: { "--lk-lift": ["-2px", "-2.8px", "-2px"] }, duration: 0.5, ease: "sine.inOut" }, 0);
        }

        if (closing) closeLock();
        if (opening) openLock(0);

        if (toReady) {
          if (flyer && flyFrom) {
            /* the chip flies an arc into the keyhole, shrinking and turning to face it */
            sw.classList.add("is-sealing");
            flyer.classList.add("is-flying");
            flyer.setAttribute("aria-hidden", "true");
            flyer.style.left = flyFrom.x + "px";
            flyer.style.top = flyFrom.y + "px";
            panel.appendChild(flyer);
            made.push(flyer);
            var k = relTo(key);
            var dx = k.x + k.w / 2 - (flyFrom.x + flyFrom.w / 2), dy = k.y + k.h / 2 - (flyFrom.y + flyFrom.h / 2);
            var flyCube = flyer.querySelector(".chat-private-cube");
            /* x leads and y lags, so it travels along the panel and then drops into the keyhole
               instead of climbing across the avatar and title */
            tl.to(flyer, { x: dx, duration: 0.62, ease: "power2.out" }, 0)
              .to(flyer, { y: dy, duration: 0.62, ease: "power2.in" }, 0)
              .to(flyer, { scale: 0.32, duration: 0.62, ease: "power2.in" }, 0)
              .to(flyer, { autoAlpha: 0, duration: 0.12 }, 0.5);
            if (flyCube) tl.fromTo(flyCube, { rotationX: -24, rotationY: angle }, { rotationX: 0, rotationY: Math.ceil(angle / 360 + 1) * 360, duration: 0.62, ease: "power2.inOut" }, 0);
            seal(0.58);
          } else {
            seal(closing ? 0.45 : 0);
          }
        }
      });
    });

    /* an invitation, once per page view: the open shackle wiggles when the panel first opens */
    var invited = false;
    new MutationObserver(function () {
      if (invited || !panel.classList.contains("open")) return;
      invited = true;
      setTimeout(function () {
        if (tl || sw.hidden || sw.getAttribute("aria-checked") === "true" || !box.hidden) return;
        gsap.fromTo(shackle, lockPose(-22, -2), {
          keyframes: { "--lk-tilt": ["-22deg", "-32deg", "-17deg", "-25deg", "-22deg"] },
          duration: 0.9, ease: "sine.inOut",
          onComplete: function () { shackle.style.removeProperty("--lk-tilt"); shackle.style.removeProperty("--lk-lift"); }
        });
      }, 900);
    }).observe(panel, { attributes: true, attributeFilter: ["class"] });
  })();

  /* ================= pointer-only niceties ================= */
  if (!fine) return;

  /* magnetic buttons: they lean toward the pointer, then spring back */
  document.querySelectorAll(".btn, .hero-now, .nav-cta, .ir-steps a, .contact-links .btn").forEach(function (el) {
    var xTo = gsap.quickTo(el, "x", { duration: 0.5, ease: "power3.out" });
    var yTo = gsap.quickTo(el, "y", { duration: 0.5, ease: "power3.out" });
    el.addEventListener("pointermove", function (e) {
      var r = el.getBoundingClientRect();
      xTo((e.clientX - r.left - r.width / 2) * 0.28);
      yTo((e.clientY - r.top - r.height / 2) * 0.38);
    });
    el.addEventListener("pointerleave", function () {
      gsap.to(el, { x: 0, y: 0, duration: 0.9, ease: "elastic.out(1, 0.35)" });
    });
  });

  /* the hero portrait turns slightly toward the pointer */
  var frame = document.querySelector(".portrait-frame");
  var hero = document.querySelector(".hero");
  if (frame && hero) {
    gsap.set(frame, { transformPerspective: 900 });
    var rx = gsap.quickTo(frame, "rotationX", { duration: 0.8, ease: "power3.out" });
    var ry = gsap.quickTo(frame, "rotationY", { duration: 0.8, ease: "power3.out" });
    hero.addEventListener("pointermove", function (e) {
      var px = e.clientX / window.innerWidth - 0.5, py = e.clientY / window.innerHeight - 0.5;
      ry(px * 10); rx(-py * 8);
    });
    hero.addEventListener("pointerleave", function () { rx(0); ry(0); });
  }

  /* the screens lean toward the pointer, like a print turned to the light */
  gsap.utils.toArray(".ir-shots").forEach(function (shots) {
    gsap.set(shots, { transformPerspective: 1400 });
    var tx = gsap.quickTo(shots, "rotationY", { duration: 0.9, ease: "power3.out" });
    var tz = gsap.quickTo(shots, "rotationX", { duration: 0.9, ease: "power3.out" });
    shots.addEventListener("pointermove", function (e) {
      var r = shots.getBoundingClientRect();
      tx(((e.clientX - r.left) / r.width - 0.5) * 7);
      tz(-((e.clientY - r.top) / r.height - 0.5) * 5);
    });
    shots.addEventListener("pointerleave", function () { tx(0); tz(0); });
  });

  /* the cursor: a dot that tracks exactly and a ring that eases after it */
  var cursor = document.querySelector(".cursor");
  if (!cursor) return;
  var dot = cursor.querySelector(".cursor-dot"), ring = cursor.querySelector(".cursor-ring");
  var label = cursor.querySelector(".cursor-label");
  var LABELS = {
    hello: { en: "Hello", ms: "Helo" }, drag: { en: "Drag", ms: "Seret" },
    write: { en: "Write", ms: "Tulis" }
  };
  root.classList.add("has-cursor");
  gsap.set([dot, ring], { x: -100, y: -100 });
  var dx = gsap.quickTo(dot, "x", { duration: 0.08 }), dy = gsap.quickTo(dot, "y", { duration: 0.08 });
  var cx = gsap.quickTo(ring, "x", { duration: 0.45, ease: "power3.out" }), cy = gsap.quickTo(ring, "y", { duration: 0.45, ease: "power3.out" });
  window.addEventListener("pointermove", function (e) {
    dx(e.clientX); dy(e.clientY); cx(e.clientX); cy(e.clientY);
    var t = e.target && e.target.closest ? e.target : null;
    var tagged = t && t.closest("[data-cursor]");
    var key = tagged && tagged.getAttribute("data-cursor");
    var text = key && LABELS[key] ? LABELS[key][root.dataset.lang === "ms" ? "ms" : "en"] : "";
    if (label.textContent !== text) label.textContent = text;
    cursor.classList.toggle("has-label", !!text);
    cursor.classList.toggle("is-link", !text && !!(t && t.closest("a, button, label, input, [role='button']")));
  }, { passive: true });
  document.addEventListener("pointerleave", function () { gsap.to(cursor, { autoAlpha: 0, duration: 0.2 }); });
  document.addEventListener("pointerenter", function () { gsap.to(cursor, { autoAlpha: 1, duration: 0.2 }); });
})();
