# Task 3 report — AIMeer model switcher

## Scope delivered

- Added the compact cloud/on-device segmented control to the AIMeer chat header.
- Added cloud and chip SVG icons, accessible pressed states, hidden translated labels, and a local-compatibility tooltip hook.
- Added Bahasa Melayu labels and compatibility help in `assets/js/i18n.js`.
- Added token-only, theme-safe styling with focus states, touch-sized controls, narrow-panel sizing, and reduced-motion overrides.
- Added `setPreferredRoute(mode)`, `syncModelSwitch()`, and `showLocalCompatibilityHint()` scaffolding to `assets/js/chatbot.js`.

## Intentional Task 4 boundary

`setPreferredRoute()` persists the visitor's cloud/local preference and synchronizes the visible control only. It does not change `decideRoute()`, switch a live route, start a local download, or cancel one. Those routing transitions remain for Task 4.

## Test-first evidence

1. Added `tests/chat-model-switcher.test.js` before implementation.
2. Ran `node --test tests\\chat-model-switcher.test.js`; it failed because the chat header did not yet contain `#chat-model-switch`.
3. Implemented the smallest header, CSS, i18n, and synchronization changes needed by the brief.
4. Re-ran the focused test and then the complete Node suite successfully.

## Verification

- `node --test tests\\chat-model-switcher.test.js` — 2 passed, 0 failed.
- `node --test tests\\*.test.js` — 12 passed, 0 failed.
- `node --check assets\\js\\chatbot.js`
- `node --check assets\\js\\i18n.js`
- `node --check assets\\js\\main.js`
- `git diff --check`

## Files changed

- `index.html`
- `assets/css/style.css`
- `assets/js/i18n.js`
- `assets/js/chatbot.js`
- `tests/chat-model-switcher.test.js`

## Follow-up

Task 4 should consume the saved preference and make the control initiate the existing cloud/local state transitions, including cancellation and local eligibility routing.

---

## Review fix — preferred mode and touch targets

### P1: visible preference state

Added a distinct `preferredMode` state. `setPreferredRoute()` now updates it before persisting, and `syncModelSwitch()` uses it for the selected class and `aria-pressed` values. The live `route` and `aiState` remain unchanged by an explicit choice, preserving the Task 4 boundary.

Added a runtime regression test for a Save-Data device where local AI is eligible but cloud remains the active route. Selecting Local now visibly selects Local and stores `aimeer-route=local` without adding live routing behavior.

### P2: touch target sizing

Increased each model segment to a 44px by 44px touch target and removed the narrow-panel rule that shrank segments below that size. The narrow layout now reduces only header padding and gaps.

### Verification

- Red: the new preference-state assertion failed with Local still `aria-pressed="false"`; the touch-target contract failed at 38px by 34px.
- Green: `node --test tests\\chat-model-switcher.test.js` — 4 passed, 0 failed.
- Full: `node --test tests\\*.test.js` — 14 passed, 0 failed.
- Syntax: `node --check assets\\js\\chatbot.js`, `assets\\js\\i18n.js`, and `assets\\js\\main.js`.
- `git diff --check` completed without whitespace errors.
