# AIMeer local default and JD promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reset AIMeer to Local preference on every refresh, show its welcome callout on every page load, and promote the JD matcher inside the chat.

**Architecture:** Keep device policy and route fallback unchanged. Make `chatbot.js` own the session-only model preference by removing the persisted route before route evaluation; keep Cloud/Local clicks as in-memory state. Make the existing callout unconditional per load, and add a localized in-chat promotion with a button wired to the existing recruiter panel.

**Tech Stack:** Plain HTML/CSS/JavaScript IIFEs, `node:test`, `node:vm` test harness, existing `data-i18n`/`I18N_MS` localization.

## Global Constraints

- Existing device eligibility and fallback rules remain unchanged.
- Unsupported devices may still route to Cloud or Instant answers; Local is a preference, not a guarantee.
- A current-session Cloud choice must not survive a later refresh.
- The welcome callout remains dismissible and keeps existing hover/focus behavior.
- New user-visible copy requires a `data-i18n` key and a matching `i18n.js` entry.
- No new persistence key or external dependency.
- Run tests by enumerating `tests/*.test.js`.

---

### Task 1: Make Local the refresh default and add regression coverage

**Files:**
- Modify: `assets/js/chatbot.js:905-912,1121-1140`
- Test: `tests/chat-model-switcher.test.js`

**Interfaces:**
- Consumes: existing `preferredMode`, `persistPreferredRoute`, `clearPreferredRoute`, `setPreferredRoute`, and `decideRoute()` state machine.
- Produces: route initialization that starts with `preferredMode === null` and cannot read a stale `aimeer-route` value from a previous page session; current-session Cloud clicks continue to set `preferredMode` and route normally.

- [ ] **Step 1: Write the failing tests**

Add tests proving a persisted Cloud preference is cleared/ignored and a Cloud click remains session-only:

```js
test('refresh ignores and clears a persisted cloud preference', async () => {
  const { context, elements, stored } = createChatContext({
    storage: { 'aimeer-route': 'cloud' }, saveData: false
  });
  await loadChat(context);
  elements['chat-launcher'].dispatch('click');
  assert.equal(stored.has('aimeer-route'), false);
  assert.equal(elements['chat-model-local'].getAttribute('aria-pressed'), 'true');
  assert.equal(elements['chat-model-cloud'].getAttribute('aria-pressed'), 'false');
});

test('switching to cloud remains a current-session choice', async () => {
  const { context, elements, stored } = createChatContext({ saveData: false });
  await loadChat(context);
  elements['chat-launcher'].dispatch('click');
  elements['chat-model-cloud'].dispatch('click');
  assert.equal(elements['chat-model-cloud'].getAttribute('aria-pressed'), 'true');
  assert.equal(stored.get('aimeer-route'), undefined);
});
```

Update the existing persisted-cloud test to assert the new requirement instead of expecting Cloud to survive initialization.

- [ ] **Step 2: Run the focused tests and verify the expected failure**

Run `node --test tests/chat-model-switcher.test.js`.

Expected: the new refresh test fails because `decideRoute()` currently reads and honors `localStorage['aimeer-route']`, and the current-session test fails because Cloud currently persists the choice.

- [ ] **Step 3: Implement session-only preference initialization**

At the beginning of `decideRoute()`, remove the old `aimeer-route` value and do not assign `preferredMode` from storage:

```js
function decideRoute() {
  try { localStorage.removeItem('aimeer-route'); } catch (e) { }
  var pref = null;
  // Existing device policy evaluation remains unchanged below.
```

Change `persistPreferredRoute(mode)` to update only in-memory `preferredMode`; remove its `localStorage.setItem` call. Keep `clearPreferredRoute()` removing the legacy key so existing values are cleaned up. Button handlers continue using `setPreferredRoute()` and the live state machine.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run `node --test tests/chat-model-switcher.test.js`.

Expected: all model switcher tests pass, including device fallback, cancellation, and WebLLM generation-guard tests.

- [ ] **Step 5: Commit the route behavior**

```powershell
git add assets/js/chatbot.js tests/chat-model-switcher.test.js
git commit -m "feat: default AIMeer to local per session"
```

### Task 2: Show the welcome callout on every page load

**Files:**
- Modify: `assets/js/chatbot.js:1054-1078`
- Test: `tests/chat-model-switcher.test.js`

**Interfaces:**
- Consumes: existing `callout`, `hideCallout`, `open`, `setTimeout`, and click handler.
- Produces: each fresh script load schedules the callout regardless of prior `aimeer-callout` storage, while close still hides it and body click still opens the panel.

- [ ] **Step 1: Write the failing static regression test**

