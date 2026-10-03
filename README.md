# ameeradhwa92.github.io

Personal portfolio of **Ameer Adhwa Bin Mohamad** — Full Stack Web Specialist
(ASP.NET Core · React · Azure DevOps · Multi-Tenant SaaS · Mobile).

A single scrollable career timeline, 2010 → today: from a Diploma in Computer
Science at UiTM Dungun to building **RetailAIM® Plus**, a multi-tenant SaaS
platform serving 20+ FMCG brands across Southeast Asia — and, newest, the **RetailAIM IR**
platform, shown through its IR Workforce screens (demo mode) with the product survey's 3D
pack floating over them. A scroll-scrubbed globe traces the route, and **AIMeer**, an AI
twin, answers questions about the career and matches a recruiter's job description against
the published profile.

**Live:** https://ameeradhwa92.github.io/

## Structure

```
index.html              The entire one-page site (English copy lives in the markup)
assets/css/style.css    All styling — Monsoon palette (indigo night / lilac day) as CSS custom properties
assets/js/main.js       Theme, language, progress bar, self-drawing timeline spine, reveals
assets/js/i18n.js       Bahasa Melayu strings
assets/js/motion.js     GSAP choreography — split-line headings, stacked chapters, cursor, marquees
assets/js/ir-*.js       RetailAIM IR showcase (pure rules + DOM/three.js survey pack)
assets/js/route-globe*  Route globe (pure core + three.js adapter)
assets/js/chatbot.js    AIMeer chat — instant answers plus the cloud Worker
assets/js/jd-*.js       AIMeer's recruiter JD matcher (extract, keyword-match, cloud reasoning)
assets/data/            AIMeer knowledge base, recruiter evidence profile, globe coastlines
assets/vendor/          Self-hosted GSAP, three.js, PDF.js, JSZip (pins in assets/vendor/README.md)
assets/img/             Profile photo, real project screenshots, globe posters
assets/fonts/           Self-hosted Fraunces (no CDN — the page renders fully offline)
assets/resume/          Downloadable résumé (PDF)
cloud/                  Cloudflare Worker for AIMeer's AI tier (deployed by hand, see cloud/README.md)
tests/, tools/          node --test suite plus extra harnesses (see CLAUDE.md, "Running locally")
docs/                   Design specs, plans, mockups, résumé source (not part of the published page)
```

Hand-built static HTML/CSS/JS — no frameworks, no build step; libraries are vendored, not fetched. Published from
the repo root by GitHub Pages (`.nojekyll` disables Jekyll processing). Contributor and agent guidance is in
`CLAUDE.md`.
