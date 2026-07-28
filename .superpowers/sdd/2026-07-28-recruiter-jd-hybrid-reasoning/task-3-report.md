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

- 7/7 tests passed

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
- requires evidence refs for adjacent / transferable / academic evidence-based conclusions
- allows direct deterministic matches to remain valid even when the deterministic requirement has no recruiter-evidence ref

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

- pass, 7 tests, 0 failures

Full suite:

`node --test (Get-ChildItem tests -Filter '*.test.js' | Select-Object -ExpandProperty FullName)`

Result:

- pass, 40 tests, 0 failures

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
- `index.html`
- `tests/jd-reasoning.test.js`

## Out-of-scope by design

- no chatbot UI integration
- no worker contract changes
- no route / token / stale-response behavior changes
- no deterministic matcher scoring changes

## Concerns

- None blocking for Task 3.
- The line-ending warnings are non-blocking and reflect Git's Windows CRLF normalization behavior, not content errors.
