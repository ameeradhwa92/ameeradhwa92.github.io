/* The Journey — scroll choreography. No dependencies. */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
