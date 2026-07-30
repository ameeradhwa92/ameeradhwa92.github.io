# Recruiter JD Progress Indicator and AI Confidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an honest indeterminate progress bar while the recruiter JD match is being scored, and stop the report pairing an AI-derived score with a keyword-derived confidence label.

**Architecture:** Presentation-only change across four files. `jd-reasoning.js` gains an `aiConfidence` aggregate derived from per-requirement confidences it already validates. `chatbot.js` picks the confidence source by scoring mode, drives a decorative progress bar from the existing `jdState.statusKind`, and surfaces the previously silent retry as its own phase. `index.html` and `style.css` carry the markup and the animation.

**Tech Stack:** Hand-written ES5-style IIFE JavaScript, plain CSS with custom properties, `node --test`, PowerShell verification harnesses. No framework, no build step, no package manager.

## Global Constraints

- **No build step.** Plain `<script defer>` IIFEs. Do not introduce imports, bundlers, or dependencies.
- **ES5 style in `assets/js/`.** `var`, `function`, no arrow functions, no `const`/`let`, no template literals — match the surrounding file exactly.
- **Every user-visible string needs both languages.** Strings JS generates live in the `T` table in `chatbot.js`, in **both** the `en` and `ms` branches — not in `i18n.js`. Bahasa Melayu follows Dewan Bahasa dan Pustaka conventions: formal register, DBP istilah.
- **Teal is the signature accent (`--teal`, `--teal-rgb`).** Amber (`--amber`) is reserved for Retired/EOL badges only — do not use it here.
- **`prefers-reduced-motion: reduce` must disable animation.** The existing block is at `assets/css/style.css:1095`.
- **Bump `?v=` in `index.html` and nowhere else** on any deploy touching CSS or JS. Current value: `2026-07-30e`. Target: `2026-07-30f`.
- **`cloud/aimeer-worker.js` must not be modified.** It is deployed by hand into the Cloudflare dashboard; changing it would require a manual paste. This work needs none.
- **Enum lookups use arrays + `indexOf`, not object-literal truthiness.** `jd-reasoning.js:104` documents why: a plain-object map keyed by model-supplied values lets `constructor`/`toString`/`valueOf` pass as valid.
- **Green means** `node --test "tests/*.test.js"` **and** all five `tools/` harnesses pass.

---

### Task 1: Aggregate AI confidence in `jd-reasoning.js`

**Files:**
- Modify: `assets/js/jd-reasoning.js` (add helper near `CONFIDENCE_LEVELS` at line ~108; call it in `mergeResult`)
- Test: `tests/jd-reasoning.test.js` (append)

**Interfaces:**
- Consumes: `requirementReasoning` entries built inside `mergeResult`, each carrying `confidence` (`"low" | "medium" | "high"`).
- Produces: `result.aiConfidence` — a `"low" | "medium" | "high"` string, **absent** when no requirement carried a valid confidence. Task 2 reads this property.

- [ ] **Step 1: Write the failing test**

Append to `tests/jd-reasoning.test.js`:

