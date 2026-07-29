# Recruiter JD Hybrid Reasoning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded, evidence-cited reasoning layer to AIMeer's deterministic recruiter JD matcher without changing the authoritative baseline score or existing routing contracts.

**Architecture:** Extend the deterministic matcher with stable requirement/evidence references, add a small browser-side `JDReasoning` module for payload construction, validation, score merging, and fallback, and add a parallel validated `jd-reasoning` mode to the Cloudflare Worker. Render deterministic results immediately and structured reasoning only after an explicit recruiter action.

**Tech Stack:** Hand-written JavaScript IIFEs, JSON profile data, HTML/CSS, Cloudflare Workers AI, Node's built-in `node:test`, VM-based browser harnesses, no framework, no build step, no new CDN dependency.

## Global Constraints

- Preserve section-aware JD extraction and administrative/application-text filtering.
- Preserve inactive categories and do not penalize categories absent from a JD.
- Preserve professional, academic, user-provided, and unverified evidence distinctions.
- Do not infer technology-specific years from total career tenure.
- Keep `JDMatcher.scoreJobDescription().score` as the authoritative deterministic baseline.
- Keep AIMeer local/cloud routing, WebLLM cancellation, focused JD mode, and AI progress behavior unchanged.
- Do not accept client-supplied Worker system prompts.
- Render all model-derived content as text, never raw HTML.
- Add English and formal Bahasa Melayu copy for every new user-visible string.
- Keep salary, NRIC, address, birth date, benefits, leave, medical, signature, and confidential contract data excluded.
- Run `node --test (Get-ChildItem tests -Filter '*.test.js' | Select-Object -ExpandProperty FullName)`, syntax checks, and `git diff --check` before completion.

---

### Task 1: Add the recruiter evidence registry

**Files:**
- Modify: `assets/data/aimeer-profile.json`
- Test: `tests/jd-reasoning.test.js`

**Interfaces:**
- Produces `profile.recruiterEvidence[]` records with stable `id`, `evidenceType`, `claim`, `technologies`, `capabilities`, `scope`, and `sourceLabel` fields.
- Keeps all existing `skills`, `education`, `verifiedTenure`, `evidence`, and `privacyExclusions` fields valid.

- [ ] **Step 1: Write the failing registry tests**

Assert that the profile contains stable records for professional production delivery, Azure infrastructure, web/API architecture, mobile delivery, quality practices, database design, stakeholder collaboration, academic foundation, and user-provided Agile/AI-tool context. Assert that every record has one of `professional`, `academic`, or `user-provided` evidence types and that no claim contains a privacy exclusion.

- [ ] **Step 2: Run the focused test**

Run: `node --test tests/jd-reasoning.test.js`

Expected: FAIL because `recruiterEvidence` does not yet exist.

- [ ] **Step 3: Add stable evidence records**

Use explicit IDs such as `professional.azure-delivery`, `professional.mobile-delivery`, `professional.application-quality`, `academic.intelligent-systems`, and `user.agile-context`. Keep each claim limited to facts already present in the profile and KB. Do not add employers, dates, durations, products, or links that are not already evidenced.

- [ ] **Step 4: Run the focused test**

Run: `node --test tests/jd-reasoning.test.js`

Expected: PASS for registry shape, evidence types, and privacy exclusions.

- [ ] **Step 5: Commit**

Run: `git add assets/data/aimeer-profile.json tests/jd-reasoning.test.js; git commit -m "feat: add recruiter reasoning evidence registry"`

### Task 2: Extend deterministic matcher output without changing its score

**Files:**
- Modify: `assets/js/jd-matcher.js`
- Test: `tests/jd-matcher.test.js`

**Interfaces:**
- `JDMatcher.scoreJobDescription(normalizedJd, profile)` continues returning the current `score`, category objects, match lists, evidence groups, interview topics, and confidence.
- Adds `deterministicScore`, `requirements[]`, stable `id` values, `original`, `strength`, `category`, `yearsRequired`, `specificHandsOn`, `classification`, `evidenceType`, and `evidenceRefs`.

- [ ] **Step 1: Add baseline regression fixtures**

Create fixtures for exact ASP.NET Core/C# professional evidence, Kubernetes with Azure delivery transfer, Laravel with an unpublished technology duration, academic-only Android/Tesseract evidence, user-provided Agile context, administrative salary/location questions, and a JD with an absent mobile category.

- [ ] **Step 2: Run the matcher tests before implementation**

