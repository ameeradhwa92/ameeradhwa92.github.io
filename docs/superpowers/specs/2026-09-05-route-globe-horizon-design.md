# Route globe "Horizon" redesign — design

**Date:** 2026-09-05
**Status:** approved direction (A. Horizon + merged heading), spec awaiting review
**Supersedes:** the globe paragraph (2b) in `2026-07-24-portfolio-site-design.md` for
layout and rendering; the data model, gate, fallbacks and privacy rules there stay.

## 1. Problem

The route globe shipped in `abf18a5` works, but it reads as an embedded video rather
than part of the page:

1. **A boxed card.** The stage is a bordered, rounded, drop-shadowed panel inside the
   1100px column. Nothing else on the page is a card that size; hero, stats and timeline
   are open and full-bleed.
2. **A lighter rectangle.** The sphere base is `--panel`, the page is `--ink`. At close
   zoom the sphere fills the box, so the visitor sees a flat, slightly lighter rectangle
   with coastlines in it: a 2D map.
3. **The sphere is visible for one stop of nine.** Eight stops zoom to distance
   1.09–1.45 with a 38° FOV, so the limb never enters the frame. Four stops (Kuala Lumpur,
   Shah Alam, Petaling Jaya, Shah Alam) lie within ~20 km, so the camera barely moves for
   half the scroll.
4. **No depth cues.** No atmosphere, no lighting, no far-side fading, no horizon, 1px
   hardware lines, flat markers with `depthTest: false`.
