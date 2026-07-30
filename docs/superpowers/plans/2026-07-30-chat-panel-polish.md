# Chat Panel Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two presentation fixes shipping together. In the recruiter JD report: an honest indeterminate progress bar while scoring runs, and a confidence label that belongs to the pass that produced the score. In the chat log: iMessage-style send / wait / receive motion in place of instant bubbles, a `"Thinking…"` string, and a scroll jump.

**Specs:**
- `docs/superpowers/specs/2026-07-30-recruiter-jd-progress-and-confidence-design.md` (Tasks 1–3)
- `docs/superpowers/specs/2026-07-30-chat-message-motion-design.md` (Tasks 4–5)

**Architecture:** Presentation-only across five files. `jd-reasoning.js` gains an `aiConfidence` aggregate derived from per-requirement confidences it already validates. `chatbot.js` picks the confidence source by scoring mode, drives a decorative progress bar from the existing `jdState.statusKind`, surfaces the previously silent retry as its own phase, and builds typing-dot markup instead of setting text. `index.html` and `style.css` carry the markup and all animation. Task 6 is the shared closing gate: harness assertions, one `?v=` bump, full green tree.

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

### Task 4: Bubble entrance motion and smooth scrolling

**Files:**
- Modify: `assets/css/style.css` (rules after `.chat-msg` at line ~794; `.chat-log` at line ~789; reduced-motion block at line ~1095)
- Test: `tests/chat-model-switcher.test.js` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the `chat-msg-in` keyframe name and `scroll-behavior: smooth` on `.chat-log`. Task 5 adds the typing-dot rules alongside these; Task 6 asserts none of it animates under reduced motion.

- [ ] **Step 1: Write the failing test**

Append to `tests/chat-model-switcher.test.js`:

```js
/* The chat read as dated because nothing moved at the moments a conversation has beats: addMsg
   appended a bubble and set scrollTop directly, so bubbles appeared instantly and the log jumped.
   A restrained ease-out was chosen over an iMessage-style overshoot — next to the site's editorial
   typography a bounce reads as toy-like. */
test('chat bubbles animate in from their own corner', () => {
  assert.match(css, /@keyframes chat-msg-in\s*\{[\s\S]*?scale\(0\.96\)/,
    'chat-msg-in should scale up from 0.96');
  assert.match(css, /\.chat-msg\b[^{]*\{[^}]*animation:\s*chat-msg-in/,
    '.chat-msg should use the entrance animation');
  assert.match(css, /\.chat-msg-bot\b[^{]*\{[^}]*transform-origin:\s*bottom left/,
    'bot bubbles should grow from the bottom-left');
  assert.match(css, /\.chat-msg-user\b[^{]*\{[^}]*transform-origin:\s*bottom right/,
    'user bubbles should grow from the bottom-right');
});

/* Done in CSS so the existing log.scrollTop = log.scrollHeight calls ease instead of jumping —
   no JS change, and no reduced-motion branch in JS either. */
test('the chat log scrolls smoothly', () => {
  assert.match(css, /\.chat-log\b[^{]*\{[^}]*scroll-behavior:\s*smooth/,
    '.chat-log should scroll smoothly');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/chat-model-switcher.test.js`
Expected: FAIL — `chat-msg-in` is not defined in `style.css`.

- [ ] **Step 3: Write minimal implementation**

In `assets/js/../css/style.css`, add `scroll-behavior: smooth;` to the existing `.chat-log` rule (line ~789), so it reads:

```css
.chat-log {
  flex: 1; overflow-y: auto; overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch; scroll-behavior: smooth;
  padding: 16px 18px; display: flex; flex-direction: column; gap: 10px;
}
```

Add the entrance animation to the existing `.chat-msg` rule and a keyframe block after it:

```css
.chat-msg {
  max-width: 86%; padding: 10px 14px; border-radius: 14px;
  font-size: 0.88rem; line-height: 1.55; white-space: pre-wrap; word-break: break-word;
  animation: chat-msg-in 180ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
/* Safe on every .chat-msg because messages are only ever added one at a time — greeting, AI
   status changes, conversation turns. There is no bulk history restore that would fire dozens of
   entrances at once. See docs/superpowers/specs/2026-07-30-chat-message-motion-design.md. */
@keyframes chat-msg-in {
  from { opacity: 0; transform: translateY(6px) scale(0.96); }
  to   { opacity: 1; transform: none; }
}
```

Add `transform-origin` to the two existing side rules so each bubble grows from its own corner —
`.chat-msg-bot` (line ~798) gains `transform-origin: bottom left;` and `.chat-msg-user`
(line ~818) gains `transform-origin: bottom right;`.

In the `@media (prefers-reduced-motion: reduce)` block at line ~1095, add:

```css
  .chat-msg { animation: none; }
  .chat-log { scroll-behavior: auto; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test "tests/*.test.js"`
