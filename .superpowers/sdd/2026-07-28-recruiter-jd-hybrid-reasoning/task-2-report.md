# Task 2 Report - Extend deterministic matcher output without changing its score

Date: 2026-07-28
Worktree: `C:\Users\ameer.mohamad\source\repos\ameeradhwa92.github.io\.worktrees\recruiter-jd-hybrid-reasoning`
Branch: `codex/recruiter-jd-hybrid-reasoning`

## Scope completed

- Added a focused matcher regression file at `tests/jd-matcher.test.js`.
- Confirmed the required RED failure before production edits.
- Extended `assets/js/jd-matcher.js` to expose deterministic matcher metadata without changing the authoritative score or existing match/category behavior.
- Kept JDReasoning, UI, and Worker work out of scope for this task.

## TDD record

### RED

Command:

`node --test tests/jd-matcher.test.js`

Observed failure:

- `deterministicScore` was `undefined`, so the new matcher contract was not yet exposed.

### GREEN

Minimal matcher changes implemented:

- Added `deterministicScore` to mirror the preserved deterministic baseline score.
- Added `requirements[]` with stable IDs and requirement-level metadata:
  - `id`
  - `term`
  - `original`
  - `strength`
  - `heading`
  - `category`
  - `yearsRequired`
  - `specificHandsOn`
  - `classification`
  - `evidenceType`
  - `evidenceRefs`
- Added recruiter evidence reference resolution using the Task 1 registry while preserving existing evidence strings for backward compatibility.
- Added requirement IDs after deduplication using deterministic slugs.
- Preserved category scoring, strength factors, match factors, inactive-category handling, and Laravel duration partial behavior.

### Test harness fix during RED

The first post-patch failures in `tests/jd-matcher.test.js` were cross-realm array assertions caused by loading the matcher in a VM context. I normalized those arrays in the test so failures reflected matcher behavior rather than Node test harness internals.

## Files changed

- `assets/js/jd-matcher.js`
- `tests/jd-matcher.test.js`

## Verification

### Focused matcher test

Command:

`node --test tests/jd-matcher.test.js`

Result:

- PASS

### Full available Node test suite

Command:

`node --test (Get-ChildItem tests -Filter '*.test.js' | Select-Object -ExpandProperty FullName)`

Result:

- PASS, 33 tests passed, 0 failed

### Syntax check

Command:

`node --check assets/js/jd-matcher.js`

Result:

- PASS

### Diff whitespace check

Command:

`git diff --check`

Result:

- PASS for whitespace/errors
- Git emitted a working-tree warning that `assets/js/jd-matcher.js` will convert LF to CRLF on a future Git write; this was informational and did not indicate a diff-check failure.

## Behavioral notes

- Existing deterministic `score` remains authoritative and unchanged for all new fixtures.
- `deterministicScore === score` is now explicit.
- Administrative salary/location questions still create no technical requirements.
- Mobile remains inactive when absent from the JD.
- Laravel-specific years remain partial when the technology-specific duration is unpublished.

## Concerns / follow-up notes

1. The recruiter evidence registry is intentionally broader than individual skill evidence. Some skills now resolve to the nearest recruiter-safe registry records rather than one-to-one exact technology claims.
2. Tenure-based year requirements currently expose empty `evidenceRefs` because the recruiter evidence registry does not yet include a dedicated stable tenure record.
3. The new evidence-ref mapping is bounded and deterministic, but future Task 3/Task 5 validation may benefit from centralizing the mapping vocabulary if browser and Worker reasoning need identical resolution rules.
