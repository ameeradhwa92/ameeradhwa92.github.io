# ameeradhwa92.github.io

Personal portfolio of **Ameer Adhwa Bin Mohamad** — Full Stack Web Specialist
(ASP.NET Core · React · Azure DevOps · Multi-Tenant SaaS · Mobile).

A single scrollable career timeline, 2010 → today: from a Diploma in Computer
Science at UiTM Dungun to building **RetailAIM® Plus**, a multi-tenant SaaS
platform serving 20+ FMCG brands across Southeast Asia — and, newest, the **RetailAIM IR**
platform, shown through its IR Workforce screens (demo mode) with the product survey's 3D
pack floating over them.

**Live:** https://ameeradhwa92.github.io/

## Structure

```
index.html            The entire one-page site
assets/css/style.css  All styling (dark editorial theme, CSS custom properties)
assets/js/main.js     Theme, language, progress bar, self-drawing timeline spine, reveals
assets/js/motion.js   GSAP choreography — split-line headings, stacked chapters, cursor, marquees
assets/js/ir-*.js     RetailAIM IR showcase (pure rules + DOM/three.js demos)
assets/vendor/        Self-hosted GSAP, three.js, PDF.js, JSZip (pins in assets/vendor/README.md)
assets/img/           Profile photo + real project screenshots
assets/fonts/         Self-hosted Fraunces (no CDN — the page renders fully offline)
assets/resume/        Downloadable résumé (PDF)
docs/                 Design spec / master prompt (not part of the published page)
```

Hand-built static HTML/CSS/JS — no frameworks, no build step; libraries are vendored, not fetched. Published from
the repo root by GitHub Pages (`.nojekyll` disables Jekyll processing).
