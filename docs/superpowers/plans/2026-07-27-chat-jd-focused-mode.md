# Focused JD Matcher Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the JD matcher fill the useful chatbot height on narrow screens while keeping the AI progress/status card visible.

**Architecture:** Reuse the existing `setRecruiterOpen` state transition. When open, add a `chat-panel--jd-open` class, hide only the normal chat log, ordinary chips, and composer, and let `.chat-jd-panel` flex into the remaining space. The AI status/progress card stays in the normal flex flow.

**Tech Stack:** Hand-written HTML/CSS/JavaScript, Node’s built-in test runner, VM-based chatbot tests.

## Global Constraints

- Preserve the existing chatbot footprint when the matcher is closed.
- Keep the AI status/progress card visible in focused JD mode.
- Do not change matcher scoring, parsing, localization, or route selection.
- Maintain the project’s reduced-motion and narrow touch-target behavior.

---

### Task 1: Add a failing focused-mode regression test

**Files:**
- Modify: `tests/chat-model-switcher.test.js`

**Interfaces:**
- Consumes: Existing `createChatContext`, `loadChat`, and recruiter toggle behavior.
- Produces: Assertions that the panel exposes focused mode when opened and restores normal mode when closed.

- [ ] **Step 1: Write the failing test**

Add a test after the existing JD promotion tests:

```js
test('JD matcher uses focused mode while retaining the AI progress card', async () => {
  const { context, elements } = createChatContext({ saveData: false });
  await loadChat(context);
  elements['chat-launcher'].dispatch('click');

  elements['chat-jd-toggle'].dispatch('click');
  assert.equal(elements['chat-panel'].classList.contains('chat-panel--jd-open'), true);
  assert.equal(elements['chat-jd-panel'].hidden, false);

  elements['chat-jd-toggle'].dispatch('click');
  assert.equal(elements['chat-panel'].classList.contains('chat-panel--jd-open'), false);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
node --test tests/chat-model-switcher.test.js
```

Expected: the new test fails because the chat panel does not yet receive the `chat-panel--jd-open` class.

### Task 2: Implement the focused layout state

**Files:**
- Modify: `assets/js/chatbot.js` in `setRecruiterOpen`
- Modify: `assets/css/style.css` beside the existing `.chat-jd-panel` and mobile rules

**Interfaces:**
- Consumes: `jdState.open`, `panel`, `jdPanel`, `jdToggle`, `.chat-ai`, `.chat-log`, `.chat-chips`, and `.chat-form`.
- Produces: The `chat-panel--jd-open` class synchronized with the existing open/close state.

- [ ] **Step 1: Add the state synchronization**

Inside `setRecruiterOpen`, after assigning `jdState.open`, synchronize the panel class:

```js
panel.classList.toggle('chat-panel--jd-open', jdState.open);
```

- [ ] **Step 2: Add focused-mode CSS**

Add these rules next to the existing JD panel rules:

```css
.chat-panel--jd-open .chat-log,
.chat-panel--jd-open .chat-chips button:not(#chat-jd-toggle),
.chat-panel--jd-open .chat-form {
  display: none;
}
.chat-panel--jd-open .chat-chips {
  padding-top: 12px;
}
.chat-panel--jd-open .chat-jd-panel {
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
}
```

Do not hide `.chat-ai`; the progress/status card remains visible.

- [ ] **Step 3: Run the focused test to verify it passes**

Run:

```powershell
node --test tests/chat-model-switcher.test.js
```

Expected: all tests pass, including the focused-mode regression test.

### Task 3: Verify the complete change

**Files:**
- Inspect: `index.html`, `assets/css/style.css`, `assets/js/chatbot.js`, `tests/chat-model-switcher.test.js`

- [ ] **Step 1: Run the full enumerated test suite**

Run:

```powershell
node --test (Get-ChildItem tests -Filter '*.test.js' | Select-Object -ExpandProperty FullName)
```

Expected: exit code 0 with no failed tests.

- [ ] **Step 2: Check the diff for whitespace errors**

Run:

```powershell
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 3: Inspect the layout over HTTP**

Serve the site on port 8080, open the chatbot at a narrow mobile-sized viewport and a desktop-sized viewport, select `Match a JD`, confirm the AI progress/status card remains visible, and confirm the matcher gets the remaining height. Toggle back and confirm the normal chat content returns.
