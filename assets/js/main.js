/* The Journey — scroll choreography, theming and language. No dependencies. */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var root = document.documentElement;

  /* --- theme: follows the device by default; toggle overrides and persists --- */
  var themeBtn = document.getElementById("theme-toggle");
  function effectiveTheme() {
    if (root.dataset.theme) return root.dataset.theme;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  function syncThemeColor() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = effectiveTheme() === "light" ? "#f4f2ec" : "#0b0e10";
  }
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var next = effectiveTheme() === "light" ? "dark" : "light";
      root.dataset.theme = next;
      try { localStorage.setItem("theme", next); } catch (e) {}
      syncThemeColor();
    });
  }
  syncThemeColor();

  /* --- language: EN/BM. English lives in the DOM; BM comes from i18n.js --- */
  var langBtn = document.getElementById("lang-toggle");
  var EN = {};
  document.querySelectorAll("[data-i18n]").forEach(function (el) {
    var k = el.getAttribute("data-i18n");
    if (!(k in EN)) EN[k] = el.innerHTML;
  });
  EN["meta.title"] = document.title;
  EN["meta.desc"] = (document.querySelector('meta[name="description"]') || {}).content || "";

  function setLang(lang) {
    var dict = lang === "ms" ? (window.I18N_MS || {}) : EN;
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var k = el.getAttribute("data-i18n");
      if (dict[k] != null) el.innerHTML = dict[k];
    });
    document.title = dict["meta.title"] || EN["meta.title"];
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.content = dict["meta.desc"] || EN["meta.desc"];
    root.lang = lang;
    root.dataset.lang = lang;
    if (langBtn) langBtn.textContent = lang === "ms" ? "EN" : "BM";
    try { localStorage.setItem("lang", lang); } catch (e) {}
  }
  var initialLang = root.dataset.lang === "ms" ? "ms" : "en";
  if (initialLang === "ms") setLang("ms");
  else if (langBtn) langBtn.textContent = "BM";
  if (langBtn) {
    langBtn.addEventListener("click", function () {
      setLang(root.lang === "ms" ? "en" : "ms");
    });
  }

  /* --- top progress bar --- */
  var bar = document.querySelector(".progress");
  /* --- timeline spine that draws itself --- */
  var timeline = document.getElementById("timeline");
  var spine = document.querySelector(".spine-progress");

  function onScroll() {
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    if (bar && max > 0) {
      bar.style.width = (window.scrollY / max) * 100 + "%";
    }
    if (timeline && spine) {
      var rect = timeline.getBoundingClientRect();
      var anchor = window.innerHeight * 0.65; /* the route draws to 65% of viewport */
      var progress = Math.min(Math.max(anchor - rect.top, 0), rect.height);
      spine.style.height = progress + "px";
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();

  /* --- reveal on approach + light the era nodes --- */
  var targets = document.querySelectorAll(".reveal, .era");
  if ("IntersectionObserver" in window && !reduced) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add(
              entry.target.classList.contains("era") ? "lit" : "in"
            );
            if (entry.target.classList.contains("era")) {
              entry.target.classList.add("in");
            }
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.06 }
    );
    targets.forEach(function (t) { io.observe(t); });
  } else {
    targets.forEach(function (t) { t.classList.add("in", "lit"); });
  }

  /* --- ambient cursor glow + card spotlights (pointer devices only) --- */
  var fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (fine && !reduced) {
    var glow = document.querySelector(".cursor-glow");
    var gx = 0, gy = 0, tx = -600, ty = -600, raf = null;

    function tick() {
      gx += (tx - gx) * 0.08;
      gy += (ty - gy) * 0.08;
      glow.style.transform = "translate3d(" + gx + "px," + gy + "px,0)";
      if (Math.abs(tx - gx) + Math.abs(ty - gy) > 0.4) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = null;
      }
    }

    document.addEventListener("pointermove", function (e) {
      tx = e.clientX; ty = e.clientY;
      if (glow && !glow.classList.contains("on")) {
        gx = tx; gy = ty;
        glow.classList.add("on");
      }
      if (glow && raf === null) raf = requestAnimationFrame(tick);

      var host = e.target.closest && e.target.closest(".card, .skill-group, .edu-card");
      if (host) {
        var r = host.getBoundingClientRect();
        host.style.setProperty("--mx", (e.clientX - r.left) + "px");
        host.style.setProperty("--my", (e.clientY - r.top) + "px");
      }
    }, { passive: true });
  }
})();