Assert that the callout is present in `index.html` and that the chatbot source contains an unconditional delayed `callout.hidden = false` reveal with `if (open) return`, while retaining `hideCallout(true)` in the click handler.

- [ ] **Step 2: Run the focused test and verify it fails**

Run `node --test tests/chat-model-switcher.test.js`.

Expected: failure because the current reveal is wrapped in `if (!calloutSeen)`.

- [ ] **Step 3: Remove only the cross-load suppression**

Keep the delayed reveal and `open` guard, but remove the `calloutSeen` read and conditional wrapper. Keep `hideCallout(true)` for the current interaction and leave CSS transition/dismiss behavior intact.

- [ ] **Step 4: Run the focused test and verify it passes**

Run `node --test tests/chat-model-switcher.test.js`; expect all tests to pass.

- [ ] **Step 5: Commit the callout behavior**

```powershell
git add assets/js/chatbot.js tests/chat-model-switcher.test.js
git commit -m "feat: show AIMeer welcome callout on each load"
```

### Task 3: Promote JD matcher inside the chat bubble

**Files:**
- Modify: `index.html:625-642`, `assets/js/chatbot.js:870-890,1083-1115`, `assets/js/i18n.js`, `assets/css/style.css`
- Test: `tests/chat-model-switcher.test.js`

**Interfaces:**
- Consumes: existing `addMsg`, `setRecruiterOpen`, `recruiterUI`, `greeted`, and `chat-log`.
- Produces: one accessible `chat-jd-promo` message per chat session with localized copy and a `chat-jd-promo-action` button that opens the existing matcher panel.

- [ ] **Step 1: Write the failing markup/localization/behavior tests**

Assert that `index.html` exposes `data-i18n="chat.jd.promo"` and `data-i18n="chat.jd.promoAction"`, that `I18N_MS` contains both keys, and that opening the launcher adds one `chat-jd-promo` message. Extend the existing DOM harness with `chat-jd-toggle` and `chat-jd-panel`; clicking the promotion action must set the matcher toggle to `aria-expanded="true"` and the panel to visible.

- [ ] **Step 2: Run the focused test and verify it fails**

Run `node --test tests/chat-model-switcher.test.js`; expect failure because there is no in-conversation promotion or action.

- [ ] **Step 3: Add localized promotion markup and strings**

Use the existing `data-i18n` system for copy such as “Hiring for a role? Paste the JD and I’ll compare it with Ameer’s published profile locally.” and a clear action such as “Match a job description”. Add formal Bahasa Melayu equivalents in `assets/js/i18n.js`.

- [ ] **Step 4: Wire the promotion action to the existing matcher**

Create `addJdPromotion()` near `setRecruiterOpen()`. Return if `recruiterUI` is false or `#chat-jd-promo` already exists. Build a `.chat-msg.chat-msg-bot.chat-jd-promo` element, append localized text and `#chat-jd-promo-action`, and call `setRecruiterOpen(true)` from its click listener. Call it after the greeting in `openPanel()`.

- [ ] **Step 5: Add compact, prominent, theme-safe styling**

Add `.chat-jd-promo` and `.chat-jd-promo-action` beside existing chat/JD rules. Use a teal-tinted border/background, readable text, visible focus styling, and a full-width or clearly separated action on narrow screens. Include the action in reduced-motion overrides if it receives a transition.

- [ ] **Step 6: Run the focused test and verify it passes**

Run `node --test tests/chat-model-switcher.test.js`; expect promotion markup, localization, and action behavior to pass without changing matcher scoring.

- [ ] **Step 7: Commit the JD promotion**

```powershell
git add index.html assets/js/chatbot.js assets/js/i18n.js assets/css/style.css tests/chat-model-switcher.test.js
git commit -m "feat: promote JD matcher inside AIMeer chat"
```

### Task 4: Full verification and manual handoff

**Files:**
- Modify: none unless verification exposes a regression

- [ ] **Step 1: Run all repository tests**

Run `node --test (Get-ChildItem tests -Filter '*.test.js' | Select-Object -ExpandProperty FullName)`; expect all tests to pass with no warnings or failures.

- [ ] **Step 2: Check the final diff and working tree**

Run `git diff --check` and `git status --short`; expect no whitespace errors and only intentional implementation files modified.

- [ ] **Step 3: Perform manual browser verification**

Serve with `python -m http.server 8080`, then inspect 375px, 768px, and 1440px widths. Confirm refresh starts with Local selected on an eligible desktop; Cloud works until refresh; the welcome callout appears after each load and can be dismissed; opening AIMeer shows the JD promotion; its action opens the matcher; language switching localizes the promotion; reduced motion has no unwanted animation.

- [ ] **Step 4: Report the handoff**

Report changed files, test output, and that no Cloudflare Worker deployment is required.