Run: `node --test tests/jd-matcher.test.js`

Expected: FAIL for the new requirement/evidence fields while existing score assertions establish the baseline.

- [ ] **Step 3: Add stable requirement IDs and evidence references**

Assign IDs after requirement deduplication using deterministic ordering. Attach source text and existing classification metadata. Resolve recruiter evidence IDs from the profile registry while retaining existing evidence strings for backward compatibility. Keep `scoreCategory`, strength factors, match factors, active-category normalization, and duration handling unchanged.

- [ ] **Step 4: Verify score invariants**

Assert that every fixture's old deterministic score equals its new `score` and `deterministicScore`; absent categories remain inactive; administrative text creates no technical requirements; Laravel duration remains partial or a gap rather than becoming a full technology-duration match.

- [ ] **Step 5: Run the focused test**

Run: `node --test tests/jd-matcher.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

Run: `git add assets/js/jd-matcher.js tests/jd-matcher.test.js; git commit -m "feat: expose stable recruiter match evidence"`

### Task 3: Create the bounded browser reasoning module

**Files:**
- Create: `assets/js/jd-reasoning.js`
- Modify: `index.html`
- Test: `tests/jd-reasoning.test.js`

**Interfaces:**
- `window.JDReasoning.buildInput(normalizedJd, deterministicResult, profile, language)` returns a bounded reasoning payload.
- `window.JDReasoning.validateModelOutput(rawOutput, input)` returns `{ ok: true, reasoning }` or `{ ok: false, error }`.
- `window.JDReasoning.mergeResult(deterministicResult, reasoning, input)` returns the extended result with `verifiedScore`, `transferableScore`, `compositeScore`, and validated sections.
- `window.JDReasoning.fallback(deterministicResult, input, language)` returns deterministic recruiter-facing reasoning.

- [ ] **Step 1: Add failing validator tests**

Cover valid structured JSON, malformed JSON, markdown-wrapped JSON, unknown requirement IDs, duplicate requirement IDs, unknown evidence references, unsupported capability names, invalid match levels, overlong fields, and model-supplied numeric scores.

- [ ] **Step 2: Run the focused test**

Run: `node --test tests/jd-reasoning.test.js`

Expected: FAIL because `JDReasoning` is not loaded.

- [ ] **Step 3: Implement bounded input construction**

Include only normalized requirements, deterministic classifications, registry records referenced by those requirements, the allowlisted capability vocabulary, and language. Exclude contact details, private contract facts, and all privacy exclusions. Enforce the 12,000-character JD/result limits already used by the explanation flow.

- [ ] **Step 4: Implement strict output validation**

Parse JSON, reject unknown keys where the contract requires closed objects, verify all requirement/evidence references, cap arrays and strings, and require `evidenceRefs` for evidence-based conclusions. Ignore model-provided score fields.

- [ ] **Step 5: Implement score merging**

Compute verified coverage from deterministic direct evidence. Compute transferable coverage from the validated taxonomy. Apply semantic lift only to partial/unverified requirements, cap total lift at 15 points, and apply the required-explicit-gap ceiling. Preserve the original deterministic score unchanged.

- [ ] **Step 6: Implement deterministic fallback**

Generate strengths, gaps, limitations, and interview topics directly from existing deterministic match lists when the model fails or returns invalid JSON.

- [ ] **Step 7: Load the script before `chatbot.js`**

Add `<script src="assets/js/jd-reasoning.js" defer></script>` after `jd-matcher.js` and before `chatbot.js` in `index.html`.

- [ ] **Step 8: Run the focused test**

Run: `node --test tests/jd-reasoning.test.js`

Expected: PASS.

- [ ] **Step 9: Commit**

Run: `git add assets/js/jd-reasoning.js index.html tests/jd-reasoning.test.js; git commit -m "feat: add bounded JD reasoning validator"`

### Task 4: Integrate local and cloud reasoning with existing chatbot state

**Files:**
- Modify: `assets/js/chatbot.js`
- Modify: `assets/js/i18n.js`
- Modify: `assets/css/style.css`
- Test: `tests/chat-model-switcher.test.js`

**Interfaces:**
- Existing `analyzeRecruiterMatch()` still performs extraction and deterministic scoring first.
- New internal `requestJdReasoning()` captures the current `analysisRequestToken` and result identity before starting local/cloud work.
- Existing `nextExplanationToken`, route selection, local engine, cloud fetch, and focused-panel behavior remain intact.

- [ ] **Step 1: Add failing UI and concurrency tests**

Assert that deterministic results render before reasoning, that reasoning can be requested explicitly, that local and cloud status copy is localized, that local/cloud failure leaves the deterministic score visible, and that a stale response cannot replace a newer JD result.

- [ ] **Step 2: Run the focused UI tests**

Run: `node --test tests/chat-model-switcher.test.js`

Expected: FAIL for the new reasoning controls and result sections.

- [ ] **Step 3: Add localized dynamic strings**

Add English and formal Bahasa Melayu entries to the chatbot `T` table for verified score, transferable opportunity, calibrated fit, requirement intent, boundary, recruiter framing, verification question, learning bridge, reasoning failure, local reasoning, cloud reasoning, and privacy status. Add matching `data-i18n`/`I18N_MS` entries in `index.html`/`i18n.js` for any static labels introduced.

- [ ] **Step 4: Integrate explicit reasoning requests**

Build the validated input from the current result, route to the local model or new Worker mode, apply `JDReasoning.validateModelOutput`, merge only after token/result checks, and use `JDReasoning.fallback` on failure. Invalidate reasoning whenever `clearJdResult()` or a new analysis begins.

- [ ] **Step 5: Render the structured result accessibly**

Preserve the current score/categories/lists. Add score measures, expandable requirement cards, strengths, transferable advantages, priority gaps, learning bridges, interview topics, narrative, and local/cloud status. Use DOM node creation and `textContent` for every model-derived value.

- [ ] **Step 6: Add responsive and reduced-motion styles**

Extend existing `chat-jd-*` styles for score cards and expandable requirement sections. Keep buttons keyboard-visible, preserve 44px touch targets, support 375px width, both themes, and `prefers-reduced-motion: reduce`.

- [ ] **Step 7: Run the focused UI tests**

Run: `node --test tests/chat-model-switcher.test.js`

Expected: PASS, including the existing focused-panel and AI-progress tests.

- [ ] **Step 8: Commit**

Run: `git add assets/js/chatbot.js assets/js/i18n.js assets/css/style.css tests/chat-model-switcher.test.js; git commit -m "feat: show recruiter hybrid reasoning"`

### Task 5: Add the Worker `jd-reasoning` contract

**Files:**
- Modify: `cloud/aimeer-worker.js`
- Modify: `cloud/README.md`
- Test: `tests/jd-worker-contract.test.js`

**Interfaces:**
- New request mode: `{ mode: "jd-reasoning", language, jdText, deterministicInput, evidenceIds }`.
- New response: `{ reasoning: <strict structured JSON> }` or a safe error response.
- Existing `chat`, `summary`, and `jd-explanation` modes remain compatible.

- [ ] **Step 1: Add failing Worker contract tests**

Assert rejection of missing language, oversized JD text, unknown evidence IDs, unknown requirement IDs, malformed deterministic input, client system prompts, invalid enum values, and privacy terms. Assert acceptance of a bounded valid request.

- [ ] **Step 2: Run the focused Worker tests**

Run: `node --test tests/jd-worker-contract.test.js`

Expected: FAIL because the new mode and validator do not exist.

- [ ] **Step 3: Add canonical profile loading**

Add a cached `PROFILE_URL` pointing to `assets/data/aimeer-profile.json`, load only the recruiter evidence registry for reasoning, and reject evidence IDs not present in the canonical profile.

- [ ] **Step 4: Add the new mode and strict validation**

Validate bounded JD text, language, requirement IDs, evidence IDs, capability names, and deterministic input. Assemble the system prompt from the server-side persona, recruiter-safe profile evidence, and shared reasoning instructions. Never append a client-provided system message.

- [ ] **Step 5: Require structured JSON from Workers AI**

Use low temperature and bounded tokens. Parse the model response; return a safe `reasoning-invalid` error when JSON or the schema is invalid. Do not return a model-supplied score as authoritative.

- [ ] **Step 6: Update manual deployment documentation**

Document that the Worker source has changed, the dashboard editor must be updated manually, the `AI` binding remains required, and the live endpoint must be smoke-tested after deployment.

- [ ] **Step 7: Run the focused Worker tests**

Run: `node --test tests/jd-worker-contract.test.js`

Expected: PASS.

- [ ] **Step 8: Commit**

Run: `git add cloud/aimeer-worker.js cloud/README.md tests/jd-worker-contract.test.js; git commit -m "feat: add cloud recruiter reasoning mode"`

### Task 6: Add calibration and regression coverage

**Files:**
- Modify: `tests/jd-matcher.test.js`
- Modify: `tests/jd-reasoning.test.js`
- Modify: `tests/chat-model-switcher.test.js`
- Create: `tests/fixtures/jd-laravel-enterprise.txt`
- Create: `tests/fixtures/jd-kubernetes-transfer.txt`
- Create: `tests/fixtures/jd-mobile-framework-transfer.txt`

**Interfaces:**
- Fixtures expose old deterministic score, new deterministic score, validated match levels, allowed lift, composite score, and remaining gaps.

- [ ] **Step 1: Add the Laravel regression fixture**

Assert the deterministic score is unchanged, Laravel-specific duration remains partial when unpublished, and semantic reasoning cannot convert it into a full duration match.

- [ ] **Step 2: Add Kubernetes transfer fixture**

Assert Kubernetes remains unverified or explicitly limited while Azure App Service, Azure DevOps, Bicep, deployment, and operational capabilities can produce only bounded transferable credit.

- [ ] **Step 3: Add mobile/framework transfer fixture**

Assert professional Android/iOS/Flutter evidence can support transferable mobile delivery reasoning without claiming an unproven named framework.

- [ ] **Step 4: Add score-change audit assertions**

For every fixture, capture the pre-reasoning result as `before`, the validated model output as `reasoning`, and the merged result as `after`. Assert `after.deterministicScore === before.score`, calculate the expected lift from the validated match levels and requirement weights, assert `after.compositeScore === Math.min(after.transferableScore, before.score + 15, requiredGapCeiling)`, and assert every score change has evidence references, a limitation, and a verification question. The Laravel fixture must retain the approved deterministic baseline of 87 while keeping the technology-specific duration limitation visible.

- [ ] **Step 5: Run the full suite**

Run: `node --test (Get-ChildItem tests -Filter '*.test.js' | Select-Object -ExpandProperty FullName)`

Expected: all existing and new tests pass.

- [ ] **Step 6: Commit**

Run: `git add tests; git commit -m "test: calibrate recruiter hybrid reasoning"`

### Task 7: Verify source, privacy, and browser behavior

**Files:**
- Verify: `assets/js/jd-extractor.js`
- Verify: `assets/js/jd-matcher.js`
- Verify: `assets/js/jd-reasoning.js`
- Verify: `assets/js/chatbot.js`
- Verify: `assets/js/aimeer-device.js`
- Verify: `assets/js/i18n.js`
- Verify: `assets/data/aimeer-profile.json`
- Verify: `assets/data/aimeer-kb.txt`
- Verify: `cloud/aimeer-worker.js`
- Verify: `index.html`
- Verify: `assets/css/style.css`

- [ ] **Step 1: Run syntax checks**

Run: `node --check assets/js/jd-extractor.js; node --check assets/js/jd-matcher.js; node --check assets/js/jd-reasoning.js; node --check assets/js/chatbot.js; node --check assets/js/aimeer-device.js; node --check cloud/aimeer-worker.js`

Expected: no syntax errors.

- [ ] **Step 2: Run privacy and parity tests**

Run: `node --test tests/jd-reasoning.test.js tests/jd-worker-contract.test.js`

Expected: privacy exclusions and browser/Worker reasoning contract parity pass.

- [ ] **Step 3: Run formatting verification**

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 4: Run the local HTTP server**

Run from the repository root: `python -m http.server 8080`

Expected: the site is available at `http://localhost:8080` with local extraction and instant deterministic matching working without WebGPU or cloud AI.

- [ ] **Step 5: Perform browser checks**

Check 375px, 768px, and 1440px widths in dark/light themes and English/Bahasa Melayu. Verify deterministic result first, structured reasoning after explicit request, local/cloud labels, fallback behavior, stale-result protection, focused mode, AI progress preservation, keyboard access, and reduced-motion behavior.

- [ ] **Step 6: Verify Worker deployment boundary**

State clearly in the handoff that `cloud/aimeer-worker.js` is a manual Cloudflare dashboard copy and requires a separate deployment and endpoint smoke test. Do not claim cloud reasoning is live until that manual deployment succeeds.

- [ ] **Step 7: Final full verification**

Run: `node --test (Get-ChildItem tests -Filter '*.test.js' | Select-Object -ExpandProperty FullName); git diff --check`

Expected: all tests pass and the diff is clean.