Expected: PASS, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add assets/css/style.css tests/chat-model-switcher.test.js
git commit -m "feat: animate chat bubbles in and ease the log scroll"
```

---

### Task 5: Typing dots in place of the "Thinking…" text

**Files:**
- Modify: `assets/js/chatbot.js` (add `setThinkingDots`; call it at line ~1878-1879; fade content in where the reply lands at lines ~1536, ~1858)
- Modify: `assets/css/style.css` (replace `.chat-msg.thinking` at line ~822; add typing rules; reduced-motion entry)
- Test: `tests/chat-model-switcher.test.js` (append)

**Interfaces:**
- Consumes: the `chat-msg-in` entrance from Task 4 — the dots bubble uses it, and the reply reuses the same element so the bubble is continuous.
- Produces: `.chat-typing` markup with three `<i>` children and an `aria-label`; the `chat-msg-settle` class for the content swap.

- [ ] **Step 1: Write the failing test**

Append to `tests/chat-model-switcher.test.js`:

```js
/* The wait state was the literal string "Thinking…". Dots replace it visually, but the string is
   NOT deleted — it moves to aria-label, so the wait state is still announced. Dropping it would
   make waiting silent to assistive technology: a regression dressed as a visual upgrade. */
test('the waiting bubble shows three dots and still announces itself', async () => {
  const { context, elements } = createChatContext({ saveData: false });
  await loadChat(context);
  elements['chat-launcher'].dispatch('click');

  elements['chat-input'].value = 'What did he build at Abbott?';
  elements['chat-form'].dispatch('submit');

  const bubbles = elements['chat-log'].children;
  const waiting = bubbles[bubbles.length - 1];
  assert.equal(waiting.classList.contains('thinking'), true, 'the last bubble should be the waiting one');

  const dots = waiting.children.find((child) => child.className === 'chat-typing');
  assert.ok(dots, 'the waiting bubble should contain a .chat-typing group');
  assert.equal(dots.children.length, 3, 'three dots');
  assert.equal(dots.getAttribute('aria-label'), 'Thinking…',
    'the dots must carry the thinking string for screen readers');
  assert.equal(waiting.textContent, '', 'the literal Thinking… text should be gone');
});

