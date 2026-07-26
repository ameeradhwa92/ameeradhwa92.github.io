# Recruiter Knowledge Base and JD Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich AIMeer with verified recruiter-facing facts and add a local PDF/DOCX/paste JD matcher whose compatibility score is deterministic, evidence-based, bilingual, and clearly labelled as an estimate.

**Architecture:** Keep the existing static HTML/CSS/JS architecture and chatbot tiers. Store recruiter evidence in a small structured JSON file while mirroring the human-readable facts in the shared KB. Add a self-hosted document-extraction layer for PDF and DOCX files, then run a deterministic browser-side scorer; use local/cloud AI only for optional explanations after scoring.

**Tech Stack:** Hand-written HTML, CSS, and ES5-compatible JavaScript IIFEs; self-hosted PDF.js 4.10.38; self-hosted JSZip 3.10.1 plus XML parsing; existing WebLLM and Cloudflare Workers AI tiers; Node/browser verification scripts; Python HTTP server on port 8080.

## Global Constraints

- The site remains a GitHub Pages root-published user site with no framework, build step, or package manager.
- English is the DOM source of truth; every new visible string needs `data-i18n` plus a matching `window.I18N_MS` entry.
- The shared `assets/data/aimeer-kb.txt` remains the factual source for AIMeer answers; `assets/data/aimeer-profile.json` is the structured scoring registry and must mirror its recruiter facts.
- Only the existing WebLLM CDN dependency remains external; PDF/DOCX parsing libraries are self-hosted under `assets/vendor/`.
- PDF/DOCX content is parsed locally and kept in memory; deterministic scoring must work without WebGPU or the cloud Worker.
- Never publish salary, NRIC, home address, date of birth, benefits, leave, medical, signatures, or confidential contract language.
- The public notice-period fact must be worded as a stated contractual three-month notice period after confirmation, not as an unconditional promise.
- Academic coursework is evidence of academic exposure and must never be presented as professional experience.
- The disclaimer must appear before analysis and above every result in English and formal Bahasa Malaysia.
- Preserve the current instant/local/cloud chatbot fallback behavior and the Worker’s server-side persona/KB assembly.

---

### Task 1: Add recruiter evidence registry and source-backed KB content

**Files:**
- Create: `assets/data/aimeer-profile.json`
- Modify: `assets/data/aimeer-kb.txt`
- Modify: `docs/superpowers/specs/2026-07-24-portfolio-site-design.md`
- Test: `tools/verify_recruiter_profile.ps1`

**Interfaces:**
- Produces `aimeer-profile.json` with `profileVersion`, `noticePeriod`, `roles`, `education`, `skills`, `evidence`, and `privacyExclusions` fields consumed by the matcher.
- Keeps the KB’s recruiter section readable by the LLM and explicitly labels evidence as `professional`, `academic`, or `user-provided context`.

- [ ] **Step 1: Define the structured evidence contract**

Add a JSON registry with this shape:

```json
{
  "profileVersion": "2026-07-26",
  "noticePeriod": {
    "valueMonths": 3,
    "text": "Stated contractual notice period: three months after confirmation.",
    "evidenceType": "employment-document"
  },
  "roles": [
    {
      "title": "Full Stack Web Specialist",
      "employer": "RetailAIM Malaysia Sdn. Bhd.",
      "from": "2025-08-01",
      "evidenceType": "employment-document",
      "context": "Redesignation followed outstanding performance in the previous role and organizational restructuring."
    }
  ],
  "skills": [{"name": "ASP.NET Core", "aliases": [".net", "asp.net", "asp.net core"], "evidence": ["RetailAIM Plus", "Abbott CRM"]}],
  "education": [{"qualification": "Diploma in Computer Science", "institution": "UiTM Dungun", "cgpa": 3.03, "subjects": []}],
  "evidence": [],
  "privacyExclusions": ["salary", "nric", "home address", "date of birth", "benefits", "leave", "medical", "confidential contract terms"]
}
```

Keep the complete registry factual: include all normalized technology aliases, production projects, academic subjects, final-year projects, language evidence, and the redesignation source distinction.

- [ ] **Step 2: Add the human-readable recruiter KB section**

Append a clearly headed section to `aimeer-kb.txt` covering the verified role dates, three-month notice period, redesignation context, CGPAs, subject clusters, academic projects, language ability, and evidence labels. Explicitly state that the performance context is supplied by Ameer while the redesignation letter confirms the new designation and organizational-structure change.

