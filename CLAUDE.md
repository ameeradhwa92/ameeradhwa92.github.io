# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`ameeradhwa92.github.io` — a GitHub Pages **user site**: a single-page editorial
career timeline (2010 → present) for Ameer Adhwa Bin Mohamad in the "Monsoon" palette
(indigo night / lilac day, iris interface accent, coral journey thread — design of record
in `docs/superpowers/specs/2026-09-05-monsoon-palette-and-loader-design.md`), redesigned in
2026-10 around a vendored-GSAP motion layer and a screen showcase of the newest project,
RetailAIM IR (see "Motion layer and the RetailAIM IR showcase"). Hand-written HTML/CSS/JS,
**no framework, no build step, no package manager**. GitHub Pages publishes the repo root
directly; `.nojekyll` disables Jekyll processing. Pushing to `main` *is* the deploy.

## Running locally

There is no build step and no linter, but there **is** a test suite. Serve over HTTP —
do **not** open `index.html` via `file://`, because the chatbot `fetch()`es its knowledge
base and the cloud relay validates the request `Origin`:

```bash
python -m http.server 8080     # port 8080 specifically — see below
```

The Cloudflare Worker's `ALLOWED_ORIGINS` only whitelists the live site plus
`http://localhost:8080` and `http://127.0.0.1:8080`. Any other port silently loses the
cloud AI tier during local preview.

Before anything ships, run the test suite from the repo root and confirm 0 failing:

```bash
node --test "tests/*.test.js"
```

`tests/*.test.js` is not the whole verification surface — `tools/` holds five more
harnesses that catch regressions the unit tests don't (recruiter profile/KB drift, JD
extractor/matcher/cloud-payload contracts, and the recruiter UI's exact copy strings).
Run all five too:

```bash
node tools/test_jd_extractor.mjs
node tools/test_jd_matcher.mjs
node tools/test_recruiter_cloud_payload.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File tools/verify_recruiter_profile.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools/verify_recruiter_ui.ps1
```

A green tree means the `tests/` suite **and** all five `tools/` harnesses pass — not the
`tests/` suite alone. `verify_recruiter_ui.ps1` asserts on exact disclaimer and chip
copy, so any change to that text must update the script's expectations in the same
change, or it goes red unnoticed.

There is no `node_modules`. Tests read the browser IIFEs into a `node:vm` context with a
hand-rolled `document` stub (no jsdom); `route-globe-core.js` and `ir-core.js` are
UMD and load with plain `require()`. A new script must stay a plain IIFE that tolerates
that stub at load time, or split its pure half into a UMD file the way the globe does.

`window.AIMEER_CLOUD_ENDPOINT`, set before `chatbot.js` runs, overrides the Worker URL —
point a preview at a staging Worker without editing `chatbot.js`. An empty string turns the
cloud tier off, which is how to preview the instant-answers-only experience.

Verification is manual: open in a browser, check 375 / 768 / 1440 widths, toggle
dark/light and EN/BM, and `curl` every project URL before publishing a status change.

### Bump `?v=` on every deploy that touches CSS or JS

GitHub Pages serves assets with `Cache-Control: max-age=600`, so a stale visitor
self-heals within ten minutes. The `?v=` tag on the stylesheet and the eleven `assets/js/`
script tags in `index.html` makes that deterministic instead — **bump it in `index.html` and nowhere
else.** `chatbot.js` reads the tag off its own `<script src>` and forwards it to the
`aimeer-profile.json` fetch, so there is one value to edit and no drift. That forwarding
matters: the profile is fetched at runtime and is not covered by the script tag, and a stale
profile makes the JD matcher score against retired evidence — worse than stale code.
(`aimeer-kb.txt` is read only by the Worker since the on-device tier was retired; see its
edge cache below.)

`verify_recruiter_ui.ps1` fails if the tags disagree with each other or if any CSS/JS
asset lacks one, and names the offending file. While iterating locally, tick
**DevTools → Network → Disable cache** instead of bumping the tag.

## Architecture

