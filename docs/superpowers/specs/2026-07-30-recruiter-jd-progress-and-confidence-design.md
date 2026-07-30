# Recruiter JD scoring progress indicator and AI confidence

## Goal

Two related report-surface problems, both visible on the same screen.

1. Clicking **Analyze match** starts a cloud round trip that can run ten seconds or
   more — two model calls server-side, plus one silent retry. Today the only feedback
   is a line of text, and the retry is not surfaced at all, so a slow analysis is
   indistinguishable from a hang.
2. The score line reads `82% · Confidence: Low`, which reads as self-contradiction.

## Why the confidence line contradicts itself

`chatbot.js` builds that one line from two different passes:

```js
var scoreValue = typeof result.finalScore === "number" ? result.finalScore : baseline.score;
report.appendChild(createJdNode("p", "jd-report-score",
  formatScore(scoreValue) + "% · " + t("jdResultConfidenceLabel") + ": " +
  confidenceLabel(baseline.confidence && baseline.confidence.label)));
```

The score is `result.finalScore` — the AI's judgment. The confidence is
`baseline.confidence.label` — the keyword pass's, computed in `jd-matcher.js`'s
`buildConfidence` as `strongCount / total < 0.34 → low` and never told what the AI
concluded. On the prose-heavy fixture that is 8 strong of 38 requirements, so "low".

Both values are correct about different things. Printing them adjacent implies they
describe the same thing.

The model already returns a per-requirement `confidence` (`low` | `medium` | `high`),
which both validators check and `mergeResult` carries into `requirementReasoning`.
Nothing displays it. That is the value the headline should aggregate.

## Design

### Progress indicator

A decorative indeterminate bar, shown whenever the matcher is working.

```html
<div class="chat-jd-progress" id="chat-jd-progress" aria-hidden="true" hidden>
  <span class="chat-jd-progress-bar"></span>
</div>
```

`aria-hidden` is deliberate. The status line is already
`role="status" aria-live="polite"`, so it announces each phase; a second live region
would announce everything twice. The bar is visual reinforcement only.

Determinate progress is rejected outright. The Worker is a single POST with no
progress channel, so any percentage would be invented — and it would stall at 100%
exactly when the model is slowest, which is when a fabricated number misleads most.

Visibility is derived from `jdState.statusKind`, the field that already tracks this:
visible for `reading`, `scoring` and `aiScoring`, hidden otherwise. A single
`renderJdProgress()` called from `renderJdStatus()` owns it, so there is no second
piece of state to fall out of sync.

Phase text reuses the existing `T` entries. One new key, `jdAiStatusRetrying`, covers
the retry in `requestJdReasoning`, which currently only reaches `console.warn`. That
retry is a second full round trip; leaving it unlabelled is what makes a slow run look
like a dead one.

Styling: a 3px track with a 40%-wide bar sliding on a 1.4s loop, in teal. Amber stays
reserved for Retired/EOL badges. Under `prefers-reduced-motion: reduce` the animation
is disabled and the bar rests full-width at reduced opacity, so the busy state still
reads without motion.

### AI confidence

`mergeResult` gains `result.aiConfidence`, aggregated from the per-requirement
confidences it already holds:

| Level | Weight |
|---|---|
| `high` | 1 |
| `medium` | 0.5 |
| `low` | 0 |

The mean maps back to a label at `>= 0.67` → high, `>= 0.34` → medium, else low — the
same three-band shape `buildConfidence` uses, so the two paths stay comparable. With no
requirements the field is absent rather than defaulting, and the renderer falls through
to the keyword label.

`renderJdResult` reads `aiConfidence` when `scoringMode === "ai"` and keeps
`baseline.confidence.label` everywhere else. On the fallback path the keyword ratio is
exactly what the number describes, so it stays.

## Scope

- `index.html` — progress markup; bump `?v=`.
- `assets/css/style.css` — track, bar, keyframes, reduced-motion rule.
- `assets/js/chatbot.js` — `renderJdProgress()`, retry status call, confidence source,
  `jdAiStatusRetrying` in both the `en` and `ms` branches of `T`.
- `assets/js/jd-reasoning.js` — `aiConfidence` in `mergeResult`.
- `tools/verify_recruiter_ui.ps1` — require `chat-jd-progress`; assert the
  reduced-motion rule covers it.
- `tests/` — phase visibility, aggregation math, fallback behaviour.

Out of scope: `cloud/aimeer-worker.js` is untouched, so this needs no Cloudflare paste.
Scoring, parsing and the clamp band are unchanged — this is presentation only.

## Verification

`node --test "tests/*.test.js"` and all five `tools/` harnesses green.

Manually over HTTP on port 8080: click **Analyze match** and confirm the bar appears
and animates, the phase text changes, and both disappear when the report renders.
Check at 375 / 768 / 1440, in dark and light, in EN and BM, and with reduced motion
forced on. Confirm the score line reads a confidence consistent with its score, and
that a forced fallback still shows the keyword confidence.
