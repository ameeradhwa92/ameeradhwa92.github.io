# Master Prompt / Design Spec — ameeradhwa92.github.io Timeline Portfolio

**Date:** 2026-07-24 · **Status:** Approved by Ameer Adhwa

This document is both the design spec and the reusable "master prompt" for the site.
If regenerating the site from scratch, feed this whole document to the builder.

## Master Prompt

> Build a world-class, premium, award-caliber personal portfolio for **Ameer Adhwa Bin
> Mohamad** as a single scrollable one-page GitHub Pages site (user site repo
> `ameeradhwa92.github.io`, published from repo root, no build step — pure HTML/CSS/JS).
> The centerpiece is a chronological **career timeline (2010 → present)** telling the
> journey from Diploma in Computer Science student (UiTM Dungun) to **Full Stack Web
> Specialist** building multi-tenant SaaS (RetailAIM® Plus) for 20+ FMCG brands across
> Southeast Asia. Every project shown must carry its live/online URL where one exists;
> projects no longer online are visibly badged **Retired (EOL)** with their former URL
> shown un-linked. Visual direction: **dark premium editorial** — near-black canvas,
> teal signature accent derived from his resume brand (#17766e, brightened for dark
> backgrounds), large display headlines, glowing vertical timeline spine, scroll-reveal
> animations honoring `prefers-reduced-motion`, real project screenshots. Fully
> responsive, semantically structured, SEO/OG meta complete, self-contained (no CDNs).

## Content sources (mined 2026-07-24, now removed as duplicates)

- `resume-source/resume.html` — canonical 2026 resume content (kept in PDF form)
- `Project Portfolio Adhwa.docx` — project descriptions, URLs, status, screenshots
- `Resume Adhwa.docx`, `Resume_Adhwa_ATS_v2.docx`, `Resume_Adhwa_Visual_v2.docx` —
  education CGPA/FYP details, career-highlight phrasing, skills matrix
- Kept: `assets/resume/Ameer_Adhwa_Resume_2026.pdf` (downloadable resume)

## Architecture

- `index.html` — the entire one-page site (semantic sections)
- `assets/css/style.css` — all styling; CSS custom properties for the palette
- `assets/js/main.js` — IntersectionObserver scroll reveals, nav state, no frameworks
- `assets/img/` — `profile.jpg` + curated per-project screenshots (compressed)
- `assets/resume/Ameer_Adhwa_Resume_2026.pdf`
- `docs/` — specs only, not linked from the site

## Recruiter evidence registry notes

- RetailAIM role transition for recruiter-facing materials: Web Application Developer from 2023-08-14 to 2025-07-31, then Full Stack Web Specialist effective 2025-08-01.
- Public notice wording for recruiter-facing materials: Stated contractual notice period: three months after confirmation.
- The redesignation letter confirms the Full Stack Web Specialist effective 2025-08-01 change and the organizational-structure change; the outstanding performance context is user-provided context supplied by Ameer.
- Recruiter-facing education facts: Diploma in Computer Science, UiTM Dungun, completed May 2013, CGPA 3.03; Bachelor of Information Technology (Hons.) Intelligent Systems Engineering, UiTM Shah Alam, completed April 2016, CGPA 2.79.
- Recruiter-facing privacy exclusions: salary, nric, home address, date of birth, benefits, leave, medical, signatures, confidential contract language.
- Recruiter-facing academic subject clusters:
  - Diploma: Structured Programming, Object-Oriented Programming, Web Application Development, Database Management Systems, Data Structures, Operating Systems, Information Systems Development, Networking, Visual Programming, Programming Paradigms.
  - Degree: Algorithms, Algorithm Analysis, Artificial Intelligence Programming Paradigms, Artificial Neural Networks, Knowledge-Based Systems, Fuzzy Logic, Data Mining, Evolutionary Algorithms, Intelligent Decision Support Systems, Intelligent Agents, IT Project Management, Ethical, Social and Professional Issues, Industrial Attachment.
- The JD matcher's scoring behavior (AI-led compatibility judgment, sanity-clamped to a
  local keyword baseline, keyword-only fallback when cloud AI is unavailable) is no longer
  governed by this spec — see `docs/superpowers/specs/2026-07-30-recruiter-copilot-ai-scoring-design.md`.