```js
/* The report used to print the AI's score beside the KEYWORD pass's confidence, which read as
   self-contradiction ("82% · Confidence: Low"). The model already returns a per-requirement
   confidence that both validators check; this aggregates it so the headline describes the same
   judgement the score came from. */
test('mergeResult aggregates per-requirement confidence into result.aiConfidence', () => {
  const harness = loadReasoningHarness();

  function mergeWithConfidences(confidences) {
    const input = {
      requirements: confidences.map((_, index) => ({
        id: 'req-core-technologies-term-' + index,
        term: 'Term ' + index,
        strength: 'required',
        category: 'coreTechnologies',
        yearsRequired: null,
        specificHandsOn: false,
        classification: 'unverified',
        evidenceType: 'unverified',
        evidenceRefs: []
      })),
      evidenceRegistry: []
    };
    const reasoning = {
      narrative: 'Bounded recruiter reasoning.',
      requirements: confidences.map((confidence, index) => ({
        requirementId: 'req-core-technologies-term-' + index,
        recruiterIntent: '',
        expectedOutcome: '',
        matchLevel: 'unverified',
        evidenceRefs: [],
        transferableCapabilities: [],
        limitation: '',
        recruiterFraming: '',
        verificationQuestion: '',
        confidence
      })),
      overall: { score: 70, fitBand: 'good', narrative: 'Overall.' }
    };
    return harness.JDReasoning.mergeResult({ score: 50, categories: {} }, reasoning, input);
  }

  assert.equal(mergeWithConfidences(['high', 'high', 'high']).aiConfidence, 'high');
  assert.equal(mergeWithConfidences(['high', 'low']).aiConfidence, 'medium');
  assert.equal(mergeWithConfidences(['low', 'low', 'low']).aiConfidence, 'low');
  assert.equal(mergeWithConfidences(['medium', 'medium']).aiConfidence, 'medium');

  /* Band edges: 0.833 sits above the 0.67 high threshold, 0.167 below the 0.34 medium one, and
     0.625 is the near-miss that must NOT round up to high. */
  assert.equal(mergeWithConfidences(['high', 'high', 'medium']).aiConfidence, 'high');
  assert.equal(mergeWithConfidences(['medium', 'low', 'low']).aiConfidence, 'low');
  assert.equal(mergeWithConfidences(['high', 'medium', 'medium', 'medium']).aiConfidence, 'medium');

  /* No requirements means nothing to aggregate. Absent, not defaulted — Task 2 falls through to
     the keyword label rather than inventing a confidence the model never expressed. */
  assert.equal('aiConfidence' in mergeWithConfidences([]), false);
});

/* A model-supplied confidence is untrusted input. An object-literal weight map would let
   Object.prototype members through as valid levels — the same trap CONFIDENCE_LEVELS documents. */
test('mergeResult ignores prototype-member confidence values', () => {
  const harness = loadReasoningHarness();
  const input = {
    requirements: [{
      id: 'req-core-technologies-term-0',
      term: 'Term 0',
      strength: 'required',
      category: 'coreTechnologies',
      yearsRequired: null,
      specificHandsOn: false,
      classification: 'unverified',
      evidenceType: 'unverified',
      evidenceRefs: []
    }],
    evidenceRegistry: []
  };
  const reasoning = {
    narrative: 'Bounded recruiter reasoning.',
    requirements: [{
      requirementId: 'req-core-technologies-term-0',
      recruiterIntent: '',
      expectedOutcome: '',
      matchLevel: 'unverified',
      evidenceRefs: [],
      transferableCapabilities: [],
      limitation: '',
      recruiterFraming: '',
      verificationQuestion: '',
      confidence: 'constructor'
    }],
    overall: { score: 70, fitBand: 'good', narrative: 'Overall.' }
  };

  const merged = harness.JDReasoning.mergeResult({ score: 50, categories: {} }, reasoning, input);
  assert.equal('aiConfidence' in merged, false);
});
```

If `tests/jd-reasoning.test.js` has no `loadReasoningHarness` helper, add this above the new tests:

```js
function loadReasoningHarness() {
  const context = { console, setTimeout, clearTimeout };
  context.globalThis = context;
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(repoRoot, 'assets', 'js', 'jd-reasoning.js'), 'utf8'), context);
  return { JDReasoning: context.JDReasoning };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/jd-reasoning.test.js`
Expected: FAIL — `aiConfidence` is `undefined`, so the first assertion reports `undefined !== 'high'`.

- [ ] **Step 3: Write minimal implementation**

In `assets/js/jd-reasoning.js`, directly below the `CONFIDENCE_LEVELS` declaration (~line 108), add:

```js
  /* Weights for aggregating the model's per-requirement confidence into one headline label.
     Read only after CONFIDENCE_LEVELS.indexOf has confirmed the value is a real level — the array
     check is what keeps Object.prototype members out, exactly as the comment above explains. */
  var CONFIDENCE_WEIGHTS = { low: 0, medium: 0.5, high: 1 };
```

Then add this function above `mergeResult`:

```js
  /* The report's headline confidence. It used to come from the keyword pass even when the score
     came from the model, so "82% · Confidence: Low" could appear with neither number wrong and the
     pair still misleading. Thresholds mirror buildConfidence's three bands in jd-matcher.js so the
     AI and fallback paths stay comparable.
     Returns "" when nothing valid was supplied; mergeResult then leaves the property off entirely
     rather than defaulting, so the renderer can tell "the model said low" from "the model said
     nothing" and fall back to the keyword label for the latter. */
  function aggregateAiConfidence(requirementReasoning) {
    var entries = Array.isArray(requirementReasoning) ? requirementReasoning : [];
    var total = 0;
    var counted = 0;
    for (var index = 0; index < entries.length; index += 1) {
      var confidence = entries[index] && entries[index].confidence;
      if (CONFIDENCE_LEVELS.indexOf(confidence) === -1) continue;
      total += CONFIDENCE_WEIGHTS[confidence];
      counted += 1;
    }
    if (!counted) return "";
    var mean = total / counted;
    return mean >= 0.67 ? "high" : mean >= 0.34 ? "medium" : "low";
  }
```

In `mergeResult`, immediately after `result.sections = buildSections(requirementReasoning);`, add:

```js
    var aiConfidence = aggregateAiConfidence(requirementReasoning);
    if (aiConfidence) result.aiConfidence = aiConfidence;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/jd-reasoning.test.js`
Expected: PASS, 0 failing.

Then confirm nothing else moved:

Run: `node --test "tests/*.test.js"`
Expected: PASS, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add assets/js/jd-reasoning.js tests/jd-reasoning.test.js
git commit -m "feat: aggregate per-requirement AI confidence into result.aiConfidence"
```

---

### Task 2: Pick the confidence source by scoring mode in `chatbot.js`

**Files:**
- Modify: `assets/js/chatbot.js` (add helper + export near line 230; use it in `renderJdResult` at line ~1004)
- Test: `tests/chat-model-switcher.test.js` (append)

**Interfaces:**
- Consumes: `result.aiConfidence` from Task 1.
- Produces: `window.AIMeerRecruiter.resolveConfidenceLevel(scoringMode, result, baseline)` returning `"low" | "medium" | "high" | ""`. Task 4's harness assertion references this name.

- [ ] **Step 1: Write the failing test**

Append to `tests/chat-model-switcher.test.js`:

```js
/* The score and its confidence must describe the same pass. On the AI path the label comes from
   the model's own per-requirement confidence; on the fallback path the keyword ratio IS what the
   displayed number means, so it stays. */