- [ ] **Step 3: Update the canonical registry/spec copy**

Add the current role transition and recruiter-facing education details to the project/design registry without adding private contract data. Keep project URLs and status entries unchanged.

- [ ] **Step 4: Add source-pattern verification**

Create `tools/verify_recruiter_profile.ps1` that fails unless the JSON, KB, and registry contain the same role-transition dates, notice period, CGPAs, disclaimer-related evidence labels, and privacy exclusions, and fails if forbidden tokens such as the salary amount, NRIC, or address appear in the public KB.

- [ ] **Step 5: Run the verification**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\verify_recruiter_profile.ps1
git diff --check
```

Expected: all profile checks pass and `git diff --check` reports no whitespace errors.

- [ ] **Step 6: Commit the source-backed profile update**

```powershell
git add assets/data/aimeer-profile.json assets/data/aimeer-kb.txt docs/superpowers/specs/2026-07-24-portfolio-site-design.md tools/verify_recruiter_profile.ps1
git commit -m "feat: add recruiter profile evidence"
```

### Task 2: Vendor and isolate local PDF/DOCX extraction

**Files:**
- Create: `assets/vendor/pdfjs/pdf.min.mjs`
- Create: `assets/vendor/pdfjs/pdf.worker.min.mjs`
- Create: `assets/vendor/jszip/jszip.min.js`
- Create: `assets/js/jd-extractor.js`
- Create: `tools/fixtures/jd-text.pdf`
- Create: `tools/fixtures/jd-sample.docx`
- Create: `tools/fixtures/jd-image-only.pdf`
- Test: `tools/test_jd_extractor.mjs`

**Interfaces:**
- Produces `window.JDExtractor.extract(file): Promise<{text, source, warnings}>`.
- Produces `window.JDExtractor.normalize(text): {rawText, normalizedText, sections, terms, warnings}`.
- Does not upload files or persist extracted text.

- [ ] **Step 1: Vendor pinned parser assets**

Place the pinned PDF.js 4.10.38 browser module and worker, plus JSZip 3.10.1, under the listed `assets/vendor/` paths. Record the exact upstream license notices in `assets/vendor/README.md`. Do not add a CDN URL.

- [ ] **Step 2: Write extraction fixtures and failing tests**

Create a text PDF and DOCX containing headings for required skills, preferred skills, years of experience, and responsibilities. Create an image-only PDF and a malformed-file fixture. In `tools/test_jd_extractor.mjs`, assert that text PDF/DOCX extraction returns the expected terms, image-only PDF returns a warning, malformed input rejects with a user-safe error, and pasted text normalization preserves section names.

- [ ] **Step 3: Implement PDF extraction**

Configure PDF.js to use the self-hosted worker, iterate pages, collect text items in reading order, cap the input at 10 MB and extracted output at 60,000 characters, and return a warning when no meaningful text is extracted.

- [ ] **Step 4: Implement DOCX extraction**

Use JSZip to open the DOCX package, read `word/document.xml`, convert paragraph and table-cell runs to text, preserve heading-like paragraph boundaries, decode XML entities, and return a user-safe error for encrypted or invalid ZIP content.

- [ ] **Step 5: Implement normalization**

Normalize whitespace and punctuation, detect section headings, map aliases such as `.NET`/`ASP.NET Core`, `C Sharp`/`C#`, `MS SQL`/`SQL Server`, and `React.js`/`React`, and identify requirement strength from headings and phrases such as “must have”, “required”, “preferred”, and “nice to have”.

- [ ] **Step 6: Run extraction tests**

Run:

```powershell
node tools\test_jd_extractor.mjs
```

Expected: all PDF, DOCX, pasted-text, malformed-file, and image-only warning checks pass.

- [ ] **Step 7: Commit the extraction layer**

```powershell
git add assets/vendor assets/js/jd-extractor.js tools/fixtures tools/test_jd_extractor.mjs
git commit -m "feat: add local JD document extraction"
```

### Task 3: Implement deterministic recruiter scoring

**Files:**
- Create: `assets/js/jd-matcher.js`
- Create: `tools/test_jd_matcher.mjs`
- Modify: `assets/data/aimeer-profile.json` only if the finalized evidence contract needs a documented field adjustment

**Interfaces:**
- Consumes `JDExtractor.normalize()` output and `assets/data/aimeer-profile.json`.
- Produces `window.JDMatcher.scoreJobDescription(normalizedJd, profileEvidence): MatchResult` with `score`, `categories`, `strongMatches`, `partialMatches`, `gaps`, `unverified`, `evidence`, and `interviewTopics`.