| File | Role |
|---|---|
| `index.html` | The whole site — every section, all English copy, the chat markup |
| `assets/css/style.css` | All styling; palette as CSS custom properties |
| `assets/js/main.js` | Theme, language, scroll progress + self-drawing spine, reveals, cert modal, cursor glow |
| `assets/js/i18n.js` | `window.I18N_MS` — Bahasa Melayu strings only |
| `assets/js/jd-extractor.js` | Recruiter JD matcher: local PDF/DOCX/paste text extraction and normalization |
| `assets/js/jd-matcher.js` | Recruiter JD matcher: deterministic keyword-based scoring against the published profile |
| `assets/js/jd-reasoning.js` | Recruiter JD matcher: builds the cloud scoring request (and `buildDecisionInput`, the wider registry a `jd-decide` response is checked against), re-validates the response the Worker relays (must stay in lockstep with the Worker's validator), merges it with the deterministic result (clamp band, fit band, report sections) |
| `assets/js/chatbot.js` | AIMeer, the two-tier chatbot (instant answers + the cloud Worker with Clef triage), plus the recruiter JD match report UI, its drop zone, and its `jd-decide` → `jd-scoring` request flow |
| `assets/js/route-globe-core.js` | Route globe, pure half: sphere geometry, camera keyframes/scrub, coastline decoding, capability gate, load state machine. UMD, tested by plain `require()` |
| `assets/js/route-globe.js` | Route globe, DOM/WebGL adapter: reads the stops `<ol>`, gates, lazy-imports vendored three.js, owns the canvas/scroll/drag/theme wiring |
| `assets/js/ir-core.js` | RetailAIM IR showcase, pure half: the survey pack's sample sizes and sizing rules. UMD, tested by plain `require()` |
| `assets/js/ir-showcase.js` | RetailAIM IR showcase, DOM half: the IR Ops survey pack floating over the `#work` screens (three.js, lazy, same import URL as the globe), where it lives, and the step pills |
| `assets/js/motion.js` | GSAP choreography: split-line headings, count-ups, stacked IR chapters, velocity marquees, magnetic buttons, custom cursor, nav hide/current dot, the MYT clock, and the JD report settling (on `aimeer:jd-report`) |
| `assets/data/route-globe-coastlines.json` | Generated country outlines for the globe (never hand-edited — see Regenerating the globe coastlines) |
| `assets/vendor/` | Self-hosted libraries, pins and hashes recorded in `assets/vendor/README.md`: `pdfjs/` 4.10.38 and `jszip/` 3.10.1 (lazily `import()`ed by `jd-extractor.js` for PDF/DOCX), `gsap/` 3.15.0 (core, ScrollTrigger, SplitText — classic `defer` tags), `three/` r185 (`three.module.min.js` + `three.core.min.js`, kept side by side) and its `lines/` fat-line addon, whose bare `three` import the `<head>` import map resolves |
| `assets/data/aimeer-kb.txt` | Chatbot knowledge base — read by the Worker (the chat prompt and Clef's triage state); the browser's instant answers are the `TOPICS` table |
| `assets/data/aimeer-profile.json` | Recruiter evidence registry (`recruiterEvidence`, `privacyExclusions`) — the only allowlist of evidence the JD matcher's cloud reasoning may cite |
| `cloud/aimeer-worker.js` | Cloudflare Worker relay — chat (Clef-triaged)/summary/jd-explanation/jd-reasoning/jd-scoring/jd-decide/clef-probe/text-probe/version modes (deployed manually, see below) |
| `docs/superpowers/specs/2026-07-24-portfolio-site-design.md` | Design spec + canonical project/URL/status registry |
| `docs/superpowers/specs/2026-07-30-recruiter-copilot-ai-scoring-design.md` | Design of record for AI-led JD scoring — two-call split, clamp band, privacy screen, model-output tolerance, Worker diagnosability. Read before touching either JD validator |
| `docs/superpowers/specs/2026-10-02-aimeer-jev-decisions-design.md` | Design of record for retiring the on-device tier and adding a decision model (chat triage, `jd-decide`; designed for Jev, now Clef-flash — see its 2026-10-03 note), the rollout order, the redesign brief for the chat/JD UI, and the roadmap |
| `docs/resume-source/resume.html` | Source for the downloadable résumé PDF |
| `tests/*.test.js` | `node --test` suite — run before anything ships (see Running locally); `ir-core.test.js` covers the pack's sizing rules |
| `tools/` | Five extra harnesses `tests/*.test.js` does not cover (JD extractor/matcher/cloud-payload contracts, recruiter profile/KB drift, recruiter UI exact copy) — see Running locally |
| `docs/mockups/*.html` | The standalone proposals a spec was approved from (they pull Fraunces from Google Fonts for convenience — the live site never does). Implementation plans and per-task subagent reports are not kept once their work ships; the specs are the record |

Scripts are plain IIFEs loaded with `defer` in the order `verify_recruiter_ui.ps1` asserts:
`i18n.js` → `main.js` → `jd-extractor.js` → `jd-matcher.js` →
`jd-reasoning.js` → `chatbot.js`, then `route-globe-core.js` → `route-globe.js`, then the three
vendored GSAP files → `ir-core.js` → `ir-showcase.js` → `motion.js` (the verify script's order
regex stops at `chatbot.js`, so new tags go after it; `tests/route-globe-section.test.js` pins
`chatbot.js` → `route-globe-core.js` → `route-globe.js` as adjacent). An inline script in `<head>` applies the saved
theme/language to `documentElement.dataset` before first paint to avoid a flash — it runs
before the stylesheet's cascade matters, so keep it in sync with the palette selectors.

A second inline block in `<head>` is the **first-paint loader** (sand grains gather while
real assets load, then scatter as a dot-matrix dissolve). It is inline on purpose so it
paints before the stylesheet; its `--ld-*` tokens mirror the top of `style.css` and must be
changed together. `<html>` starts with class `loading`; everything in `<body>` except
`#loader` is `visibility: hidden` until the script adds `revealed` (at most 9 s, never
under 1.6 s). `html:not(.js)` never shows the overlay, so a no-JS visitor gets the page
as-is. The hero's thread SVG and copy stagger key off `html.revealed`, so anything that
must animate on first view should too. The loader's status line is bilingual inline
(`LABELS.en` / `LABELS.ms`) because it runs before `i18n.js`.

### i18n model

English is the source of truth **in the DOM**. On load, `main.js` walks every `[data-i18n]`
element and snapshots its `innerHTML` into an in-memory `EN` dict; switching to `ms` swaps in
`window.I18N_MS[key]`. Consequences:

- **Any new user-visible copy needs both** a `data-i18n="key"` attribute in `index.html`
  *and* a matching entry in `i18n.js`. A missing MS key silently leaves English on screen.
- Values are injected via `innerHTML`, so inline markup (`<b>`, `<em>`, `&nbsp;`) must be
  mirrored in the MS string.
- Bahasa Melayu follows **Dewan Bahasa dan Pustaka** conventions — formal register, DBP
  istilah (*pemberitahuan tolak*, *hujung belakang*, *penyenggaraan*, *berbilang penyewa*).
- Strings that JS generates rather than reads from the DOM live in the `T` table in
  `chatbot.js` (both `en` and `ms` branches), not in `i18n.js`. The IR showcase avoids generated
  copy altogether: everything it shows is in the markup with its own key (the pack's size
  readout is digits only).
- A control with no visible text of its own carries
  `data-i18n-aria="key"`; `setLang()` writes that key's text, tags stripped, into `aria-label`.
  `setLang()` also dispatches `site:lang` on `document` after every swap.

### AIMeer chatbot (two tiers and a decision layer)

`chatbot.js` has two tiers and degrades gracefully:

1. **Instant** — regex `TOPICS` table, zero download, works offline, and the fallback for
   every cloud failure.
2. **Cloud** — POSTs to the Cloudflare Worker (`CLOUD_ENDPOINT`). The Worker first asks
   **Clef-flash** (Cloudflare's decision model on Workers AI, `@cf/cloudflare/clef-flash`) two
   typed questions about the message — its intent and whether the KB can answer it — then lets
   `@cf/openai/gpt-oss-20b` answer. A confident salary question comes back as
   `action: "salary"` and a confidently unanswerable one as `action: "handoff"`, both with an
   empty reply and no LLM call; the browser answers them from `TOPICS` and the handoff card.
   `action: "jd"` adds a one-time offer of the JD matcher. A Worker with no `action` reads as
   `"answer"`.

The on-device tier (WebLLM, Llama 3.2 1B via WebGPU) was **retired in 2026-10**: it answered
poorly even on high-end GPUs and cost every capable visitor a ≈ 0.9 GB download.
`aimeer-device.js`, the model switcher and the download UI went with it. The site now has **no
external network dependency** besides the Worker — everything else, fonts included, is
self-hosted so the page renders offline. `aiState` is `"cloud"` when `CLOUD_ENDPOINT` is set
and `"off"` otherwise; there is no download state machine left.

Clef is a decision model, not a text model: it can only pick from the labels it is offered and
reports calibrated probabilities. It speaks the same API as TypeSafe's **Jev**, which it
replaced on 2026-10-03: Jev is a third-party model on Workers AI, billed against AI Gateway
credit rather than the free 10,000 neurons a day, and every call failed with error 2021
(`InsufficientAIGatewaycredits`). Clef-flash is first-party and covered by the free allowance.
The chat gates (`CLEF_TRIAGE_*` in the Worker) were set for Jev, which independent evaluations
found well calibrated at the extremes and least reliable in the 0.3–0.8 band; they have not been
re-measured on Clef, so they stay strict. Don't lower them without evidence.

The text model, `gpt-oss-20b` (replaced Llama 3.1 8B the same day), is a **reasoning model**: its
hidden reasoning tokens come out of `max_tokens`. Every call goes through `runText`, which asks
for `reasoning_effort: "low"` and adds `TEXT_REASONING_HEADROOM` on top of each caller's
visible-answer budget; a budget spent entirely on reasoning comes back as empty content, which
every caller already treats as a miss. `modelOutput` reads the answer from whichever shape the
runtime returns (`response`, Chat Completions `choices`, or Responses `output`) and never reads
the reasoning. `{"mode":"text-probe"}` reports the model, the response's top-level keys and
whether the effort field was accepted; `{"mode":"clef-probe"}` does the same for Clef.

The Worker assembles its system prompt from `PERSONA_HEAD` plus `aimeer-kb.txt` (the browser's
copy, `PROMPT_HEAD`, went with the on-device tier). It does so server-side on purpose — that's what stops the endpoint being used as a generic LLM proxy;
don't let client-supplied `system` messages through.

Unanswered questions **and** any salary-matching question (`SALARY_KEYS`) trigger the handoff
card, which summarizes the chat and pre-fills WhatsApp or mailto for the *visitor* to send.

**The Worker is not deployed from this repo.** `cloud/aimeer-worker.js` is a copy of what is
pasted into the Cloudflare dashboard editor by hand. Editing the file here changes nothing
live — say so explicitly when handing back Worker changes. `cloud/README.md` has the setup
steps; the `AI` binding variable name must be exactly `AI`.

The Worker edge-caches `aimeer-kb.txt` and `aimeer-profile.json` for an hour
(`loadCachedText`, tags `aimeer-kb-cache=v1` / `aimeer-profile-cache=v1`). A pushed KB
change reaches the cloud tier up to an hour later (the instant tier never reads the KB — its
copy is the `TOPICS` table, see "When a fact changes"). Bumping a cache tag forces it, and that is a Worker change and a redeploy.

**Bump `WORKER_REVISION` on every Worker change, and confirm the paste landed before
believing any live behaviour.** `POST {"mode":"version"}` returns `{revision, aiBinding}`.
A paste that silently didn't take effect is indistinguishable from a fix that didn't work,
and that ambiguity has already cost a full round of debugging on this file.

### Recruiter JD decisions: `jd-decide` first, `jd-scoring` as the fallback

The browser sends every analysis to `jd-decide` first. One **Clef** call answers, per
requirement, a `level_i` choice over the seven match levels and an `evidence_i` choice over
every citable record in the published profile (plus `none`), and one `overall_fit` score on a
four-level rubric. gpt-oss then writes only the narrative, as plain text, from the decisions.
The response has the `jd-scoring` shape plus `engine: "clef"` and a per-requirement
`probability`, both optional in `jd-reasoning.js`, so **one validator serves both modes**.
Because Clef is offered the whole citable registry (not only the ids the keyword pass touched),
the browser validates and merges a `jd-decide` response against
`JDReasoning.buildDecisionInput(input, profile)`, not the `jd-scoring` input.

Any `jd-decide` failure falls through to the `jd-scoring` flow below, unchanged, retry rules
included — except a 4xx naming a `jd-` rule (`jd-privacy-invalid` and friends), because
`jd-scoring` validates the identical body and would refuse it too. That fall-through is also
what keeps the site working against a Worker from before `jd-decide`, which answers `jd-decide` as an
unknown chat request (`400 empty`). Never make the browser depend on `jd-decide` succeeding.

The probability on each requirement card is Clef's weight on the level it chose — "how sure the
decision model was", never the odds that Ameer can do the job. Keep the copy that way.

Below `CLEF_DECISION_MIN` (0.4) on its chosen level, Clef's decision does not stand: the Worker
uses the keyword pass's verdict for that requirement (`keywordMatchLevel`), citing the keyword
pass's own evidence first, and reports it as low confidence with no probability, so the card
shows no confidence bar. The first live report had Clef-flash call "Python FastAPI" a gap at 0.25
while the profile lists FastAPI, and the narrative contradicted itself. The status line copy
(`jdReasonStatusClef`, EN/MS) says unsure calls fall back to the keyword match; keep it true.

### Recruiter JD scoring runs two model calls

`jd-scoring` is the fallback mode, and it calls Workers AI **twice**: the
per-requirement reasoning (reusing `jd-reasoning`'s prompt and message verbatim, with no
JD prose) and then the overall score (full JD prose, three-key `{score, fitBand,
narrative}` schema). This is not an optimization — a single call failed every live request
for six revisions while `jd-reasoning`, identical but without the JD prose, never failed.
An 8B model cannot hold a whole job description *and* a ten-field-per-requirement
contract. That was Llama 3.1 8B; gpt-oss-20b is stronger, but the split has not been re-tested
against it, so don't recombine them without evidence.

**A JD reaches the model only if three layers agree on how many requirements it has.**
`jd-extractor.js`'s `HEADING_ALIASES` decides which sections exist; `jd-matcher.js` harvests
generic (non-alias) lines only from requirement-bearing sections and only when
`looksLikeProse` says the line names something rather than describes it; `jd-reasoning.js`
then selects `REQUIREMENT_BUDGET` (12) of whatever survived. Break the first and an ordinary
prose posting collapses into one anonymous section where every sentence becomes a phantom
requirement — that produced 91 requirements, a `400 jd-deterministic-invalid` from the
Worker, and a report permanently stuck on the keyword estimate. Break the last and the
payload passes the Worker's check but truncates mid-JSON, which fails the same way slower.
Adding a heading wording is safe; adding a new *canonical* heading value means also teaching
`isRequirementBearingSection`/`isAdministrativeSection` what to do with it.

Two rules that are easy to break when editing the JD validators:

- `assets/js/jd-reasoning.js` re-validates everything the Worker relays. The two files run
  on the same payload in separate deployment targets, so **a rule made stricter on either
  side rejects what the other just accepted.** Change both or neither.
- The relayed response is rebuilt field by field from validated values. That rebuild — not
  the key checks — is what stops model-invented content reaching the browser, which is why
  unknown keys are ignored rather than fatal.

A `502` carries `{stage, reason, revision}` and the browser folds the reason into a
`console.warn`. If JD scoring is falling back, open DevTools and read it rather than
guessing — the specific rule is named.

### Motion layer and the RetailAIM IR showcase

`motion.js` is the only place GSAP drives the page. It hides nothing unless `gsap` **and**
`ScrollTrigger` loaded and motion is allowed, so a missing vendor file leaves the static page.
Headings (`.section-head h2`, `.ir-title`, `.ir-copy h3`, `.ir-engine-head h3`, `.contact h2`,
and `.hero-title` once `html.revealed` lands) are split into masked lines **on entry** and
reverted the moment they land. Keep it that way: `main.js` swaps `innerHTML` on the language
toggle, and a capture-phase click listener reverts any heading still mid-flight before it does.
The `.reveal` fade stays plain CSS (`main.js` adds `.in`); GSAP does not own it.

`#work` sits between the stats strip and `#route`. Its three `.ir-chapter`s are sticky and
stack only under `(min-width: 1101px) and (min-height: 820px)` — the same query in `style.css`,
in `motion.js`'s `gsap.matchMedia()` and in `ir-showcase.js`; change all three. The covered chapter darkens through its
`::after` overlay (`--dim`), not `opacity`, so a chapter never shows through the one above it.

The chapters show real **IR Workforce** screens, supplied by the owner and captured in the
app's demo mode: `assets/img/projects/ir-workforce/{dashboard,board,task,timeline,reports}-{dark,light}.jpg`,
1280×800, the switcher's client logo blurred. Each `<figure>` carries both themes as
`.ir-img-dark` / `.ir-img-light`, swapped by the same three theme blocks as the route posters.
They hold demo data only (sample projects and people); keep it that way: no real outlet,
merchandiser or client names, no internal hostnames, IPs or database names, and the demo-mode
note (`ir.note`) stays. A replacement screen is cropped to 16:10 with the browser scrollbar
removed and the logo tile blurred before it lands here. The project card's image
`assets/img/projects/retailaim-ir.jpg` is the dark dashboard at 1000×625; the card links to
`#work`, not to the live app.

The one live piece is the product-survey pack from IR Ops. Its home (and its no-JS place) is
`#ir-pack-slot` on the first screen; under the stacking query `ir-showcase.js` (`STACK_QUERY`,
a third copy of that query) moves `#ir-pack` into `#ir-pack-rail`, a full-height overlay on
`.ir-chapters` where the pack is sticky, so each screen slides in under it and the pack turns on
every chapter change. Its offsets come from the first chapter's `.ir-shots`, clamped to the
shortest chapter, and the browser chapters' `.ir-shots` keep one aspect ratio so the corner matches (the phone row in `#ir-survey` is shorter).
Below 641px it sits under the screen in a row instead. It loads the vendored three.js through
`import()` of the **same absolute URL** `route-globe.js` uses, so the module cache shares one
copy. Off the happy path (save-data, no WebGL2, a failed import) the CSS 3D box stays;
`#cap-stage`'s `data-pack` names the reason, the same convention as `section.dataset.globe`.

## Content rules

These carry real-world consequences — the site makes verifiable claims about live systems.

- **Every project card carries a status badge**: `badge-live` (verified working link),
  `badge-private` (enterprise SaaS, no public URL), `badge-dev`, or `badge-eol`. A retired
  project shows its former URL as plain struck-through text (`.card-formerly`), never as a
  link. Verify dead/live status by `curl` before changing a badge.
- **Amber (`--amber`) is reserved for Retired/EOL badges only.** Two accents, split by job:
  **iris `--accent`** (`--accent-deep`, `--accent-hover`, `--accent-rgb`) is the interface —
  links, buttons, live badges, tags, chat chrome, globe coastlines and atmosphere;
  **coral `--thread`** (`--thread-rgb`) is the journey line and nothing else — scroll
  progress, timeline spine and lit nodes, era years, route rail and active stop, globe route
  and markers, the hero underline, selection and focus rings, the loader. Don't put the
  thread on a button or the accent on the spine.
- Eyebrows (`.eyebrow`) are italic Fraunces, not tracked mono caps; the class name and copy
  stay because tests and i18n keys reference them.
- Palette lives in three blocks at the top of `style.css`: the dark `:root` default, the
  `@media (prefers-color-scheme: light)` override, and the explicit `:root[data-theme="light"]`
  override. Light-theme changes must be made in **both** light blocks.
- All images `loading="lazy"` except the hero, with explicit `width`/`height`.
- `prefers-reduced-motion: reduce` disables animation; reveals fall back to visible.

### When a fact changes, it changes in four places

A change to a URL, job title, project status or education detail must be propagated to:

1. `index.html` (English) **and** `assets/js/i18n.js` (Bahasa Melayu)
2. `assets/data/aimeer-kb.txt` — the chatbot's only source of truth
3. `docs/resume-source/resume.html`, then re-render the PDF (below)
4. The project registry table in `docs/superpowers/specs/2026-07-24-portfolio-site-design.md`

Hard-coded facts also live in the `TOPICS` answers in `chatbot.js` — grep there too.

### Route globe (three.js)

The section `#route` between the stats strip and the timeline is a scroll-scrubbed globe
that also carries the journey's only heading (`#journey` has none). Its **data is the
markup**: each `<li data-lat data-lng data-kind data-zoom [data-label-dir]>` in
`#route-stops` is a camera keyframe in DOM order (`place` | `remote` | `region`) and the
nested `data-kind="footprint"` items are the reveal's arc targets. `data-label-dir`
(`n|ne|e|se|s|sw|w|nw`) fans the projected DOM label out from its marker; the three Klang
Valley places must use three different directions or the labels stack. One label per
place: several stops share a marker (the Dungun years, the two Kuala Lumpur jobs), and the
first stop at a place decides its direction and text. Town-level
coordinates only — the profile's privacy exclusions rule out anything finer, and "Sura
Gate" stays off the map. Adding a stop is an HTML + `i18n.js` edit;
`tests/route-globe-section.test.js` checks ranges, kinds, zoom, directions and MS coverage.

**Zooms stay between 1.5 and 3.2, and the limb is always in frame.** `core.framing()`
picks the FOV and a view offset per distance, aspect and layout, and
`core.limbInFrame()` is the invariant the core test checks on a grid. There is no
street-level zoom on purpose: the marker, pulse, label and rail caption identify the
stop; the sphere identifies the medium. Don't lower `DEFAULT_ZOOM` or a `data-zoom`
below 1.5 without re-running that test.

`route-globe.js` upgrades the section in place only when `evaluateGate` passes (no
`prefers-reduced-motion`, no `saveData`, WebGL2 present) and the section comes within
600px of the viewport; then it dynamically imports the vendored three.js, the five
`lines/` addon modules and the coastline JSON. Only the JSON carries the `?v=` tag: the
vendor imports are deliberately unversioned because the import map must resolve the
addon's bare `three` to the identical URL, and a `?v=` on either side loads two copies of
three.js. The addon is
optional: if it fails the globe renders with 1px lines and `section.dataset.globe` reads
`live-thin`. Everything else — no JS, reduced motion, no WebGL2, a failed load, a lost
context — leaves the poster (`assets/img/route-globe-{dark,light}.jpg`) and the plain
stops list, and writes the reason to `section.dataset.globe`. Read that attribute before
guessing why the globe is static. Rendering is on demand: frames draw on scroll, drag and
theme change, plus a ~30 fps loop (breathing sway, marker pulse, travelling light) only
while the stage is on screen. Colours are read from the palette custom properties, so a
theme change needs no globe code; the light theme swaps additive blending for normal and
hides the stars.

The stage is full-bleed and transparent (the page atmosphere shows through) with a CSS
mask fading its top and bottom edges; there is deliberately no border, radius, background
or shadow — that box is what made the first version read as an embedded video. The
posters are element screenshots of `#route-stage` at the final reveal (dark and light,
1600×900, DPR 1) with the page chrome hidden first — `.nav, .progress, .chat-launcher,
.chat-callout, .route-hint, #route-rail, .route-labels { visibility: hidden }` — because
the fallback shows the real nav above the image and the plain stops list below it. Labels
are hidden too because the poster is language-neutral: a Bahasa Melayu visitor on the
fallback path must not see English place names. Recapture them when the route, the framing
or the palette changes.

#### Regenerating the globe coastlines

`assets/data/route-globe-coastlines.json` is generated, not hand-edited, from the
world-atlas 2.0.2 redistribution of Natural Earth (1:110m world, 1:50m Southeast Asia):

```bash
curl -sSL -o world-atlas.tgz https://registry.npmjs.org/world-atlas/-/world-atlas-2.0.2.tgz
mkdir world-atlas && tar -xzf world-atlas.tgz -C world-atlas
node tools/build_route_globe_coastlines.mjs world-atlas/package assets/data/route-globe-coastlines.json
```

The tool projects nothing itself; the browser projects the compact lon/lat integers with
`route-globe-core.js`'s `latLngToVector`, the same function the stops use, so outlines and
markers cannot drift apart.

### Regenerating the résumé PDF

`assets/resume/Ameer_Adhwa_Resume_2026.pdf` is rendered from `docs/resume-source/resume.html`
via headless Edge (A4, no header/footer):

```bash
msedge --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="assets/resume/Ameer_Adhwa_Resume_2026.pdf" \
  "docs/resume-source/resume.html"
```

The portrait `<img src>` in `resume.html` is an absolute `file:///C:/Users/...` path — adjust
it for the current machine before rendering, or the photo comes out blank.