test('the typing dots are styled and staggered', () => {
  assert.match(css, /@keyframes chat-typing-bounce/, 'the dots need a bounce keyframe');
  assert.match(css, /\.chat-typing i\b[^{]*\{[^}]*animation:\s*chat-typing-bounce/,
    'each dot should run the bounce');
  assert.match(css, /\.chat-typing i:nth-child\(2\)[^{]*\{[^}]*animation-delay/,
    'the second dot should be offset');
  assert.match(css, /\.chat-typing i:nth-child\(3\)[^{]*\{[^}]*animation-delay/,
    'the third dot should be offset');

  /* The old whole-bubble pulse is removed: the dots carry the motion now, and pulsing the
     container as well would double it. */
  assert.equal(/\.chat-msg\.thinking\b[^{]*\{[^}]*animation:\s*pulse/.test(css), false,
    'the whole-bubble pulse should be gone');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/chat-model-switcher.test.js`
Expected: FAIL — no `.chat-typing` group exists, so `assert.ok(dots, …)` fails.

- [ ] **Step 3: Write minimal implementation**

**5a — `assets/js/chatbot.js`.** Add beside `addMsg` (line ~623):

```js
  /* Three dots instead of the literal "Thinking…" string. The string is not dropped — it becomes
     the group's aria-label, so the wait state stays audible to screen readers while sighted users
     see dots. See docs/superpowers/specs/2026-07-30-chat-message-motion-design.md. */
  function setThinkingDots(bubble) {
    bubble.textContent = "";
    bubble.classList.add("thinking");
    var dots = document.createElement("span");
    dots.className = "chat-typing";
    dots.setAttribute("aria-label", t("thinking"));
    for (var index = 0; index < 3; index += 1) {
      dots.appendChild(document.createElement("i"));
    }
    bubble.appendChild(dots);
    return bubble;
  }

  /* The reply lands in the element the dots occupied, so the bubble itself is continuous — it does
     not exit and re-enter. Only the content changes, faded so the swap is not a hard cut.
     The fade fires ONLY on the dots-to-text transition. The streaming path calls this once per
     token and finishReply calls it again at the end; animating every time would strobe. */
  function settleBubbleContent(bubble, text) {
    var wasThinking = bubble.classList.contains("thinking");
    bubble.classList.remove("thinking");
    bubble.textContent = text;
    if (!wasThinking) return;
    bubble.classList.remove("chat-msg-settle");
    /* Reading offsetWidth restarts the animation; without it the class is removed and re-added in
       the same frame and the browser never sees a change. */
    void bubble.offsetWidth;
    bubble.classList.add("chat-msg-settle");
  }

  /* Token streaming writes to the log many times a second. With scroll-behavior: smooth every one
     of those would retarget an in-flight scroll animation, which lags behind the text instead of
     following it. Streaming jumps; message boundaries ease. */
  function scrollLogToEndNow() {
    var previous = log.style.scrollBehavior;
    log.style.scrollBehavior = "auto";
    log.scrollTop = log.scrollHeight;
    log.style.scrollBehavior = previous;
  }
```

Replace the two lines at ~1878:

```js
    var bubble = addMsg("bot", t("thinking"));
    bubble.classList.add("thinking");
```

with:

```js
    var bubble = setThinkingDots(addMsg("bot", ""));
```

In the WebLLM streaming loop at ~1531, replace:

```js
      if (delta && delta.content) {
        reply += delta.content;
        bubble.textContent = reply;
        bubble.classList.remove("thinking");
        log.scrollTop = log.scrollHeight;
      }
```

with:

```js
      if (delta && delta.content) {
        reply += delta.content;
        settleBubbleContent(bubble, reply);
        scrollLogToEndNow();
      }
```

In `finishReply` at ~1857, replace:

```js
    bubble.classList.remove("thinking");
    bubble.textContent = reply;
```

with:

```js
    settleBubbleContent(bubble, reply);
```

**5b — `assets/css/style.css`.** Replace line ~822:

```css
.chat-msg.thinking { color: var(--muted); animation: pulse 1.4s infinite; }
```

with:

```css
.chat-msg.thinking { color: var(--muted); }
.chat-typing { display: inline-flex; align-items: center; gap: 4px; padding: 2px 0; }
.chat-typing i {
  width: 6px; height: 6px; border-radius: 50%; background: var(--muted);
  animation: chat-typing-bounce 1.2s ease-in-out infinite;
}
.chat-typing i:nth-child(2) { animation-delay: 0.15s; }
.chat-typing i:nth-child(3) { animation-delay: 0.3s; }
@keyframes chat-typing-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.45; }
  30% { transform: translateY(-4px); opacity: 1; }
}
.chat-msg-settle { animation: chat-msg-settle 180ms ease-out both; }
@keyframes chat-msg-settle {
  from { opacity: 0.4; }
  to   { opacity: 1; }
}
```

In the `@media (prefers-reduced-motion: reduce)` block, add:

```css
  .chat-typing i { animation: none; opacity: 1; }
  .chat-msg-settle { animation: none; }
```

The dots stay visible and static, so the wait state still reads without movement.

Also remove `.chat-msg.thinking` from the existing reduced-motion `animation: none` list on line
~1099, since it no longer animates — leaving it there would be a rule with nothing to disable.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test "tests/*.test.js"`
Expected: PASS, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add assets/js/chatbot.js assets/css/style.css tests/chat-model-switcher.test.js
git commit -m "feat: replace the Thinking… text with an accessible typing-dot indicator"
```

---

### Task 6: Lock the new markup into the UI harness, bump `?v=`, verify green

**Files:**
- Modify: `tools/verify_recruiter_ui.ps1` (add `$cssPath`; add id and reduced-motion assertions)
- Modify: `index.html` (`?v=` bump only)

**Interfaces:**
- Consumes: the `chat-jd-progress` id and `.chat-jd-progress-bar` class from Task 3; the
  `.chat-msg` entrance from Task 4; the `.chat-typing i` dots from Task 5.
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

$motionSelectors = @{
  '.chat-jd-progress-bar' = 'the recruiter progress bar'
  '.chat-msg'             = 'the chat bubble entrance'
  '.chat-typing i'        = 'the typing dots'
}
foreach ($selector in $motionSelectors.Keys) {
  $pattern = [regex]::Escape($selector) + '[^}]*animation:\s*none'
  $disabled = $false
  foreach ($block in $reducedMotionBlocks) {
    if ($block.Value -match $pattern) { $disabled = $true }
  }
  Assert-True $disabled "The reduced-motion block must disable $($motionSelectors[$selector]) animation ($selector)."
}

# Smooth scrolling is motion too: a log that eases under prefers-reduced-motion still moves.
$scrollDisabled = $false
foreach ($block in $reducedMotionBlocks) {
  if ($block.Value -match '\.chat-log[^}]*scroll-behavior:\s*auto') { $scrollDisabled = $true }
}
Assert-True $scrollDisabled 'The reduced-motion block must set scroll-behavior: auto on .chat-log.'
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

Then close the JD panel and send an ordinary chat message:

- [ ] The user bubble grows from the bottom-right; bot bubbles grow from the bottom-left.
- [ ] Three dots appear in a bot bubble while waiting, staggered rather than in unison.
- [ ] The reply appears in that same bubble — it does not disappear and come back.
- [ ] The log eases to the bottom instead of jumping, including on a long reply.
- [ ] Send several messages quickly — no stutter, and the log stays pinned to the bottom.
- [ ] On a device that runs the on-device model, watch a streamed reply: the text should stay
      pinned to the bottom as it arrives, with the scroll tracking it rather than lagging behind.

Finally, with DevTools → Rendering → Emulate `prefers-reduced-motion: reduce`:

- [ ] The JD progress bar is full-width and static, never animating.
- [ ] Chat bubbles appear with no entrance animation.
- [ ] The typing dots are visible but still.
- [ ] The log jumps rather than eases.

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