- [ ] **Step 1: Write failing scoring tests**

Cover these cases:

```js
assert.equal(score("ASP.NET Core, React, SQL Server, Azure", required), 80 /* expected weighted result */);
assert(result.strongMatches.some(x => x.term === "ASP.NET Core"));
assert(result.partialMatches.some(x => x.label.includes("academic")));
assert(result.gaps.every(x => !x.label.includes("salary")));
```

Also test required terms outweigh preferred terms, aliases collapse to one skill, coursework is labelled academic, an unknown JD produces an explainable low-confidence result, and a JD asking for salary does not expose a salary value.

- [ ] **Step 2: Implement evidence indexing**

Build maps from normalized skill aliases, role evidence, production project evidence, integration evidence, mobile evidence, education subjects, and languages. Keep a `professional` versus `academic` evidence type on every match.

- [ ] **Step 3: Implement weighted scoring**

Use the approved weights: core technologies 35%, professional experience/seniority 20%, production architecture/delivery/cloud 15%, domain/integrations 10%, mobile 5%, education/coursework 10%, languages/communication 5%. Required terms receive stronger contribution than preferred terms. Clamp the final score to 0-100 and expose category-level contributions so the UI can explain it.

- [ ] **Step 4: Implement gap and confidence classification**

Classify each JD requirement as strong match, partial/transferable match, missing evidence, or unverified. Use “unverified” when the profile does not establish the requirement rather than asserting that Ameer lacks it. Generate interview topics from high-weight partials and unverified requirements.

- [ ] **Step 5: Run matcher tests**

Run:

```powershell
node tools\test_jd_matcher.mjs
```

Expected: all weighting, alias, evidence-type, privacy, and explainability checks pass.

- [ ] **Step 6: Commit the scoring engine**

```powershell
git add assets/js/jd-matcher.js tools/test_jd_matcher.mjs
git commit -m "feat: add deterministic JD match scoring"
```

### Task 4: Add recruiter-mode chatbot UI and bilingual copy

**Files:**
- Modify: `index.html`
- Modify: `assets/css/style.css`
- Modify: `assets/js/chatbot.js`
- Modify: `assets/js/i18n.js`
- Test: `tools/verify_recruiter_ui.ps1`

**Interfaces:**
- `chatbot.js` calls `JDExtractor`, `JDMatcher`, and renders a result without changing ordinary AIMeer questions.
- New DOM controls use stable IDs: `chat-jd-toggle`, `chat-jd-panel`, `chat-jd-input`, `chat-jd-file`, `chat-jd-file-name`, `chat-jd-analyze`, `chat-jd-clear`, `chat-jd-disclaimer`, `chat-jd-status`, and `chat-jd-result`.

- [ ] **Step 1: Add the recruiter controls and disclaimer markup**

Add a visible `Match a JD` chip/button and a collapsible recruiter panel inside the chat panel. Include a paste area, PDF/DOCX file input, replace/clear controls, analyze button, `aria-live` status, and the exact English disclaimer in a dedicated element above the result.

- [ ] **Step 2: Add responsive styling**

Style the panel using existing chat tokens, keep upload controls usable at 375px, display category scores and evidence labels without horizontal overflow, and add reduced-motion behavior alongside the existing chat media rules.

- [ ] **Step 3: Add English and Bahasa Malaysia strings**

Add all static labels to `data-i18n` and `i18n.js`. Add dynamic labels, parser errors, score labels, evidence labels, and disclaimer text to both `T.en` and `T.ms` in `chatbot.js`. Use formal Bahasa Malaysia terminology such as “huraian jawatan”, “padanan”, “bukti profesional”, “pendedahan akademik”, and “keperluan yang belum disahkan”.

- [ ] **Step 4: Wire extraction and scoring**

On file selection, validate extension and size, call `JDExtractor.extract`, show the source and warnings, and keep text in a private in-memory variable. On analyze, prefer pasted text when non-empty, otherwise use extracted text, call `JDMatcher.scoreJobDescription`, and render the deterministic result.

- [ ] **Step 5: Render the result and enforce the disclaimer**

Render the score, category breakdown, strong/partial/gap/unverified sections, evidence-type labels, and interview topics. Insert the disclaimer both before the analyze action and directly above each rendered result. Do not allow the optional AI explanation to replace or hide the deterministic score or disclaimer.

- [ ] **Step 6: Add clear/reset behavior**

