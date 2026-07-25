# Résumé and AIMeer model controls implementation plan

## Goal

Improve the small-screen navigation and AIMeer controls without changing the site’s visual language or its three-tier answer fallback.

## Task 1: Add deterministic device eligibility policy

Files:

- Create `assets/js/aimeer-device.js`
- Create `tests/aimeer-device.test.js`
- Modify `index.html` to load the helper before `assets/js/chatbot.js`

Steps:

1. Write failing tests for iOS cloud-only, desktop WebGPU with enough buffer, desktop insufficient buffer, recognized flagship Android, unknown Android, mid-range Android, and Save-Data cloud preference.
2. Run `node --test tests/aimeer-device.test.js` and confirm the tests fail because the helper does not exist.
3. Implement the minimal helper with conservative case-insensitive family patterns for Galaxy S/Z, Pixel Pro/XL/Fold, OnePlus numbered flagships, OPPO Find X/N, vivo X/X Fold, HONOR Magic, Xiaomi Ultra/Pro Max, Huawei Pura/Mate, ASUS ROG/Zenfone, Sony Xperia 1, and REDMAGIC. Require WebGPU and the existing 1.5 GB adapter buffer threshold; classify unrecognized Android as `unknown`.
4. Run the focused tests and confirm all policy cases pass.
5. Commit with `git add assets/js/aimeer-device.js tests/aimeer-device.test.js index.html && git commit -m "feat: add conservative AIMeer device policy"`.

## Task 2: Add résumé icon control and shared button press feedback

Files:

- Modify `index.html` top navigation résumé link
- Modify `assets/css/style.css`
- Modify `assets/js/main.js` only if needed for one-time tooltip dismissal/reveal
- Modify `assets/js/i18n.js` for the résumé tooltip accessible copy

Steps:

1. Add the failing DOM contract test as a Node text-based assertion that `index.html` contains the PDF download URL, icon-only nav hook, accessible label hook, and tooltip copy key.
2. Run the test and confirm it fails because the current nav link has text-only markup and no tooltip hook.
3. Add the SVG and tooltip markup, using `data-i18n` for user-visible strings and keeping the nav link’s text available to screen readers while visually hiding it.
4. Add CSS for the compact icon state, one-time page-load reveal class, hover/focus behavior, theme-token tooltip surface, and a short `:active` press treatment covering `.btn`, `.nav-cta`, `.icon-btn`, chat buttons, chips, and other button-like controls without overriding focus styles.
5. Add the small JS hook that reveals the résumé tooltip once after page load, marks it as seen after dismissal or interaction, and does nothing when reduced motion is requested. Ensure the existing language observer can update the tooltip.
6. Run the DOM contract test and inspect the CSS selectors for both light/dark token use.
7. Commit with `git add index.html assets/css/style.css assets/js/main.js assets/js/i18n.js tests && git commit -m "feat: improve resume and button controls"`.

## Task 3: Add the AIMeer cloud/local segmented switcher

Files:

- Modify `index.html` chatbot header
- Modify `assets/css/style.css`
- Modify `assets/js/i18n.js` for static accessible labels/tooltips
- Modify `assets/js/chatbot.js`

Steps:

1. Add failing DOM assertions for the two switch buttons, cloud/local icons, pressed-state attributes, and compatibility tooltip hook.
2. Run the DOM test and confirm it fails because no model switcher exists.
3. Add the compact segmented HTML to the chat header with cloud and chip/device SVGs, localized accessible labels, and a tooltip that explains local incompatibility without disabling the control entirely.
4. Add theme-safe CSS using `--panel`, `--panel-2`, `--line`, `--paper`, `--muted`, `--teal`, `--teal-deep`, and `--shadow`; include narrow-panel sizing, focus-visible styles, touch-friendly hit targets, and reduced-motion behavior.
5. Wire `syncModelSwitch()` to current `route`, `aiState`, `localOK`, and `cloudOk`, updating `aria-pressed`, selected classes, and tooltip visibility whenever state changes.
6. Run the DOM test and verify the switcher is present in the intended header location.
7. Commit with `git add index.html assets/css/style.css assets/js/i18n.js assets/js/chatbot.js tests && git commit -m "feat: add AIMeer model switcher"`.

## Task 4: Integrate explicit preferences with routing and downloads

Files:

- Modify `assets/js/chatbot.js`
- Modify `assets/js/aimeer-device.js` only if a policy edge case discovered by integration tests requires correction
- Modify `tests/aimeer-device.test.js` for preference/route cases if the helper owns them

Steps:

1. Add failing routing tests or a browser-compatible harness covering explicit cloud preference, explicit local preference on eligible desktop, explicit local preference on ineligible Android, and switching to cloud while download is active.
2. Run the focused tests and confirm the current implementation fails because preferences are only partially handled and there is no visible switch path.
3. Update `decideRoute()` to use the helper, invalidate stale local preferences on ineligible devices, and default eligible desktop/allowlisted Android to local unless Save-Data or explicit cloud is set.
4. Implement `setPreferredRoute(mode)` with localStorage persistence, cancellation of `dlActive` and `fallbackTimer` when selecting cloud, and guarded local startup when selecting local.
5. Call `syncModelSwitch()` from every route/state transition already handled by `switchToCloud`, `startLocalAI`, cancellation, local success, local failure, and initial `decideRoute()` resolution.
6. Run all focused tests and verify no route can select local without `localEligible`.
7. Commit with `git add assets/js/chatbot.js assets/js/aimeer-device.js tests && git commit -m "feat: route AIMeer by explicit model preference"`.

## Task 5: Manual browser verification and final cleanup

Files:

- Modify only files required by verification findings.

Steps:

1. Run `node --check assets/js/aimeer-device.js`, `node --check assets/js/main.js`, and `node --check assets/js/chatbot.js`.
2. Run `node --test tests/aimeer-device.test.js`, `node --test tests/resume-control.test.js`, `node --test tests/chat-model-switcher.test.js`, and the complete `node --test tests/*.test.js`.
3. Serve with `python -m http.server 8080` from the repository root.
4. Verify at 375, 768, and 1440px widths in both explicit themes: nav résumé icon does not truncate; page-load tooltip appears and can be dismissed; hover/focus tooltip still works; button press feedback is subtle; chat switcher fits the panel and has clear selected state.
5. Verify routing with representative user agents: desktop Chrome WebGPU eligible, iPhone, Galaxy S-series, Pixel Pro, OnePlus flagship, and unknown Android. Confirm unknown/mid-low Android stays cloud even when WebGPU is simulated.
6. Curl the résumé PDF URL and confirm the download target still responds successfully.
7. Review `git diff`, confirm no unintended changes, and commit any final fix with a focused message.
