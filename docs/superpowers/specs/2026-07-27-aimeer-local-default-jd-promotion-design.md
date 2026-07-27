# AIMeer local default and JD matcher promotion

## Goal

Make on-device AI the default AIMeer preference on every page load, show the AIMeer welcome callout on every page load, and make the existing recruiter JD matcher discoverable inside the chat conversation.

## Behavior

- On initialization, AIMeer ignores and clears any persisted Cloud preference. The preferred mode starts as Local for the current page session.
- Existing device eligibility and fallback rules remain unchanged. Unsupported devices may still route to Cloud or Instant answers; Local is a preference, not a guarantee.
- If a visitor switches to Cloud, that choice applies only for the current page session. A later refresh starts with Local preference again.
- The AIMeer welcome callout is shown on every page load. Its existing dismiss control remains available, and existing hover/focus behavior is preserved.
- When the chat opens, an in-chat JD matcher promotional message is inserted if it is not already present for that chat session. It explains that visitors can paste a job description or load a local PDF/DOCX for a deterministic compatibility estimate and provides a button to open the existing matcher panel.
- The promotion uses the existing i18n architecture with English DOM strings and matching Bahasa Melayu entries.

## Implementation boundaries

- Update only the AIMeer initialization/session preference logic, callout load behavior, chat promotion markup/behavior, and related localized strings/styles/tests.
- Do not change the conservative `AIMEER_DEVICE.evaluate` policy or the matcher scoring/extraction logic.
- Do not introduce a new persistence key or external dependency.

## Verification

- Add regression tests proving a persisted Cloud choice does not become the initial preference and a current-session Cloud switch still works.
- Add tests for the JD promotion trigger/action where the existing test harness supports DOM behavior; otherwise verify its accessible markup and event wiring with targeted static checks.
- Run the repository test command by enumerating `tests/*.test.js`.
- Manually inspect AIMeer at 375px, 768px, and 1440px widths, including refresh behavior, tooltip dismissal, Local/Cloud switching, and opening the JD matcher from the promotional message.