Clear the textarea, file input, filename, warnings, private extracted text, and result when the recruiter presses Clear. Ensure replacing a file cannot leave the previous file’s extracted text active.

- [ ] **Step 7: Run static UI checks**

Create `tools/verify_recruiter_ui.ps1` to assert all stable IDs exist, every `data-i18n` key has an English DOM value and `I18N_MS` value, the disclaimer appears in both languages, and the original four AIMeer chips remain intact.

- [ ] **Step 8: Commit the recruiter UI**

```powershell
git add index.html assets/css/style.css assets/js/chatbot.js assets/js/i18n.js tools/verify_recruiter_ui.ps1
git commit -m "feat: add recruiter JD matching mode"
```

### Task 5: Add optional AI explanation without weakening privacy or routing

**Files:**
- Modify: `assets/js/chatbot.js`
- Modify: `cloud/aimeer-worker.js`
- Test: `tools/test_recruiter_cloud_payload.mjs`

**Interfaces:**
- Produces an optional explanation request with `mode: "jd-explanation"`, bounded normalized JD text, and the deterministic `MatchResult`.
- Worker returns `{reply}` only after validating the mode, payload sizes, and user/assistant message shape; it never accepts a client system prompt.

- [ ] **Step 1: Add an explicit explanation action**

Show an “Explain this result with AIMeer” action only after the deterministic result exists. Explain that cloud mode sends the bounded JD/result payload to the secure Worker; local AI keeps it on-device when available.

- [ ] **Step 2: Add Worker validation and prompt construction**

Add a separate `jd-explanation` branch that loads the same KB server-side, limits JD text and result JSON, and instructs the model to explain only the supplied score/evidence, preserve academic/professional distinctions, and repeat the estimate disclaimer. Keep chat and summary behavior unchanged.

- [ ] **Step 3: Add payload tests**

Assert that the client payload contains no system role, rejects oversized JD text/results, preserves the disclaimer requirement, and uses the existing allowed-origin/CORS rules.

- [ ] **Step 4: Run payload checks and commit**

Run:

```powershell
node tools\test_recruiter_cloud_payload.mjs
git add assets/js/chatbot.js cloud/aimeer-worker.js tools/test_recruiter_cloud_payload.mjs
git commit -m "feat: add optional JD match explanation"
```

### Task 6: End-to-end verification and handoff

**Files:**
- Modify: `cloud/README.md` if the new Worker mode changes deployment notes
- Test: `tools/verify_recruiter_profile.ps1`
- Test: `tools/verify_recruiter_ui.ps1`
- Test: `tools/test_jd_extractor.mjs`
- Test: `tools/test_jd_matcher.mjs`
- Test: `tools/test_recruiter_cloud_payload.mjs`

- [ ] **Step 1: Run automated checks**

Run all source, extraction, matcher, payload, and whitespace checks. Expected: every check passes.

- [ ] **Step 2: Serve the site correctly**

Run:

```powershell
python -m http.server 8080
```

Open `http://localhost:8080` so the existing Worker origin allowlist remains valid.

- [ ] **Step 3: Test recruiter workflows manually**

At 375px, 768px, and 1440px, test pasted JD, text PDF, DOCX, image-only PDF fallback, malformed file fallback, replacement, clear, and repeated analysis. Confirm score evidence and disclaimer remain visible.

- [ ] **Step 4: Test language, theme, and accessibility states**

Check English/Bahasa Malaysia, dark/light theme, keyboard-only upload/analyze/clear flow, `aria-live` errors, and reduced-motion mode.

- [ ] **Step 5: Test fallback and privacy behavior**

Disable cloud and WebGPU and confirm deterministic scoring still works. Inspect browser state after Clear and verify no JD is written to localStorage, URL parameters, the KB, or the Worker unless the recruiter explicitly requests an AI explanation.

- [ ] **Step 6: Test existing chatbot behavior**

Verify the original topic chips, instant answers, salary handoff, cloud/local switching, and WhatsApp/email summary still work. Confirm salary questions continue to avoid salary figures.

- [ ] **Step 7: Run link and repository checks**

Run the repository’s project URL curl audit before changing any project status, then run `git diff --check` and inspect `git status --short`.

- [ ] **Step 8: Hand off the Worker deployment note**

State explicitly that changes to `cloud/aimeer-worker.js` are not live until pasted and deployed in the Cloudflare dashboard. Report source checks separately from any unavailable production DB/IIS or Worker smoke test.

