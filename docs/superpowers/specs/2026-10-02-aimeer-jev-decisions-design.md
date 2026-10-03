# AIMeer v2 — retire the on-device model, add Jev decisions

Status: implemented on `claude/gracious-gates-d3amt2` · Worker revision `2026-10-02-jev-1`
(not live until pasted into the Cloudflare dashboard — see Rollout).

> **2026-10-03 — models swapped, design unchanged.** Revision `2026-10-02-jev-1` went live and
> every Jev call failed with `2021 InsufficientAIGatewaycredits`: Jev is a third-party model on
> Workers AI, billed against AI Gateway credit, not the free 10,000 neurons a day. Revision
> `2026-10-03-clef-1` replaces it with Cloudflare's **Clef-flash** (`@cf/cloudflare/clef-flash`),
> which speaks the same API and is covered by the free allowance, and replaces Llama 3.1 8B with
> **gpt-oss-20b** (`@cf/openai/gpt-oss-20b`) as the text model. Everything below that says Jev now
> runs on Clef (`engine: "clef"`, `clef-probe`, `CLEF_*` constants); the rollout gains a
> `{"mode":"text-probe"}` check for the text model. See `cloud/README.md` for the current probes.

## Why

1. **The on-device tier did not earn its cost.** WebLLM running Llama 3.2 1B answered poorly
   even on high-end GPUs, and every capable visitor paid a ≈ 0.9 GB download, a shader compile
   and a state machine (route / aiState / dlActive, a 20 s interim-cloud timer, a cancel path,
   a model switcher, a device-eligibility module) to get worse answers than the cloud tier.
2. **The JD matcher's weak point was never the score — it was the JSON.** Every recorded
   `jd-scoring` failure (`match-level-invalid`, invented evidence ids, missing fields, JSON
   truncated mid-object) came from asking an 8B model to *generate* answers from fixed
   vocabularies. That is a classification problem being solved with a text generator.

## What Jev is (and is not)

Jev is TypeSafe AI's "System One" model, released 2026-09-15 and available on Workers AI.
It does **not** generate text. It reads a `state` and answers named, typed questions:

| Type | Answers | Used for |
|---|---|---|
| `choice` | one label from a fixed set + a probability per label | intent, match level, which evidence record |
| `score` | a probability-weighted level on an ordered rubric (can land between levels) | overall fit |
| `noul` | one yes-probability | "can the KB answer this?" |

So Jev **cannot replace the chat model** — it has no voice. It replaces the *decisions* the 8B
model kept getting wrong. Independent evaluations report good calibration at the extremes and
weak calibration in the 0.3–0.8 band, plus mild overconfidence; every gate below acts only on
strong signals, and the UI never presents Jev's probability as hiring odds.

## Architecture

```
visitor ──► chatbot.js
            ├─ tier 1: instant TOPICS (offline, fallback for every failure)
            └─ tier 2: Worker
                 chat:      Jev triage {intent, answerable}
                              ├─ compensation ≥ 0.6  → {action: salary}   (no LLM)
                              ├─ answerable < 0.2    → {action: handoff}  (no LLM; greetings exempt)
                              ├─ job-match ≥ 0.6     → Llama answer + {action: jd}
                              └─ otherwise / Jev slow (>2.5 s) or down → Llama answer
                 jd-decide: 1 Jev call  (level_i, evidence_i per requirement + overall_fit)
                            → provenance rules (demote, never fail) → templated EN/BM copy
                            → Llama writes the narrative only (plain text; templated fallback)
                 jd-scoring: unchanged two-call LLM path — the browser's fallback
```

- **One contract.** `jd-decide` relays the `jd-scoring` shape plus optional `engine: "jev"`
  and per-requirement `probability`. `jd-reasoning.js` accepts both as optional, so a single
  validator and `mergeResult` serve both modes.
- **Wider evidence.** Jev sees every citable (professional/academic) record, not only the ids
  the keyword pass touched, so it can find that Azure DevOps release work sits next to a
  Kubernetes requirement. The browser checks the response against
  `JDReasoning.buildDecisionInput(input, profile)`, built from the same profile file.
- **Deploy-order safe.** A Worker from before Jev answers `jd-decide` as an unknown chat request
  (`400 empty`); the browser falls through to `jd-scoring`. A Worker with Jev talking to an old
  browser only adds `action`/`intent` keys an old browser ignores, and an empty reply it already
  treats as a cloud miss.
- **The one non-fall-through:** a 4xx naming a `jd-` rule (`jd-privacy-invalid`, …) — the
  Worker refused the body itself and `jd-scoring` validates the identical body.

## UX changes

- No model switcher, no download box; the status line is `AI mode · secure cloud` or
  `Instant answers · works offline`. The greeting and the welcome callout no longer promise
  on-device privacy.
- Salary questions get Ameer's curated compensation line plus the handoff; out-of-knowledge
  questions go straight to the handoff, recorded as "AIMeer couldn't answer this one".
- A job-match question in plain chat gets a one-time offer to open the JD matcher.
- JD upload card is a drop zone (same checks as the picker; hint hidden on touch screens).
- Each requirement card shows "NN% decision confidence" with a meter; the reasoning note says
  the decisions came from Jev and only the summary paragraph from a language model.