5. **No handoff to the timeline.** The route line is paper, the timeline spine is glowing
   teal. The card ends, a gap, then a second heading that repeats the first ("one line of
   travel" twice).

## 2. Goal

The globe becomes the opening act of the journey: full-bleed, borderless, drawn over the
page's own atmosphere, with the curved limb and its glow in frame at **every** stop, and a
caption rail that sits on the same vertical line as the timeline spine so the route flows
into the eras below. One heading introduces both.

Non-goals: merging the nine stops into the timeline's `.era` list (a possible phase two),
post-processing bloom, touch drag, any change to the stops data, coordinates or privacy
rules.

## 3. Layout

### 3.1 One section head

`#route` keeps its `section-head`; `#journey` loses its own. The `globe.eyebrow`,
`globe.h2` and `globe.p` keys stay (the section test requires the `globe.*` namespace) and
take merged copy. `journey.eyebrow`, `journey.h2` and `journey.p` are removed from
`index.html` and `i18n.js`.

| key | EN | MS (DBP register) |
|---|---|---|
| `globe.eyebrow` | The Journey · 1992 → Today | Perjalanan · 1992 → Kini |
| `globe.h2` | One small town, one line of travel — every stop <em>still running</em> somewhere. | Satu pekan kecil, satu garis perjalanan — setiap hentian masih <em>beroperasi</em> di suatu tempat. |
| `globe.p` | Scroll to fly the route town by town — on a desktop, drag the globe to look around. Below it, every port of call is a real era with its live links; systems since decommissioned are honestly marked <b>Retired</b>. | Tatal untuk menyusuri laluan dari satu pekan ke pekan seterusnya — pada desktop, seret glob untuk melihat sekeliling. Di bawahnya, setiap persinggahan ialah era sebenar dengan pautan langsungnya; sistem yang telah ditamatkan operasinya ditanda secara jujur sebagai <b>Dihentikan</b>. |

Anchors: the nav "Journey" link, the hero "Walk the timeline ↓" button and the skip link
now target `#route`, so a jump lands on the heading rather than a heading-less timeline.
`<main id="journey">` keeps its id and `section wrap` classes and gains
`journey-continued`, which drops its top padding to 24px so the timeline starts directly
under the stage.

### 3.2 The stage

- `.route-track` breaks out of `.wrap`: `width: 100vw; margin-left: calc(50% - 50vw)`.
  The body already hides horizontal overflow.
- `.route-stage` (live) is `position: sticky; top: 0; height: 100dvh` (with a `100vh`
  fallback). No border, radius, background or shadow. The canvas clears to transparent, so
  the fixed `.atmosphere` shows through.
- The canvas gets `mask-image: linear-gradient(to bottom, transparent, #000 10%, #000 90%,
  transparent)` so the scene dissolves into the page at the stage's top and bottom edges.
  Because the nav is translucent, the globe passing under it is intended.
- Track height: unchanged formula (`trackHeight`), `SEGMENT_SCROLL_SHARE` stays 0.42.

### 3.3 Composition (desktop ≥ 900px)

```
┌──────────────────────────────────────────────────────────────┐
│ nav                                                          │
│                                                              │
│  ● 1992  Dungun, Terengganu           ╭──────────────────╮   │
│  │       Born here …                ╱      ·  ·           ╲  │
│  ● →2009 SMK Balai Besar          ╱   ·          ╭─╮        ╲│
│  ● 2010  UiTM Dungun             │      ·     ●─╯KL          │
│  ○ 2013  Kuala Lumpur            │        ·  ●SA  ●PJ        │
│  ○ …                             │  ·           ·            │
│  ○ Today Southeast Asia           ╲       ·         ·       ╱│
│                                     ╲__________________ ╱    │
│  caption rail at --spine-x        globe centre ≈ 66% x, 52% y│
└──────────────────────────────────────────────────────────────┘
```

- **Caption rail** (`.route-rail`): a column aligned to the wrap's left edge, listing every
  keyframe as `year · place` in mono/display type with a node dot at `--spine-x`, exactly
  the `.era-node` look. The active stop's node lights like `.era.lit .era-node`, its row
  expands to show `.route-stop-desc` (and the footprint chips on the last stop), inactive
  rows sit at reduced opacity. A `.route-rail-progress` bar draws from the first node to the
  active node using the `.spine-progress` gradient. The rail is the existing `<ol
  id="route-stops">`; only CSS and the active class change.
- **Globe**: rendered large and offset so its centre sits at about 72–80% of the viewport
  width (narrower windows push it further right) and 52% of its height; the right limb
  bleeds off the right edge, the left limb and atmosphere stay in frame. The offset relaxes
  as the camera pulls back so the whole sphere is visible at the final reveal. See §4.6.
- The drag hint moves to the bottom-right corner.

### 3.4 Composition (≤ 899px)

The rail collapses to the current single crossfading caption at the bottom of the stage
(one `.route-stop.is-active` at a time); the globe centre moves to 50% x and about a
third of the way down (FOV 66°, vertical offset −0.16) so the caption never covers
Malaysia. Stage height `min(100dvh, 720px)`.

### 3.5 Fallback (no JS, gated off, load failure, context lost)

Unchanged in structure: the poster and the plain stops grid. The poster loses its border
and radius and gains the same top/bottom mask so it also dissolves into the page. Posters
are re-captured from the finished scene at the final reveal (dark and light, 1600×900,
`--ink` baked in).

## 4. Rendering

All colours still come from the palette custom properties through `applyTheme()`; new
uniforms are added to the same function. Rendering stays on demand (scroll, drag, theme,
resize) plus the existing ~30 fps loop only while the stage is on screen; that loop now
also drives the time uniforms below.

### 4.1 Sphere surface

`ShaderMaterial`, replacing the current base+rim shader:

- **Hemisphere light** from a fixed direction in view space (upper-left, matching the CSS
  atmosphere gradients): `wrap = 0.35`, `lit = clamp((dot(n, L) + wrap) / (1 + wrap), 0, 1)`.
- **Colour** = `mix(shadow, base, lit)` where `base` is `--panel` and `shadow` is `--ink`,
  so the terminator side falls into the page background and the sphere emerges from it
  instead of sitting on it.
- **Surface tone**: a cheap 3D value-noise term at 3% amplitude so the ocean is not a flat
  fill.
- **Fresnel rim** kept, `strength` 0.45 dark / 0.18 light, colour `--teal` dark,
  `--teal-deep` light.

### 4.2 Atmosphere shell

A second sphere, radius 1.09, `side: BackSide`, `depthWrite: false`, with the glow rising
toward the globe's limb: on back faces the outward normal points away from the camera, so
the shader uses `smoothstep(0, 0.45, -dot(n, view))²` (the `pow(1 - dot, 4)` form is for
front faces and would be wrong here):

- Dark: `--teal`, `AdditiveBlending`, peak alpha 0.55.
- Light: `--teal-deep`, `NormalBlending`, peak alpha 0.16 (a haze, not a glow).

### 4.3 Far-side fading lines

Coastlines and graticule keep 1px `LineSegments` (thin is right for outlines) but move to
a small `ShaderMaterial` that fades each vertex by `smoothstep(-0.15, 0.30, dot(normalize
(position), viewDir))`. The far hemisphere disappears instead of showing through as a flat
outline, which is the single biggest depth cue.

### 4.4 Route and arcs as fat lines

The route polyline and the three footprint arcs move to three.js's `Line2` addon:

- `LineMaterial`, `worldUnits: false`, `linewidth` 2.5px, colour `--teal` (the route now
  rhymes with the spine). The arcs use `--paper` as today, so they read against teal
  coastlines.
- A second copy at 7px, opacity 0.12, same geometry, for a soft glow without a bloom pass.
- A third copy, `dashed: true`, short `dashSize` and long `gapSize`, `dashOffset` animated
  on the time uniform: a single light travelling along the drawn part of the route. The
  draw range logic (`routeDrawCount`) still governs how much is visible; the dashed copy
  uses the same `instanceCount` cap.
- The addon files `Line2.js`, `LineSegments2.js`, `LineGeometry.js`,
  `LineSegmentsGeometry.js`, `LineMaterial.js` from `three@0.185.1
  examples/jsm/lines/` are vendored unmodified under `assets/vendor/three/lines/`. They
  import the bare specifier `three`, so `index.html` gains an inline
  `<script type="importmap">` in `<head>` (before any script tag, as the spec requires)
  mapping `three` to `assets/vendor/three/three.module.min.js`. It has no `src`, so the
  `?v=` checks in `verify_recruiter_ui.ps1` are unaffected.
  The vendor README records the five files, the pin and the reason for the import map.

### 4.5 Markers, pulse and labels

- Place and footprint markers become additive `ShaderMaterial` discs: a soft-edged dot plus
  a ring that pulses (radius 1→2.6, alpha 0.6→0) on the time uniform for the **active**
  marker only. Remote stops keep the outer halo ring. The per-frame rescale to a constant
  screen size stays (`markerRadius`).
- **Labels are DOM.** Each distinct place (deduplicated by lat/lng exactly as
  `markersByPlace` does) and each footprint gets a `<span class="route-label">` appended to
  the stage. Text is the `.route-stop-place` text of the first stop at that place with any
  ` · ` suffix removed (so "Shah Alam · remote" labels "Shah Alam"); footprints use their own
  text. Labels re-read on `data-lang` changes through the existing root attribute observer.
- Each keyframable `<li>` may carry `data-label-dir` (`n|ne|e|se|s|sw|w|nw`, default `e`)
  which sets the label's offset from the marker; the Klang Valley cluster uses `ne` (Kuala
  Lumpur), `w` (Shah Alam) and `se` (Petaling Jaya) so three places 20 km apart fan out
  instead of stacking. A 1px leader line from the label toward the marker is a CSS
  pseudo-element.
