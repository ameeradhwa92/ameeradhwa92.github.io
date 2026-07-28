# Task 2 Report - Extend deterministic matcher output without changing its score

Date: 2026-07-28
Worktree: `C:\Users\ameer.mohamad\source\repos\ameeradhwa92.github.io\.worktrees\recruiter-jd-hybrid-reasoning`
Branch: `codex/recruiter-jd-hybrid-reasoning`

## Scope completed

- Added a focused matcher regression file at `tests/jd-matcher.test.js`.
- Confirmed the required RED failure before production edits.
- Extended `assets/js/jd-matcher.js` to expose deterministic matcher metadata without changing the authoritative score or existing match/category behavior.
- Fixed the follow-up Task 2 review finding that unsupported `C#` and `Laravel` requirements were inheriting `professional.web-api-architecture` even though the authoritative recruiter-evidence registry does not publish those technologies.
- Fixed the remaining provenance finding for `Enterprise web application development`: scope-only `enterprise web applications` support can no longer attach a ref to that different canonical term.
- Kept JDReasoning, UI, and Worker work out of scope for this task.

## TDD record

### RED

Command:

`node --test tests/jd-matcher.test.js`

Observed failure:

- `deterministicScore` was `undefined`, so the new matcher contract was not yet exposed.

### Review-finding RED

Command:

`node --test tests/jd-matcher.test.js`

Observed failure:

- `C#` still emitted `['professional.web-api-architecture']`
- `Laravel` and the Laravel-specific duration partial still emitted `['professional.web-api-architecture']`
- The authoritative recruiter-evidence registry contains no `C#`, `c sharp`, or `Laravel` entry in its published `technologies`, `capabilities`, or `scope` fields

### Latest review-finding RED

Command:

`node --test tests/jd-matcher.test.js`

Observed failure:

- `Enterprise web application development` emitted `['professional.web-api-architecture']`
- The referenced record publishes `enterprise web applications` only as scope, not the matched canonical term

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
- Made recruiter evidence resolution support-based: a ref now requires exact canonical-term support in the registry fields, or an exact matched hint in a published technology/capability. Scope-only aliases cannot promote a different canonical term.
- Added requirement IDs after deduplication using deterministic slugs.
- Preserved category scoring, strength factors, match factors, inactive-category handling, and Laravel duration partial behavior.
- Removed the unsupported `c#`, `c sharp`, and `laravel` hint mappings from `RECRUITER_EVIDENCE_HINTS` so those terms no longer claim recruiter-evidence IDs that are not actually published by the authoritative registry.
- Updated matcher fixtures for the now-empty refs on unsupported `Azure`, `Tesseract OCR`, and `SQL databases` mappings, plus the narrowed `Production delivery` mapping.

### Test harness fix during RED

The first post-patch failures in `tests/jd-matcher.test.js` were cross-realm array assertions caused by loading the matcher in a VM context. I normalized those arrays in the test so failures reflected matcher behavior rather than Node test harness internals.

## Files changed

- `assets/js/jd-matcher.js`
- `tests/jd-matcher.test.js`
- `.superpowers/sdd/2026-07-28-recruiter-jd-hybrid-reasoning/task-2-report.md`

## Verification

### Focused matcher test

Command:

`node --test tests/jd-matcher.test.js`

Result:

- PASS

### Focused provenance regression test

Command:

`node --test tests/jd-matcher.test.js`

Result:

- PASS, including assertions that unsupported `C#`, `Laravel`, and `Enterprise web application development` terms keep empty `evidenceRefs`

### Full available Node test suite

Command:

`node --test (Get-ChildItem tests -Filter '*.test.js' | Select-Object -ExpandProperty FullName)`

Result:

- PASS, 34 tests passed, 0 failed

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
- `C#`, `Laravel`, the Laravel-specific duration partial, and `Enterprise web application development` now keep empty `evidenceRefs` instead of citing unsupported recruiter-evidence records.
- Other hint-derived refs are now retained only when the registry explicitly supports the canonical term or matched technology/capability; unsupported `Azure`, `Tesseract OCR`, and `SQL databases` refs are empty.

## Concerns / follow-up notes

1. Tenure-based year requirements currently expose empty `evidenceRefs` because the recruiter evidence registry does not yet include a dedicated stable tenure record. This was accepted for a later profile-registry/schema task and was not changed here.
2. The current matcher still relies on a bounded hint vocabulary for attaching recruiter-evidence refs. The resolver now validates each mapped ref against the authoritative registry, while a later registry/schema task could make attachment fully data-driven instead of hint-driven.
