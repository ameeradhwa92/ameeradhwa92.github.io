# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`ameeradhwa92.github.io` — a GitHub Pages **user site**: a single-page, dark-editorial
career timeline (2010 → present) for Ameer Adhwa Bin Mohamad. Hand-written HTML/CSS/JS,
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

Verification is manual: open in a browser, check 375 / 768 / 1440 widths, toggle
dark/light and EN/BM, and `curl` every project URL before publishing a status change.

### Bump `?v=` on every deploy that touches CSS or JS

GitHub Pages serves assets with `Cache-Control: max-age=600`, so a stale visitor
self-heals within ten minutes. The `?v=` tag on the stylesheet and the seven script tags
in `index.html` makes that deterministic instead — **bump it in `index.html` and nowhere
else.** `chatbot.js` reads the tag off its own `<script src>` and forwards it to the
`aimeer-kb.txt` and `aimeer-profile.json` fetches, so there is one value to edit and no
drift. That forwarding matters: those two files are fetched at runtime and are not covered
by the script tag, and a stale `aimeer-kb.txt` makes AIMeer answer from retired facts —
worse than stale code.

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
| `assets/js/aimeer-device.js` | Device/browser capability checks that decide local-AI eligibility (WebGPU, memory, iOS, known Android tiers) |
| `assets/js/jd-extractor.js` | Recruiter JD matcher: local PDF/DOCX/paste text extraction and normalization |
| `assets/js/jd-matcher.js` | Recruiter JD matcher: deterministic keyword-based scoring against the published profile |
| `assets/js/jd-reasoning.js` | Recruiter JD matcher: builds the cloud scoring request, re-validates the model's response the Worker relays (must stay in lockstep with the Worker's validator), merges it with the deterministic result (clamp band, fit band, report sections) |
| `assets/js/chatbot.js` | AIMeer, the three-tier chatbot, plus the recruiter JD match report UI and its cloud-scoring request flow |
| `assets/data/aimeer-kb.txt` | Chatbot knowledge base — fetched by *both* the browser and the Worker |
| `assets/data/aimeer-profile.json` | Recruiter evidence registry (`recruiterEvidence`, `privacyExclusions`) — the only allowlist of evidence the JD matcher's cloud reasoning may cite |
| `cloud/aimeer-worker.js` | Cloudflare Worker relay — chat/summary/jd-explanation/jd-reasoning/jd-scoring/version modes (deployed manually, see below) |
| `docs/superpowers/specs/2026-07-24-portfolio-site-design.md` | Design spec + canonical project/URL/status registry |
| `docs/superpowers/specs/2026-07-30-recruiter-copilot-ai-scoring-design.md` | Design of record for AI-led JD scoring — two-call split, clamp band, privacy screen, model-output tolerance, Worker diagnosability. Read before touching either JD validator |
| `docs/resume-source/resume.html` | Source for the downloadable résumé PDF |
| `tests/*.test.js` | `node --test` suite — run before anything ships (see Running locally) |
| `tools/` | Five extra harnesses `tests/*.test.js` does not cover (JD extractor/matcher/cloud-payload contracts, recruiter profile/KB drift, recruiter UI exact copy) — see Running locally |

Scripts are plain IIFEs loaded with `defer` in the order `verify_recruiter_ui.ps1` asserts:
`i18n.js` → `main.js` → `aimeer-device.js` → `jd-extractor.js` → `jd-matcher.js` →
`jd-reasoning.js` → `chatbot.js`. An inline script in `<head>` applies the saved
theme/language to `documentElement.dataset` before first paint to avoid a flash — it runs
before the stylesheet's cascade matters, so keep it in sync with the palette selectors.

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
  `chatbot.js` (both `en` and `ms` branches), not in `i18n.js`.

### AIMeer chatbot (three tiers)

`chatbot.js` picks a route in `decideRoute()` and degrades gracefully:

1. **Instant** — regex `TOPICS` table, zero download, always available and the fallback for
   every failure path in tiers 2–3.
2. **On-device** — dynamically imports `@mlc-ai/web-llm` from `esm.run` and runs
   Llama-3.2-1B via WebGPU. This is the **only approved external network dependency** on the
   site; everything else (including fonts) is self-hosted so the page renders offline.
3. **Cloud** — POSTs to the Cloudflare Worker (`CLOUD_ENDPOINT`), which runs
   `@cf/meta/llama-3.1-8b-instruct-fast` on Workers AI.

iOS is force-routed to cloud regardless of WebGPU support (Safari's per-tab memory ceiling
kills the model mid-load). If the local download exceeds `LOCAL_TIMEOUT` (20 s), cloud
answers take over as interim and local swaps back in when ready — the `aiState` /
`route` / `dlActive` triple is what `applyAiBox()` and the launcher ring read, so update all
of them together when changing the state machine.

Both the browser and the Worker assemble their system prompt from `PROMPT_HEAD`/`PERSONA_HEAD`
plus `aimeer-kb.txt`. **Keep those two persona strings identical**, or the same question gets
a different voice depending on the visitor's device. The Worker assembles the prompt
server-side on purpose — that's what stops the endpoint being used as a generic LLM proxy;
don't let client-supplied `system` messages through.

Unanswered questions **and** any salary-matching question (`SALARY_KEYS`) trigger the handoff
card, which summarizes the chat and pre-fills WhatsApp or mailto for the *visitor* to send.

**The Worker is not deployed from this repo.** `cloud/aimeer-worker.js` is a copy of what is
pasted into the Cloudflare dashboard editor by hand. Editing the file here changes nothing
live — say so explicitly when handing back Worker changes. `cloud/README.md` has the setup
steps; the `AI` binding variable name must be exactly `AI`.

**Bump `WORKER_REVISION` on every Worker change, and confirm the paste landed before
believing any live behaviour.** `POST {"mode":"version"}` returns `{revision, aiBinding}`.
A paste that silently didn't take effect is indistinguishable from a fix that didn't work,
and that ambiguity has already cost a full round of debugging on this file.

### Recruiter JD scoring runs two model calls

`jd-scoring` is the mode the site uses, and it calls Workers AI **twice**: the
per-requirement reasoning (reusing `jd-reasoning`'s prompt and message verbatim, with no
JD prose) and then the overall score (full JD prose, three-key `{score, fitBand,
narrative}` schema). This is not an optimization — a single call failed every live request
for six revisions while `jd-reasoning`, identical but without the JD prose, never failed.
An 8B model cannot hold a whole job description *and* a ten-field-per-requirement
contract. Don't recombine them.

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

## Content rules

These carry real-world consequences — the site makes verifiable claims about live systems.

- **Every project card carries a status badge**: `badge-live` (verified working link),
  `badge-private` (enterprise SaaS, no public URL), `badge-dev`, or `badge-eol`. A retired
  project shows its former URL as plain struck-through text (`.card-formerly`), never as a
  link. Verify dead/live status by `curl` before changing a badge.
- **Amber (`--amber`) is reserved for Retired/EOL badges only.** Teal is the signature accent.
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