- Per frame, the adapter projects each marker to CSS pixels and sets `transform`; a label is
  hidden — together with its marker, by one shared rule — when its surface point is
  behind the horizon: `dot(dir, cameraDir) < 1/distance + 0.04`. The active place's label
  is `--paper` at full opacity; others are `--muted` mono at 0.7.

### 4.6 Camera: the limb is always in frame

- Distances: `place`/`remote` default 1.7, `region` 3.0. The `data-zoom` values in the
  markup are updated to the range 1.65–1.8 for towns and 3.0 for the region. Street-level
  zoom is gone on purpose: the marker, pulse, label and caption identify the stop; the
  sphere identifies the medium. (1.7 rather than 1.6 keeps the left limb just right of the
  caption rail at 1440px; at 1.6 the rail overlaps the atmosphere.)
- `framing(distance, aspect, layout)` is a new pure core function returning `{fov,
  offsetX, offsetY}` (offsets as fractions of the frame, applied through
  `camera.setViewOffset`). `layout` is `wide` or `narrow`. It scales the horizontal offset
  with distance so the left limb stays near the same screen x as the camera zooms, and
  raises the FOV on narrow aspects (portrait) so the top limb shows instead.
- `limbInFrame(distance, fov, aspect, offsetX, offsetY)` is a pure predicate: the sphere's
  angular radius `asin(1/distance)` minus the offset angle is smaller than the half-FOV on
  at least one axis. `framing()` must satisfy it for every distance in [1.5, 3.2] and every
  aspect in [0.45, 2.4]; the core test asserts this on a grid.
- **Banking** on long hops: `bankAngle(travel, hopAngle)` returns a roll of up to 6°
  (`sin(π·travel)` shaped, sign from the hop direction) applied as a roll
  (`camera.rotateZ`) after `lookAt`; zero when the hop is under 2°, so the Klang
  Valley moves do not wobble.
- Idle drift, drag orbit and the settle decay are unchanged.

### 4.7 Starfield (dark theme only)

`Points`: 600 unit vectors at radius 6–9, `size` 1.6px, `sizeAttenuation: false`, opacity
0.35 dark / 0 light. The star group rotates by 0.3× the drag yaw offset for parallax
while orbiting; the scroll flight leaves it fixed. `starPositions(count, seed)` is a
pure core function (deterministic, testable).

