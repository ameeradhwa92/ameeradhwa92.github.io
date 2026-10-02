/* Page choreography — the 2026-10 redesign's motion layer, on the vendored GSAP.
   Owns: split-line heading reveals, stat count-ups, the stacked IR chapters and their screens,
   the scroll-velocity marquee, magnetic buttons, the custom cursor, the nav's
   hide-on-scroll and current-section dot, and the Shah Alam clock.

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
