# AIMeer focused JD matcher mode

## Goal

Give the JD matcher enough vertical space on narrow screens without changing the
normal AIMeer chat footprint or hiding the AI route/progress status.

## Design

When the recruiter matcher is opened, the chat panel receives a focused JD state.
The AI status/progress card remains visible. The conversation log, ordinary
question chips, and chat composer are hidden so the matcher can use the remaining
panel height. The existing `Match a JD` control remains visible as the return
control and toggles the focused state closed.

The JD panel changes from its narrow fixed maximum height to a flexible panel in
focused mode. Its internal scrolling remains available for the file controls and
results. Closing the matcher removes the focused state and restores the normal
chat content.

## Scope

- Update `chatbot.js` to synchronize the focused state with the existing
  `setRecruiterOpen` flow.
- Update `style.css` with focused-state rules and preserve the AI progress card.
- Add a regression test covering the focused-state hook and toggle behavior.
- Do not change matcher scoring, parsing, localization, or the normal chatbot
  layout.

## Verification

Run the focused chatbot test file and the complete enumerated Node test suite.
Inspect the resulting CSS/HTML hooks and manually check the matcher at narrow and
desktop widths over HTTP.
