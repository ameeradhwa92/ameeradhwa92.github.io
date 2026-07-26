Task 7 report - nested alias matcher regression

Summary
- Fixed the nested-alias regression in `assets/js/jd-matcher.js` without changing the broader scoring model.
- Added regression coverage in `tools/test_jd_matcher.mjs` for:
  - `Azure SQL` keeping only the specific strong match
  - `React Query` keeping only the specific strong match
  - `Azure SQL and React Query` preserving both unrelated strong matches while suppressing nested umbrella aliases

Root cause
- The matcher was collecting broad and specific aliases independently from the same normalized requirement text.
- For phrases like `Azure SQL` and `React Query`, the broad umbrella aliases (`Azure`, `React`) were surviving alongside the more specific aliases because the existing dedupe only collapsed exact canonical duplicates, not nested overlapping alias spans.

Fix
- Tracked alias variants on profile entries so the matcher can reason about which alias text actually matched.
- Switched alias discovery to collect boundary-aware match occurrences with normalized start/end offsets.
- Added a deterministic nested-alias dedupe step after requirement extraction and before scoring/classification:
  - keep the longest overlapping alias span
  - drop shorter contained umbrella aliases from the same normalized requirement text
  - preserve separate non-overlapping technologies in the same line

Verification
- Red step: added the three regression tests first and confirmed they failed against the pre-fix matcher for the expected duplicate-parent behavior.
- Green step:
  - `node tools\test_jd_matcher.mjs`
  - `git diff --check`

Notes
- `git diff --check` passed, with only existing Git line-ending warnings about LF -> CRLF normalization in the working copy.
- Left unrelated untracked `tmp/` content untouched.
