# AIMeer chat message motion

## Goal

The chat reads as dated because nothing moves at the moments a conversation
actually has beats. Three specific gaps:

- `addMsg` appends a bubble and sets `log.scrollTop = log.scrollHeight`. Bubbles
  appear instantly and the log jumps.
- The waiting state is the literal string `"Thinking…"` in a bubble with a
  whole-bubble opacity `pulse`. Text where every messaging UI now shows dots.
- The reply replaces that text in place, so the transition from waiting to
  answered has no visual continuity.

Match the iMessage send / wait / receive rhythm, at a restraint appropriate to a
dark-editorial career site rather than a messaging app.

## Design

### Bubble entrance

A single quick ease-out on every `.chat-msg`, no overshoot:

```css
@keyframes chat-msg-in {
  from { opacity: 0; transform: translateY(6px) scale(0.96); }
  to   { opacity: 1; transform: none; }
}
```

180ms on `cubic-bezier(0.22, 1, 0.36, 1)`, with `transform-origin` at
`bottom left` for bot bubbles and `bottom right` for user bubbles, so each grows
from its own corner the way it does in iMessage.

A bouncing overshoot was considered and rejected: next to the site's editorial
typography it reads as toy-like.

This is safe to apply to every `.chat-msg`. The first open of a session appends
up to three bubbles in one task — the greeting, optionally the on-device-ready
notice, then the JD promo — which animate together and read as the log fading
in rather than as separate entrances. Every other append — AI status changes,
conversation turns — really is one bubble at a time. There is no bulk history
restore that would fire dozens of entrances at once.

### Typing indicator

Three staggered dots in a bot-shaped bubble, replacing the `"Thinking…"` text.
Each dot rises 4px on a 1.2s loop, offset 0.15s apart.

The `thinking` i18n string is **not** deleted. It moves to an `aria-label` on the
dot group, so screen readers still hear "Thinking…" / "Sedang berfikir…" where
sighted users see dots. Dropping it would make the wait state silent to assistive
technology — a regression dressed as a visual upgrade.

The existing whole-bubble `pulse` animation is removed; the dots carry the motion
now, and pulsing the container as well would double it.

### Receive

The reply lands in the same element the dots occupied, so the bubble itself is
continuous — it does not exit and re-enter. Only the content changes, with a
180ms opacity fade so the swap is not a hard cut.

### Scrolling

`scroll-behavior: smooth` on `.chat-log`. The existing
`log.scrollTop = log.scrollHeight` calls then ease instead of jumping, so no
JavaScript changes for this at all, and no reduced-motion branch in JS.

### Reduced motion

`prefers-reduced-motion: reduce` disables all three: entrance `animation: none`,
dot `animation: none`, and `scroll-behavior: auto`. The dots remain visible and
static, so the wait state still reads without movement.

## Scope

- `assets/css/style.css` — entrance keyframes and rules, typing-dot rules,
  `scroll-behavior`, reduced-motion entries. Replaces the current
  `.chat-msg.thinking { animation: pulse … }`.
- `assets/js/chatbot.js` — build the dot markup instead of setting text; carry
  the `thinking` string to `aria-label`; fade content in when the reply lands.
- `tests/` — dot markup and its accessible label, keyframe presence, and the
  reduced-motion rules.

Out of scope: bubble tails, read receipts, message grouping by sender, and
per-character streaming. Colours, spacing, and bubble geometry are unchanged —
this is motion only.

## Verification

`node --test "tests/*.test.js"` and all five `tools/` harnesses green.

Manually over HTTP on port 8080: send a message and confirm the user bubble grows
from the bottom-right, the dots appear in a bot bubble, the reply replaces them in
the same bubble, and the log eases rather than jumps. Check at 375 / 768 / 1440,
dark and light, EN and BM, and with reduced motion forced on — where nothing may
animate and the log must not smooth-scroll.