test('recruiter report takes confidence from whichever pass produced the score', async () => {
  const { context } = createChatContext({ saveData: false });
  await loadChat(context);
  const resolve = context.window.AIMeerRecruiter.resolveConfidenceLevel;

  const aiResult = { finalScore: 82, aiConfidence: 'medium' };
  const baseline = { score: 48, confidence: { label: 'low' } };

  assert.equal(resolve('ai', aiResult, baseline), 'medium',
    'a merged AI report should report the AI confidence');
  assert.equal(resolve('fallback', { score: 48 }, baseline), 'low',
    'the keyword estimate should keep the keyword confidence');
  assert.equal(resolve('pending', { score: 48 }, baseline), 'low',
    'before the AI settles there is no AI confidence to show');

  /* A merged report whose requirements carried no usable confidence has no aiConfidence at all.
     Falling back beats inventing one. */
  assert.equal(resolve('ai', { finalScore: 82 }, baseline), 'low');
  assert.equal(resolve('ai', { finalScore: 82, aiConfidence: '' }, baseline), 'low');
  assert.equal(resolve('ai', null, null), '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/chat-model-switcher.test.js`
Expected: FAIL with `TypeError: resolve is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `assets/js/chatbot.js`, add this function above the `window.AIMeerRecruiter` export block (line ~230):

```js
  /* Which pass's confidence belongs beside the displayed score. renderJdResult shows
     result.finalScore once AI scoring merges, but used to print the deterministic
     baseline.confidence.label unconditionally — so an AI score of 82% sat next to the keyword
     pass's "Low", computed in jd-matcher.js from strongCount/total and never told what the model
     concluded. Neither value was wrong; printing them adjacent implied they measured the same
     thing. On the fallback path the keyword confidence is exactly right, so it stays. */
  function resolveConfidenceLevel(scoringMode, result, baseline) {
    if (scoringMode === "ai" && result && result.aiConfidence) return result.aiConfidence;
    return baseline && baseline.confidence ? baseline.confidence.label || "" : "";
  }
```

Add to the export block, after `window.AIMeerRecruiter.canApplyAnalysisToken = canApplyAnalysisToken;`:

```js
  window.AIMeerRecruiter.resolveConfidenceLevel = resolveConfidenceLevel;
```

In `renderJdResult`, replace:

```js
    report.appendChild(createJdNode("p", "jd-report-score",
      formatScore(scoreValue) + "% · " + t("jdResultConfidenceLabel") + ": " +
      confidenceLabel(baseline.confidence && baseline.confidence.label)));
```

with:

```js
    report.appendChild(createJdNode("p", "jd-report-score",
      formatScore(scoreValue) + "% · " + t("jdResultConfidenceLabel") + ": " +
      confidenceLabel(resolveConfidenceLevel(jdState.scoringMode, result, baseline))));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test "tests/*.test.js"`
Expected: PASS, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add assets/js/chatbot.js tests/chat-model-switcher.test.js
git commit -m "fix: show the confidence belonging to the pass that produced the score"
```

---

### Task 3: Indeterminate progress bar and visible retry phase

**Files:**
- Modify: `index.html` (markup after the `chat-jd-actions` div, line ~672)
- Modify: `assets/css/style.css` (new rules after `.chat-jd-status.is-success` at line ~938; reduced-motion entry in the block at line ~1095)
- Modify: `assets/js/chatbot.js` (element ref, `T` keys, status branch, `renderJdProgress`, retry call)
- Test: `tests/chat-model-switcher.test.js` (append)

**Interfaces:**
- Consumes: `jdState.statusKind`, already set by `setJdStatus`.
- Produces: `window.AIMeerRecruiter.isJdProgressVisible(statusKind)` returning a boolean; the DOM id `chat-jd-progress`, which Task 4 asserts on.

- [ ] **Step 1: Write the failing test**

First add `'chat-jd-progress'` to the hard-coded element id array in `createChatContext` in `tests/chat-model-switcher.test.js` (line ~110), after `'chat-jd-status'`:

```js
    'chat-jd-status', 'chat-jd-progress', 'chat-jd-result'
```

Then append:

```js
/* Analyze match starts a cloud round trip that can run ten seconds or more — two model calls
   server-side plus one silent retry. A line of text alone made a slow analysis indistinguishable
   from a hang. The bar is derived from statusKind rather than tracked separately, so there is no
   second piece of state to fall out of sync. */
test('the recruiter progress bar is visible exactly while the matcher is working', async () => {
  const { context } = createChatContext({ saveData: false });
  await loadChat(context);
  const visible = context.window.AIMeerRecruiter.isJdProgressVisible;

  for (const working of ['reading', 'scoring', 'aiScoring', 'aiRetrying']) {
    assert.equal(visible(working), true, `${working} is an in-flight phase`);
  }
  for (const settled of ['idle', 'loaded', 'pasted', 'scored', 'error', '', undefined]) {
    assert.equal(visible(settled), false, `${settled} is not an in-flight phase`);
  }
});

/* The retry is a second full round trip that previously only reached console.warn. Leaving it
   unlabelled is what made a slow run look like a dead one. */
test('the retry phase has copy in both languages', () => {
  /* Counting definitions rather than slicing the T table by indentation: a missing MS key leaves
     English on screen silently, and one definition means exactly that happened. The `: "` suffix
     keeps the t("jdAiStatusRetrying") call site out of the count. */
  const definitions = chatbot.match(/jdAiStatusRetrying:\s*"/g) || [];
  assert.equal(definitions.length, 2,
    'jdAiStatusRetrying needs an entry in both the en and ms branches of T');
});

/* Project rule: prefers-reduced-motion must disable animation everywhere. */
test('the progress bar animation is disabled under reduced motion', () => {
  const block = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g;
  const blocks = css.match(block) || [];
  assert.ok(blocks.some((rule) => /\.chat-jd-progress-bar[^{]*\{[^}]*animation:\s*none/.test(rule)),
    'a reduced-motion block must set animation: none on .chat-jd-progress-bar');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/chat-model-switcher.test.js`
Expected: FAIL with `TypeError: visible is not a function`.

- [ ] **Step 3: Write minimal implementation**

**3a — `index.html`.** Immediately after the closing `</div>` of `chat-jd-actions` (line ~672) and before the `chat-jd-status` paragraph, add:

```html
      <div class="chat-jd-progress" id="chat-jd-progress" aria-hidden="true" hidden><span class="chat-jd-progress-bar"></span></div>
```

`aria-hidden` is deliberate: the status line below is already `role="status" aria-live="polite"` and announces every phase. A second live region would announce each one twice.

**3b — `assets/css/style.css`.** After `.chat-jd-status.is-success { color: var(--teal); }` (line ~938) add:

```css
/* Indeterminate on purpose. The Worker is a single POST with no progress channel, so any
   percentage would be invented — and it would stall at 100% exactly when the model is slowest,
   which is when a fabricated number misleads most. See docs/superpowers/specs/
   2026-07-30-recruiter-jd-progress-and-confidence-design.md. */
.chat-jd-progress {
  height: 3px; border-radius: 999px; overflow: hidden;
  background: rgba(var(--teal-rgb), 0.15);
}
.chat-jd-progress[hidden] { display: none; }
.chat-jd-progress-bar {
  display: block; width: 40%; height: 100%; border-radius: inherit;
  background: linear-gradient(90deg, rgba(var(--teal-rgb), 0.2), var(--teal), rgba(var(--teal-rgb), 0.2));
  animation: jd-progress-slide 1.4s ease-in-out infinite;
}
@keyframes jd-progress-slide {
  0% { transform: translateX(-105%); }
  100% { transform: translateX(255%); }
}
```

In the `@media (prefers-reduced-motion: reduce)` block at line ~1095, add:

```css
  .chat-jd-progress-bar { animation: none; width: 100%; opacity: 0.55; }
```

The bar still fills to show a busy state — motion is what gets removed, not the signal.

**3c — `assets/js/chatbot.js`.** Add the element reference beside the other JD lookups (near line 578):

```js
  var jdProgress = document.getElementById("chat-jd-progress");
```

Do **not** add `jdProgress` to the `recruiterUI` guard on line ~581. That guard disables the whole matcher when an element is missing; a decorative bar must not be able to take the feature down. `renderJdProgress` null-checks instead, and `verify_recruiter_ui.ps1` catches a missing id at build time.

Add the phase list and predicate above the `window.AIMeerRecruiter` export block:

```js
  /* Array + indexOf rather than an object-literal lookup, matching the convention in
     jd-reasoning.js: a plain-object map would report "constructor" and "toString" as in-flight. */
  var JD_PROGRESS_STATUS_KINDS = ["reading", "scoring", "aiScoring", "aiRetrying"];

  function isJdProgressVisible(statusKind) {
    return JD_PROGRESS_STATUS_KINDS.indexOf(String(statusKind || "")) !== -1;
  }
```

Export it, after the `resolveConfidenceLevel` export from Task 2:

```js
  window.AIMeerRecruiter.isJdProgressVisible = isJdProgressVisible;
```

Add the copy to **both** branches of `T`, directly after each `jdAiStatusScoring` entry:

```js
      jdAiStatusRetrying: "The first AI attempt did not come back cleanly — AIMeer is trying once more…",
```

```js
      jdAiStatusRetrying: "Percubaan AI pertama tidak menjadi — AIMeer sedang mencuba sekali lagi…",
```

Add the render function next to `renderJdStatus`:

```js
  /* Driven from statusKind so the bar cannot disagree with the message above it. */
  function renderJdProgress() {
    if (!jdProgress) return;
    jdProgress.hidden = !isJdProgressVisible(jdState.statusKind);
  }
```

Call it at the end of `renderJdStatus`, after `jdStatus.textContent = message;`:

```js
    renderJdProgress();
```

Add the retry branch inside `renderJdStatus`, directly after the `aiScoring` branch:

```js
    } else if (jdState.statusKind === "aiRetrying") {
      message = t("jdAiStatusRetrying");
      if (jdState.statusWarnings.length) message += " " + jdState.statusWarnings.join(" ");
```

Add the marker beside `markJdScoringInFlight`:

```js
  function markJdScoringRetrying() {
    setJdStatus("aiRetrying", {
      source: jdState.statusSource,
      warnings: jdState.statusWarnings.slice()
    });
  }
```

In `requestJdReasoning`'s retry handler, directly after the existing
`if (window.console && console.warn) console.warn("JD scoring retry after:", firstError);` line, add:

```js
        markJdScoringRetrying();
```

It sits after the `canApplyReasoning()` guard already in that handler, so a stale request cannot repaint the status line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test "tests/*.test.js"`
Expected: PASS, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add index.html assets/css/style.css assets/js/chatbot.js tests/chat-model-switcher.test.js
git commit -m "feat: show an indeterminate progress bar and a visible retry while JD scoring runs"
```

---

### Task 4: Lock the new markup into the UI harness, bump `?v=`, verify green

**Files:**
- Modify: `tools/verify_recruiter_ui.ps1` (add `$cssPath`; add id and reduced-motion assertions)
- Modify: `index.html` (`?v=` bump only)

**Interfaces:**
- Consumes: the `chat-jd-progress` id and `.chat-jd-progress-bar` class from Task 3.
- Produces: nothing consumed by later tasks — this is the closing gate.

- [ ] **Step 1: Add the harness assertions**

In `tools/verify_recruiter_ui.ps1`, after the `$chatbotPath` assignment (line ~7):

```powershell
$cssPath = Join-Path $repoRoot 'assets/css/style.css'
```

After the existing `Assert-True (Test-Path $chatbotPath) ...` line:

```powershell
Assert-True (Test-Path $cssPath) "Missing style.css: $cssPath"
```

Beside the other `Get-Content` calls:

```powershell
$css = Get-Content -Raw -Encoding UTF8 $cssPath
```

Add `'chat-jd-progress'` to `$stableIds`, after `'chat-jd-status'`:

```powershell
  'chat-jd-status',
  'chat-jd-progress',
  'chat-jd-result'
```

Before the final `Write-Host`:

```powershell
# The bar is decorative and aria-hidden on purpose: chat-jd-status is already role="status"
# aria-live="polite", so a second live region would announce every phase twice.
Assert-Match $index 'id="chat-jd-progress"[^>]*aria-hidden="true"' 'The recruiter progress bar must stay aria-hidden so the existing status live region is the only announcer.'

# Project rule: prefers-reduced-motion disables animation. A progress bar that keeps sliding is
# exactly the kind of motion that rule exists to stop.
# Extract the blocks first, then test containment. A single regex cannot do this: the media block
# holds many rules, so any [^}] run stops at the first inner closing brace, and [\s\S]*? would
# happily match a .chat-jd-progress-bar rule sitting outside the block entirely.
$reducedMotionBlocks = @([regex]::Matches($css, '@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}'))
Assert-True ($reducedMotionBlocks.Count -gt 0) 'style.css must carry at least one prefers-reduced-motion block.'

$disablesProgressBar = $false
foreach ($block in $reducedMotionBlocks) {
  if ($block.Value -match '\.chat-jd-progress-bar[^}]*animation:\s*none') { $disablesProgressBar = $true }
}
Assert-True $disablesProgressBar 'The reduced-motion block must disable the recruiter progress bar animation.'
```

- [ ] **Step 2: Run the harness to verify it passes**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/verify_recruiter_ui.ps1`
Expected: `Recruiter UI verification passed.`

If it fails on the `?v=` consistency check, that is Step 3's job — do it, then re-run.

- [ ] **Step 3: Bump the cache-busting tag**

In `index.html` only, replace every `?v=2026-07-30e` with `?v=2026-07-30f`. There are eight: one stylesheet `href` and seven `<script src>`.

```bash
sed -i 's/?v=2026-07-30e/?v=2026-07-30f/g' index.html
grep -c 'v=2026-07-30f' index.html   # expect 8
```

`chatbot.js` reads the tag off its own `<script src>` and forwards it to the `aimeer-kb.txt` and `aimeer-profile.json` fetches, so there is exactly one value to edit.

- [ ] **Step 4: Run the full green tree**

```bash
node --test "tests/*.test.js"
node tools/test_jd_extractor.mjs
node tools/test_jd_matcher.mjs
node tools/test_recruiter_cloud_payload.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File tools/verify_recruiter_profile.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools/verify_recruiter_ui.ps1
```

Expected: 0 failing in every one. A green tree means the `tests/` suite **and** all five `tools/` harnesses — not the suite alone.

- [ ] **Step 5: Manual verification over HTTP**

```bash
python -m http.server 8080
```

Port 8080 specifically — the Worker's `ALLOWED_ORIGINS` only whitelists the live site plus `http://localhost:8080` and `http://127.0.0.1:8080`, and any other port silently loses the cloud tier.

Open `http://localhost:8080`, open AIMeer, open the JD matcher, paste
`tests/fixtures/jd-prose-heavy-senior-fullstack.txt`, click **Analyze match**, and confirm:

- [ ] The bar appears and animates as soon as the click lands.
- [ ] The status text moves from the local phase to "AIMeer is analyzing the match with AI…".
- [ ] Bar and status both clear when the report renders.
- [ ] The score line reads a confidence consistent with its score (expect roughly `82% · Confidence: Medium`, not `Low`).
- [ ] Widths 375 / 768 / 1440 — the bar spans the panel and never causes horizontal scroll.
- [ ] Dark and light themes — the track is visible in both.
- [ ] EN and BM — switch language mid-analysis and confirm the phase text swaps.
- [ ] DevTools → Rendering → Emulate `prefers-reduced-motion: reduce`: the bar is full-width and static, never animating.

- [ ] **Step 6: Commit**

```bash
git add tools/verify_recruiter_ui.ps1 index.html
git commit -m "test: assert the recruiter progress bar markup and reduced-motion rule; bump ?v="
```

---

## Notes for the implementer

- **Do not touch `cloud/aimeer-worker.js`.** Nothing here needs it, and it deploys only by a manual paste into the Cloudflare dashboard — editing the file in this repo changes nothing live.
- **`verify_recruiter_ui.ps1` asserts on exact copy.** If you reword any disclaimer or chip string, update the script in the same change or it goes red unnoticed.
- **While iterating locally,** tick DevTools → Network → Disable cache instead of bumping `?v=` repeatedly.