### 4.8 Budget

| Item | Value |
|---|---|
| Draw calls | ≤ 20 (sphere, atmosphere, coastlines, graticule, stars, three route copies, two arc copies, one mesh per marker) |
| Extra script weight | ≈ 25 KB (the five Line2 files) |
| DPR cap | 1.75 (down from 2; the stage is now full-bleed) |
| Animation | time uniforms only advance while the stage is on screen, as today |
| Post-processing | none |

## 5. Data flow

Unchanged: `<ol id="route-stops">` is the data source. New per-stop attribute
`data-label-dir` is optional. `parseStops` gains `labelDir` (validated against the eight
values, default `e`, warning on an unknown value). Everything else the adapter needs (label
text, dedup, projection) is derived in `route-globe.js` from the parsed stops and the DOM.

## 6. Error handling

The gate, the load state machine and the terminal context-lost path are unchanged. Two
additions:

- If the `Line2` addon import fails but three.js loads, the adapter falls back to the
  existing `LineBasicMaterial` route and arcs and writes `section.dataset.globe =
  "live-thin"` so the reason is visible in DevTools. Everything else renders.
- If `camera.setViewOffset` is unavailable (it is present in r185; the guard is one line),
  the framing offset is ignored and the globe is centred.

## 7. Theme and reduced motion

- Every new colour has a dark and a light value read from the palette in `applyTheme()`;
  no colour is hard-coded in the shaders beyond the fallbacks that already exist.
- Light theme: stars off, atmosphere as haze, rim at 0.18, sphere shadow side `--panel-2`
  rather than `--ink` so a white globe does not go grey.
- `prefers-reduced-motion` keeps gating the globe off entirely. The CSS block additionally
  sets `.route-label` and `.route-rail-progress` to `transition: none` (`.route-stop` is
  already frozen there).

## 8. Files

| File | Change |
|---|---|
| `index.html` | merged heading copy; anchors → `#route`; `journey-continued`; `data-label-dir` on Klang Valley stops; `data-zoom` values; import map; `?v=` bump |
| `assets/js/i18n.js` | merged `globe.*` copy; remove `journey.eyebrow/h2/p` |
| `assets/css/style.css` | full-bleed stage, mask, rail, labels, hint position, mobile caption, reduced-motion additions, poster de-boxing |
| `assets/js/route-globe-core.js` | `framing`, `limbInFrame`, `bankAngle`, `starPositions`, `labelDir` in `parseStops`, new `DEFAULT_ZOOM` |
| `assets/js/route-globe.js` | new materials, atmosphere, stars, Line2 route/arcs, labels, framing, banking, `live-thin` fallback |
| `assets/vendor/three/lines/*.js` + `assets/vendor/README.md` | five addon files, pin, import-map note |
| `tests/route-globe-core.test.js` | framing invariant grid, bank angle endpoints, star determinism, `labelDir` parsing |
| `tests/route-globe-section.test.js` | import map present and correct; addon files present and pinned; merged heading keys and removed `journey.*` keys; anchors; `journey-continued`; valid `data-label-dir`; zoom range 1.5–3.2; mask CSS; reduced-motion additions |
| `assets/img/route-globe-{dark,light}.jpg` | re-captured |
| `docs/superpowers/specs/2026-07-24-portfolio-site-design.md` | 2b paragraph points here |
| `CLAUDE.md` | Route globe section: import map, Line2 vendoring, framing invariant, `live-thin` |

No change to `aimeer-kb.txt`, the résumé or the Worker: no fact changes, only layout and
copy structure.

## 9. Testing

- `node --test "tests/*.test.js"` and all five `tools/` harnesses green.
- Manual: 375 / 768 / 1440 widths, dark and light, EN and BM; every stop shows the limb
  and atmosphere; the three Klang Valley labels never overlap; drag settles; theme switch
  mid-scroll recolours everything; `section.dataset.globe` reads `live`.
- Fallback: `prefers-reduced-motion` and a WebGL2-disabled profile show the de-boxed poster
  and the plain list.
- Performance: Chrome DevTools performance panel on a 1440×900 integrated-GPU profile,
  scrolling the whole track: no frame over 16 ms outside the initial load; idle on-screen
  loop ≤ 30 fps.

## 10. Rollout

One branch, one `?v=` bump, posters last. The vendored addon and import map land in the
same commit as the code that uses them so no deploy ships an unresolved `three` specifier.