- `motion.js` choreographs a freshly settled report on `aimeer:jd-report`: sections stagger in,
  the score counts up, the meters grow. Reduced motion or missing GSAP → the report is simply
  there.

## Rollout

1. Paste `cloud/aimeer-worker.js` into the dashboard, Deploy.
2. `{"mode":"version"}` → `2026-10-02-jev-1`; `{"mode":"jev-probe"}` → `ok: true` and which
   model id answered (`@cf/typesafe/jev` or `typesafe/jev`).
3. Merge to `main` (that is the site deploy). Either order is safe; this order means the first
   live report is already Jev-decided.
4. Smoke: a salary question, a nonsense question, a JD paste. In DevTools, a
   `JD decide fallback to scoring:` warning names the reason if Jev did not answer.

## Redesign brief (the Abbott CRM prompt, retuned for this work)

The original prompt — *"Design an interactive, awwwards-winning website to revamp the Abbott
CRM … showcase the platform's core workflows: seamlessly entering customer information,
purchasing products, and uploading receipts"* — retuned for AIMeer:

> Redesign **AIMeer** — the AI twin and recruiter JD matcher on ameeradhwa92.github.io — as an
> interactive, Awwwards-calibre experience inside the existing portfolio. Use micro-animations
> on the site's vendored **GSAP 3.15** (core, ScrollTrigger, SplitText) and, where it earns its
> weight, the vendored **three.js r185**, to make it feel premium — but every motion must
> explain what the system is doing (reading → deciding → writing), never just decorate it.
> Showcase the three core workflows end to end:
>
> 1. **Ask** — a visitor asks about Ameer's career; the answer arrives grounded in his
>    published profile, and anything the profile does not cover is handed over honestly
>    instead of guessed.
> 2. **Match** — a recruiter pastes a job description or drops a PDF/DOCX; it is parsed in the
>    browser, each requirement is decided against published evidence, and an evidence-backed
>    report settles in: fit band first, then the score, then per-requirement decisions with how
>    sure the decision model was.
> 3. **Hand off** — the visitor sends Ameer a pre-filled summary of the chat or the match report
>    by WhatsApp or email, in one tap.
>
> Constraints: hand-written HTML/CSS/JS, no framework, no build step; the Monsoon palette (indigo
> night / lilac day) with iris for the interface and coral reserved for the journey thread;
> italic Fraunces eyebrows; every string in English and formal Bahasa Melayu (DBP);
> `prefers-reduced-motion` removes all motion and the experience stays complete; no content is
> hidden from a visitor without JavaScript or GSAP; works at 375 / 768 / 1440 in dark and light;
> never imply a hiring guarantee — a probability on screen is the model's confidence in its own
> decision, not the odds that Ameer fits the role.

What was built from it in this change: the drop zone, the decision meters, the settle
choreography and the triage-driven handoffs above. Deliberately **not** built: a three.js scene
inside the chat panel. The panel is 400 px wide and already loads PDF.js/JSZip on demand; three.js
belongs in a full-screen report view (roadmap, 3).

## Roadmap — what else would improve it

1. **A recorded-decision eval harness** (`tools/test_jev_fixtures.mjs`): a dozen real JDs with
   Ameer's own per-requirement verdicts, run against `jd-decide`, tracking agreement and how
   often a 0.6–0.8 "decision confidence" was wrong. This is how to know whether the 0.15
   evidence floor and the 0.8 / 0.55 confidence bands are right, rather than guessing.
2. **Shareable report.** Encode the settled report in a URL fragment (no server, nothing stored)
   so a recruiter can forward it to a hiring manager; add "Copy as text".
3. **Full-screen report view with an evidence constellation** (three.js, lazy, same import URL as
   the globe): requirements as nodes, linked to the evidence records Jev cited, line weight by
   decision confidence. Optional; the card list stays the accessible source of truth.
4. **Recruiter edits before scoring.** Let the recruiter flip a requirement between required and
   nice-to-have, or drop one, and re-decide only what changed (one small Jev call).
5. **Streaming chat answers** from Workers AI (SSE) for perceived speed — the latency the
   on-device tier was meant to hide.
6. **Per-IP rate limiting** in the Worker. Chat is now two AI calls per message; the free tier is
   10,000 neurons a day.
7. **An offline router, re-evaluated.** Julia-1 (Supersonic Labs, 144M parameters, Apache-2.0,
   ONNX/WebGPU build) is an open Jev-style decision model. It could replace the instant tier's
   regex `TOPICS` routing on capable devices — but benchmark it against the regex first; the
   lesson of WebLLM is that on-device must beat the simple thing, not merely run.
8. **Scanned PDFs.** The extractor reports "no readable text" for image-only PDFs; client-side
   OCR (Tesseract.js, lazily loaded) would close that gap.
9. **Re-check the text model.** Llama 3.1 8B fast writes only short prose now; evaluate newer
   Workers AI instruct models for the narrative and chat answers once Jev carries the structure.
