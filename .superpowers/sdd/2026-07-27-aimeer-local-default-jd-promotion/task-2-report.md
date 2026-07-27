# Task 2 Report: Show the AIMeer welcome callout on every page load

## Summary

Implemented Task 2 so every fresh `chatbot.js` load schedules the existing AIMeer welcome-callout reveal, even when `localStorage['aimeer-callout']` contains the prior dismissal flag. The existing 1.8-second delay, `if (open) return` guard, dismiss/open handler, persistence behavior, CSS transitions, and hover/focus behavior remain unchanged.

## Changed files

- `assets/js/chatbot.js`
  - Removed only the `localStorage['aimeer-callout']` read and conditional around the existing delayed reveal.
  - Updated the nearby comment from “shows once” to “shows on each load”.
- `tests/chat-model-switcher.test.js`
  - Added `chat-callout` to the test DOM harness.
  - Added a regression test proving a stored dismissal flag does not prevent the 1800 ms reveal timer or the `show` state.
  - Added static regression checks for the callout markup, dismiss button, and click handler.
- `.superpowers/sdd/2026-07-27-aimeer-local-default-jd-promotion/task-2-report.md`
  - This report.

## Tests and commands

### Test-first RED check

Command:

```text
node --test tests/chat-model-switcher.test.js
```

Output: 13 passed, 1 failed. The intended regression failed because the stored `aimeer-callout=1` flag prevented the 1800 ms reveal timer from being scheduled.

### Focused GREEN check

Command:

```text
node --test tests/chat-model-switcher.test.js
```

Output: 14 passed, 0 failed.

### Full test suite

Command:

```text
node --test (Get-ChildItem tests -Filter '*.test.js' | Select-Object -ExpandProperty FullName)
```

Output: 25 passed, 0 failed.

### Diff validation

Command:

```text
git diff --check
```

Output: clean; no whitespace errors.

## Decisions

- Kept the existing callout lifecycle intact and removed only the persisted-seen gate, which directly satisfies the requirement without changing routing, resume controls, or JD matching.
- Kept `hideCallout(true)` persistence so current interactions still record dismissal/opening, even though that value no longer suppresses the next page-load reveal.
- Reused the existing test file and harness because it already executes `chatbot.js` in a controlled DOM and timer environment.

## Concerns

- No functional concerns identified within Task 2 scope.
- The repository contains pre-existing untracked `.superpowers` brief/progress/review artifacts. They were not modified or staged by this task.
- No browser visual pass was run; the CSS and reveal transition code were unchanged, and the automated test verifies the reveal state transition.
