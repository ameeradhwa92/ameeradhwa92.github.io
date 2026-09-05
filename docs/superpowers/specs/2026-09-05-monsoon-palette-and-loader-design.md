# Monsoon palette and the sand loader — design of record

**Date:** 2026-09-05 · **Status:** approved from mockups, implementing
**Mockups:** `docs/mockups/palette-proposal.html`, `docs/mockups/loader-proposal.html`

## Why

The previous look — near-black ground, one bright teal accent, tracked monospace
uppercase eyebrows, middle-dot separators, "↗" arrows, cream light mode — is the
default cluster that generated pages converge on. The site kept its structure and
typography; the colour *system* and the small typographic chrome changed.

## Palette: Monsoon

Two accents, split by job. **Iris** is the interface (links, buttons, live badges,
tags, chat chrome, globe coastlines and atmosphere). **Coral** is the journey thread
and nothing else: the scroll progress bar, the timeline spine and lit era nodes, era
years, the route rail progress and active stop, the globe route line and markers, the
hero underline under "Dungun", text selection and focus rings, and the loader.

| token | dark | light |
|---|---|---|
| `--ink` (ground) | `#161b33` indigo night | `#f1eff9` pale lilac |
| `--panel` | `#1c2240` | `#ffffff` |
| `--panel-2` | `#222a4b` | `#e7e6f4` |
| `--line` | `#303a66` | `#d2d2e6` |
| `--paper` (text) | `#f4ecdc` warm ivory | `#1a1f44` indigo |
| `--muted` | `#a2a6c9` | `#5c6088` |
| `--accent` | `#9ba1ff` iris | `#3f45c4` |
| `--accent-deep` | `#5c62d8` | `#3238a8` |
| `--accent-hover` | `#b3b7ff` | `#5a60de` |
| `--thread` | `#ff8577` coral | `#dd4a38` |
| `--amber` (Retired only) | `#e0b054` | `#9c7420` |

Token names: `--teal`, `--teal-deep`, `--teal-rgb` became `--accent`, `--accent-deep`,
`--accent-rgb` everywhere (stylesheet, `route-globe.js`, tests). `--thread` and
`--thread-rgb` are new. Amber stays reserved for Retired/EOL badges and is
distinguishable from coral on both grounds.

The dark ground is a real colour, not a tinted black, and the text is warm on a cool
ground; that pairing is what makes the page feel different at first sight. The light
ground is lilac-tinted, deliberately not cream.

## Typographic chrome

- `.eyebrow` stays as a class (tests and i18n keys reference it) but renders as italic
  Fraunces at body size, no tracking, no uppercase. Copy is unchanged.
- Stats labels, card client lines and the portrait caption are italic serif too.
- `.card-link` and `.edu-cert` lose the appended "↗" and use an underline instead.
- The hero `h1` keeps its two italic accent `em`s; the first (`Dungun`) carries
  `class="stop"` in both languages and is underlined in coral rather than coloured.
- A coral thread SVG draws once behind the hero after the loader releases the page.

## The loader

A first-paint overlay whose CSS and script are inline in `<head>`, ahead of the
stylesheet, so it costs nothing to load. The `<html>` element starts with class
`loading`; everything in `<body>` except the overlay is `visibility: hidden` until the
release. Content is in the DOM throughout (search engines, screen readers, no-JS
visitors get the page immediately; `html:not(.js)` never shows the overlay).

**Progress is real.** Weighted steps: stylesheet (1), fonts (2), hero portrait (3),
deferred scripts (2, `DOMContentLoaded`), everything else (1, `window.load`). The
globe's three.js and coastline JSON are excluded on purpose: they only load when the
section nears the viewport. Minimum display 1.6 s so it never blinks; release at 9 s
regardless so a stalled asset never holds the visitor. The status line is inline in
both languages, chosen from `documentElement.dataset.lang`, which the existing head
script sets before this runs.

**Gather.** About 460 canvas grains, coral with a fifth ivory, drift in from beyond
the edges and orbit a glowing core. The cloud grows with the percentage and tightens as
it fills; hairline ripples pulse every 0.9 s; the counter nudges on each tick.

**Bang.** The core flashes; every grain is thrown outward with its own velocity, drag,
a hint of gravity and a short trail. Underneath, the ground breaks into a 16px dot grid
that shrinks to nothing from the centre outward (a halftone dissolve at ~1000 px/s), so
the page appears through the scatter. The hero settles from a 3% zoom, then the thread
draws and the hero copy staggers in.

**Reduced motion:** no canvas; the overlay fades in 0.4 s. Canvas DPR is capped at 2 and
the dot grid is one batched path per frame.

## What else changed with the palette

- `<meta name="theme-color">`, the head theme-flash script, and the light-theme
  cursor glow follow the new tokens.
- `docs/resume-source/resume.html` recoloured (iris headings, indigo rules) and the PDF
  re-rendered.
- Globe posters recaptured per the CLAUDE.md procedure.
- `tests/route-globe-section.test.js` expectations updated for the renamed tokens and
  the coral rail.
- `?v=` bumped.
