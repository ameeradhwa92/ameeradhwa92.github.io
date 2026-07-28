# Task 3 Report — Bounded browser JD reasoning module

Status: DONE

## Scope completed

- Added `assets/js/jd-reasoning.js` as a standalone browser module.
- Loaded `assets/js/jd-reasoning.js` in `index.html` immediately after `jd-matcher.js` and before `chatbot.js`.
- Expanded `tests/jd-reasoning.test.js` with tests-first coverage for:
  - bounded input construction
  - strict JSON validation
  - markdown-wrapped JSON acceptance
  - malformed JSON rejection
  - unknown requirement ID rejection
  - duplicate requirement ID rejection
  - unknown evidence reference rejection
  - unsupported capability rejection
  - invalid match-level rejection
  - overlong field rejection
  - model-supplied score rejection
  - evidence-ref requirement for every evidence-based match level, including direct-professional
  - HTML/markup rejection in model text fields
  - score merging with deterministic preservation and +15 composite cap
  - deterministic fallback output

## TDD evidence

### RED

Command:

`node --test tests/jd-reasoning.test.js`

Observed result before implementation:

- `profile exposes the recruiter evidence registry` passed
- 6 new reasoning tests failed
- failure cause matched the brief: `JDReasoning should be loaded`

### GREEN

Implemented:

- `window.JDReasoning.buildInput(normalizedJd, deterministicResult, profile, language)`
- `window.JDReasoning.validateModelOutput(rawOutput, input)`
- `window.JDReasoning.mergeResult(deterministicResult, reasoning, input)`
- `window.JDReasoning.fallback(deterministicResult, input, language)`

Focused re-run:

`node --test tests/jd-reasoning.test.js`

Observed result after implementation:

- 9/9 tests passed

### Review-fix RED/GREEN

Added focused regression tests before the production fix for:

- direct-professional output with `evidenceRefs: []`
- `<script>`, `<b>`, and `<img ... onerror=...>` strings in validated model fields

Focused RED command:

`node --test tests/jd-reasoning.test.js`

Observed result before the fix:

- 7 passed, 2 failed
- both failures showed the validator returned `ok: true` for the reported review cases

Focused GREEN command after the fix:

`node --test tests/jd-reasoning.test.js`

Observed result:

- 9/9 tests passed

## Implementation notes

### `buildInput`

- bounds JD text to 12,000 characters
- bounds deterministic result payload to 12,000 characters
- includes only compact deterministic requirements
- includes only recruiter evidence records referenced by deterministic requirements
- derives the allowlisted capability vocabulary from those evidence records
- excludes contact details and privacy-sensitive profile content by construction

### `validateModelOutput`

- accepts plain JSON and fenced ```json blocks
- enforces closed root and requirement object schemas
- rejects malformed JSON, unknown keys, duplicate requirement IDs, unknown requirement IDs, unknown evidence refs, unsupported capabilities, invalid match levels, overlong text fields, and model score fields
- requires at least one valid evidence ref for every evidence-based conclusion, including direct-professional
- rejects HTML tags and comment markup before validated text is returned

### `mergeResult`

- preserves the original deterministic score unchanged
- computes:
  - `verifiedScore`
  - `transferableScore`
  - `requiredGapCeiling`
  - `compositeScore`
- applies bounded semantic lift only through validated reasoning
- caps composite lift to deterministic score + 15
- surfaces validated reasoning into recruiter-facing sections without touching chatbot routing or UI integration

### `fallback`

- returns deterministic recruiter-facing reasoning
- keeps strengths, gaps/limitations, and interview questions visible when reasoning is unavailable or invalid
- localizes fallback narrative for English / Bahasa Melayu

## Verification runbook

Focused reasoning tests:

`node --test tests/jd-reasoning.test.js`

Result:

- pass, 9 tests, 0 failures

Full suite:

`node --test (Get-ChildItem tests -Filter '*.test.js' | Select-Object -ExpandProperty FullName)`

Result:

- pass, 42 tests, 0 failures

Syntax checks:

`node --check assets/js/jd-extractor.js`

`node --check assets/js/jd-matcher.js`

`node --check assets/js/jd-reasoning.js`

`node --check assets/js/chatbot.js`

`node --check assets/js/aimeer-device.js`

Result:

- all passed with exit code 0

Diff sanity:

`git diff --check`

Result:

- no diff-format errors
- Windows line-ending warnings only for touched files (`index.html`, `tests/jd-reasoning.test.js`)

## Files changed

- `assets/js/jd-reasoning.js`
- `tests/jd-reasoning.test.js`
- `.superpowers/sdd/2026-07-28-recruiter-jd-hybrid-reasoning/task-3-report.md`

The previously committed Task 3 files (`index.html` and the initial module/test changes) remain unchanged by this review fix.

## Out-of-scope by design

- no chatbot UI integration
- no worker contract changes
- no route / token / stale-response behavior changes
- no deterministic matcher scoring changes

## Concerns

- None blocking for Task 3.
- The line-ending warnings are non-blocking and reflect Git's Windows CRLF normalization behavior, not content errors.
