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
})();