## Page flow

1. **Hero** — photo, name, role, one-line story ("From a diploma classroom in Dungun to
   multi-tenant SaaS across Southeast Asia"), contact links (email, LinkedIn, GitHub,
   location), Download Resume button
2. **Stats strip** — 12+ years · 25+ production systems · 20+ FMCG brands · 4 countries
3. **Timeline** — ascending nodes:
   - 2010–2013 Diploma CS, UiTM Dungun (CGPA 3.03, FYP: Bus Ticketing System, PHP)
   - 2013–2014 MyEMRO — Ruby on Rails aircraft MRO scheduling
   - 2013–2016 B.IT (Hons.) Intelligent Systems Engineering, UiTM Shah Alam
     (FYP: Mobile Road Tax Sticker Recognizer, Tesseract OCR on Android)
   - 2015–2023 TRM Nett Systems — Junior→Senior, 15+ government/enterprise systems
   - Feb–Aug 2023 NCS Global — Motorola Public Safety Platform (Android, contract)
   - 2023–now RetailAIM Malaysia (formerly Always Marketing) — Web App Developer →
     Full Stack Web Specialist; RetailAIM® Plus era
4. **Project cards** nested under their era, each with: screenshot, client, tech tags,
   description, status badge, link
5. **Skills matrix** (Web & Backend / Frontend / Mobile / Data / Cloud & DevOps /
   Integrations), **Education & Languages**, **Contact footer**

## Project registry (canonical URLs + status)

| Project | Era | URL | Status |
|---|---|---|---|
| RetailAIM® Plus | RetailAIM | (private SaaS — no public URL; card links to retailaim.com company site if desired) | Live |
| RetailAIM Plus BackOffice (React+FastAPI) | RetailAIM | private | In development |
| Abbott CRM Platform + Salesforce integration | RetailAIM | private | Live |
| Promoter Payment System | RetailAIM | private | Live |
| Motorola Public Safety Platform | NCS | https://www.motorolasolutions.com | Live (client) |
| Service 73 | TRM | formerly service73.com | Retired (EOL) |
| LPPEH BIS + app | TRM | https://lpeph.gov.my/ (moved from lppeh.gov.my) | Live |
| MARii EEV Label | TRM | https://eev.marii.my/ | Live |
| CIDB CCPM | TRM | https://ccpm.cidb.gov.my/ | Live |
| Kastam eCAF | TRM | https://ecaf.dagangnet.com.my/ | Live |
| ClinicPlus 2019 | TRM | formerly ttdi2019.esource.my | Retired (EOL) |
| SPAN eCLAPS | TRM | https://eclaps.span.gov.my/ | Live |
| SIRIM CYL | TRM | Play: play.google.com/store/apps/details?id=sirim.ecommpublic · iOS: apps.apple.com/my/app/check-your-label/id946294548 | Live (both stores) |
| PKA eDCFZ | TRM | https://edcfz.pka.gov.my/ | Live |
| PKFZ PIMS | TRM | http://www.pkfz.com/ | Live |
| Senai Airport City FZ (first Flutter build) | TRM | formerly sacfz.com | Retired (EOL) |
| CIDB Contractor4U | TRM | formerly contractor4u.cidb.gov.my | Retired (EOL) |
| Aircraft MRO scheduling (Rails) | MyEMRO | internal | Retired (EOL) |

Status badge rules: **Live** (green dot, external link, `rel="noopener"`);
**Retired (EOL)** (neutral/amber badge, dimmed card accent, former URL as plain text
labeled "formerly at …"); **In development** (accent badge, no link).
Mobile-only apps whose store listings were removed are EOL by definition.

## Error handling / quality bar

- No external network dependencies (fonts self-hosted or system stack) — the page must
  render fully offline
- All images `loading="lazy"` except hero, explicit width/height to avoid layout shift
- `prefers-reduced-motion: reduce` disables all animation
- Works without JS (reveals default to visible via `noscript`/CSS fallback)
- Lighthouse targets: 95+ performance/accessibility/SEO

## Testing

Manual local verification (open in browser / `python -m http.server`), link audit of
every project URL, responsive check at 375/768/1440 widths.
