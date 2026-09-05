# Route Globe "Horizon" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the boxed route globe into a full-bleed, lit, atmosphere-wrapped three.js globe whose limb is in frame at every stop, with a caption rail that flows into the timeline spine under one merged heading.

**Architecture:** The pure core (`route-globe-core.js`) gains the camera framing invariant, banking, star positions and label directions, all unit-tested with `node --test`. The DOM/WebGL adapter (`route-globe.js`) is rewritten around new shader materials, three.js's vendored `Line2` addon (resolved through an import map), projected DOM labels and the caption rail. Markup, copy, CSS and posters change around them; every fallback path and the privacy rules stay as they are.

**Tech Stack:** Hand-written HTML/CSS/JS, no build step. three.js r185 (`0.185.1`) vendored ESM plus its `examples/jsm/lines` addon. `node --test` for unit tests. PowerShell + Node harnesses in `tools/`. Local preview with `python -m http.server 8080`.

**Spec:** `docs/superpowers/specs/2026-09-05-route-globe-horizon-design.md`

## Global Constraints

- No framework, no bundler, no package manager: every script is a plain IIFE (`defer`) or a vendored ES module loaded by dynamic `import()`.
- Vendored three.js is pinned to `0.185.1`; the addon files must come from the same tarball and be copied unmodified.
- The import map must map the bare specifier `three` to exactly the URL the adapter already imports (`/assets/vendor/three/three.module.min.js`, no `?v=`), or two copies of three.js load and `instanceof` checks fail.
- Town-level coordinates only (at most four decimals); no new coordinates in this work.
- English copy lives in `index.html` under `data-i18n`; every key has a Bahasa Melayu entry in `assets/js/i18n.js` in Dewan Bahasa dan Pustaka register. Route-section keys use the `globe.*` namespace.
- Every colour the globe draws is read from the palette custom properties in `applyTheme()`; shader fallbacks are only for a missing property.
- `prefers-reduced-motion: reduce`, `saveData` and missing WebGL2 keep gating the globe off; the poster and plain list remain the fallback.
- Bump `?v=` in `index.html` only, once, at the end (Task 7): `2026-09-05a` → `2026-09-05b`.
- Green means `node --test "tests/*.test.js"` **and** all five `tools/` harnesses pass:
  ```bash
  node tools/test_jd_extractor.mjs
  node tools/test_jd_matcher.mjs
  node tools/test_recruiter_cloud_payload.mjs
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/verify_recruiter_profile.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/verify_recruiter_ui.ps1
  ```
- Commit after each task. Do not push; pushing `main` deploys the site.
- Work on a branch: `git checkout -b route-globe-horizon` before Task 1.

## File map

| File | Responsibility after this plan |
|---|---|
| `assets/js/route-globe-core.js` | Pure geometry, choreography, **framing** (`framing`, `limbInFrame`), **banking** (`bankAngle`, `resolvePose().bank`), **stars** (`starPositions`), `labelDir` in `parseStops` |
| `assets/js/route-globe.js` | Browser adapter: renderer, shader materials, Line2 route/arcs with thin-line fallback, markers, projected labels, caption rail, framing wiring |
| `assets/vendor/three/lines/*.js` | Five unmodified addon files from `three@0.185.1/examples/jsm/lines/` |
| `assets/vendor/README.md` | Pins and the import-map note |
| `index.html` | Import map, merged heading, anchors, rail wrapper, `data-label-dir`, `data-zoom`, `?v=` |
| `assets/js/i18n.js` | Merged `globe.*` copy, `journey.*` head keys removed |
| `assets/css/style.css` | Full-bleed stage, mask, rail, labels, hint, mobile caption, reduced motion |
| `tests/route-globe-core.test.js` | Core unit tests |
| `tests/route-globe-section.test.js` | Markup/CSS/vendor contract tests |
| `assets/img/route-globe-{dark,light}.jpg` | Re-captured posters |
| `docs/superpowers/specs/2026-07-24-portfolio-site-design.md`, `CLAUDE.md` | Registry paragraph and working notes |

---

### Task 1: Core framing invariant

**Files:**
- Modify: `assets/js/route-globe-core.js` (add two functions before `/* ---- layout ---- */`, export them)
- Test: `tests/route-globe-core.test.js`

**Interfaces:**
- Produces: `core.framing(distance, aspect, layout) → { fov, offsetX, offsetY }` — `fov` in degrees, offsets as fractions of the frame (positive `offsetX` shifts the globe right, positive `offsetY` shifts it down). `layout` is `"wide"` or `"narrow"`.
- Produces: `core.limbInFrame(distance, fovDeg, aspect, offsetX, offsetY, marginDeg) → boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/route-globe-core.test.js`:

```js
test('limbInFrame is the geometric predicate it claims to be', () => {
  // distance 3 → angular radius 19.5°; half-FOV horizontal at 38°/1.6 is 30.3°: visible
  assert.equal(core.limbInFrame(3, 38, 1.6, 0, 0, 0), true);
  // distance 1.1 → 65°: the sphere overflows every edge
  assert.equal(core.limbInFrame(1.1, 38, 1.6, 0, 0, 0), false);
  assert.equal(core.limbInFrame(1.1, 38, 1.6, 0.45, 0, 0), false);
  // a 12° margin turns the first case false (19.5 > 30.3 - 12)
  assert.equal(core.limbInFrame(3, 38, 1.6, 0, 0, 12), false);
  // shifting the globe right brings the left limb in
  assert.equal(core.limbInFrame(1.5, 38, 1.6, 0, 0, 0), false);
  assert.equal(core.limbInFrame(1.5, 38, 1.6, 0.3, 0, 0), true);
  assert.equal(core.limbInFrame(1, 38, 1.6, 0, 0, 0), false, 'on the surface there is no limb');
});

test('framing keeps the limb in frame for every distance and aspect, with a 2° margin', () => {
  for (let d = 1.5; d <= 3.2001; d += 0.05) {
    for (let a = 0.45; a <= 2.4001; a += 0.05) {
      for (const layout of ['wide', 'narrow']) {
        const f = core.framing(d, a, layout);
        assert.ok(f.fov >= 38 && f.fov <= 66, `fov in range at d=${d} a=${a}`);
        assert.ok(Math.abs(f.offsetX) <= 0.3 && Math.abs(f.offsetY) <= 0.2, 'offsets stay modest');
        assert.ok(
          core.limbInFrame(d, f.fov, a, f.offsetX, f.offsetY, 2),
          `limb visible at d=${d.toFixed(2)} aspect=${a.toFixed(2)} ${layout}`
        );
      }
    }
  }
  const close = core.framing(1.7, 1.6, 'wide'), far = core.framing(3, 1.6, 'wide');
  assert.ok(close.offsetX > far.offsetX, 'the offset relaxes as the camera pulls back');
  assert.ok(close.offsetX > 0.2 && close.offsetX <= 0.3);
  assert.equal(core.framing(2, 0.5, 'wide').offsetX, 0, 'portrait windows use the vertical strategy even in the wide layout');
  assert.ok(core.framing(2, 0.5, 'wide').offsetY < 0, 'portrait pushes the globe up so the caption sits below it');
  assert.equal(core.framing(2, 1.6, 'narrow').offsetX, 0, 'the narrow layout never shifts sideways');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/route-globe-core.test.js`
Expected: the two new tests FAIL with `core.limbInFrame is not a function`.

- [ ] **Step 3: Implement `limbInFrame` and `framing`**

In `assets/js/route-globe-core.js`, insert before `/* ---- layout ---- */`:

```js
  /* ---- framing: the limb must be in frame at every stop ---- */
  /* True when at least one edge of the sphere's silhouette lies inside the
     frame. The sphere subtends asin(1/distance); a view offset of a fraction
     of the frame moves the centre by atan(2 * offset * tan(halfFov)), so the
     near limb sits at (theta - offsetAngle) from the frame centre. marginDeg
     demands that much clearance from the frame edge. */
  function limbInFrame(distance, fovDeg, aspect, offsetX, offsetY, marginDeg) {
    if (!(distance > 1) || !(fovDeg > 0) || !(aspect > 0)) return false;
    var margin = (Number(marginDeg) || 0) * DEG;
    var theta = Math.asin(1 / distance);
    var halfV = fovDeg * DEG / 2;
    var halfH = Math.atan(Math.tan(halfV) * aspect);
    var ax = Math.atan(2 * Math.abs(Number(offsetX) || 0) * Math.tan(halfH));
    var ay = Math.atan(2 * Math.abs(Number(offsetY) || 0) * Math.tan(halfV));
    return theta - ax < halfH - margin || theta - ay < halfV - margin;
  }

  /* Wide (landscape) frames push the globe right so its left limb and
     atmosphere stay on screen beside the caption rail; the push relaxes as the
     camera pulls back so the final reveal shows the whole sphere. Narrow or
     portrait frames widen the FOV and lift the globe so the caption sits
     beneath it. Values are tuned so limbInFrame holds with a 2° margin for
     every distance in [1.5, 3.2] and aspect in [0.45, 2.4]. */
  function framing(distance, aspect, layout) {
    var a = aspect > 0 ? aspect : 1;
    if (layout === "narrow" || a < 1.05) return { fov: 66, offsetX: 0, offsetY: -0.16 };
    var t = clamp(1.7 - a, -0.7, 0.65);
    var relax = Math.pow(1.7 / Math.max(Number(distance) || 1.7, 1.7), 1.5);
    return {
      fov: clamp(38 + t * 22, 38, 60),
      offsetX: clamp(0.22 + t * 0.12, 0.14, 0.30) * relax,
      offsetY: 0.02
    };
  }
```

Add to the returned object (after `capDevicePixelRatio: capDevicePixelRatio,`):

```js
    limbInFrame: limbInFrame,
    framing: framing,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/route-globe-core.test.js`
Expected: all tests PASS, including the grid test (it evaluates about 2,700 cases; it should finish in well under a second).

- [ ] **Step 5: Commit**

```bash
git add assets/js/route-globe-core.js tests/route-globe-core.test.js
git commit -m "feat(globe): framing() and limbInFrame() keep the limb in frame at every stop"
```

---

### Task 2: Core banking, stars, label direction and zoom defaults

**Files:**
- Modify: `assets/js/route-globe-core.js` (`DEFAULT_ZOOM`, `parseStops`, `resolvePose`, new `bankAngle`, `starPositions`, exports)
- Test: `tests/route-globe-core.test.js`

**Interfaces:**
- Produces: `core.DEFAULT_ZOOM = { place: 1.7, remote: 1.7, region: 3.0 }`.
- Produces: `parseStops` accepts `item.labelDir` and emits `stop.labelDir` (`"n"|"ne"|"e"|"se"|"s"|"sw"|"w"|"nw"`, default `"e"`, warning on anything else).
- Produces: `core.bankAngle(travel, hopAngleRad, direction) → radians` (0 at both ends, up to 6° at mid-travel for hops ≥ 12°, 0 for hops under 2°, sign follows `direction`).
- Produces: `resolvePose(...)` return gains `bank` (radians).
- Produces: `core.starPositions(count, seed) → Float32Array(count*3)`, deterministic, radius 6–9.

- [ ] **Step 1: Write the failing tests**

Append to `tests/route-globe-core.test.js`:

```js
test('DEFAULT_ZOOM stops short of street level and pulls back to a full sphere', () => {
  assert.equal(core.DEFAULT_ZOOM.place, 1.7);
  assert.equal(core.DEFAULT_ZOOM.remote, 1.7);
  assert.equal(core.DEFAULT_ZOOM.region, 3.0);
});

test('parseStops reads the label direction, defaults to east and warns on nonsense', () => {
  const { stops, warnings } = core.parseStops([
    { lat: 3, lng: 101, kind: 'place', labelDir: 'ne' },
    { lat: 3, lng: 101, kind: 'place' },
    { lat: 3, lng: 101, kind: 'place', labelDir: 'up' },
    { lat: 1, lng: 103, kind: 'footprint', labelDir: 's' }
  ]);
  assert.equal(stops[0].labelDir, 'ne');
  assert.equal(stops[1].labelDir, 'e');
  assert.equal(stops[2].labelDir, 'e');
  assert.equal(stops[3].labelDir, 's', 'footprints carry a direction too');
  assert.deepEqual(warnings, ['stop 2: unknown label direction, using e']);
});

test('bankAngle rolls only on long hops, peaks mid-travel and follows the hop direction', () => {
  const DEG = Math.PI / 180;
  assert.equal(core.bankAngle(0, 20 * DEG, 1), 0);
  assert.equal(core.bankAngle(1, 20 * DEG, 1), 0);
  assert.ok(near(core.bankAngle(0.5, 20 * DEG, 1), 6 * DEG), 'full 6° from 12° hops upward');
  assert.ok(near(core.bankAngle(0.5, 20 * DEG, -1), -6 * DEG));
  assert.equal(core.bankAngle(0.5, 1 * DEG, 1), 0, 'the Klang Valley hops do not wobble');
  const partial = core.bankAngle(0.5, 7 * DEG, 1);
  assert.ok(partial > 0 && partial < 6 * DEG, 'ramps between 2° and 12°');
});

test('resolvePose carries the bank and rests level at both ends of a hop', () => {
  const kf = keyframes();
  const seg = 1 / (kf.length - 1);
  assert.equal(core.resolvePose(0, kf).bank, 0);
  assert.equal(core.resolvePose(seg * 0.5, kf).bank, 0, 'coincident Dungun stops (born → diploma): no hop, no bank');
  // stop 2 (kl) → stop 3 (ncs) is a 0.2° hop: level; stop 3 → stop 4 (sea) is ~9°: banked
  assert.equal(core.resolvePose(seg * 2.5, kf).bank, 0);
  assert.ok(Math.abs(core.resolvePose(seg * 3.5, kf).bank) > 0);
  assert.equal(core.resolvePose(1, kf).bank, 0);
});

test('starPositions is deterministic and keeps every star in the 6–9 shell', () => {
  const a = core.starPositions(50, 1992), b = core.starPositions(50, 1992), c = core.starPositions(50, 7);
  assert.equal(a.length, 150);
  assert.deepEqual(Array.from(a), Array.from(b));
  assert.notDeepEqual(Array.from(a), Array.from(c));
  for (let i = 0; i < a.length; i += 3) {
    const r = Math.hypot(a[i], a[i + 1], a[i + 2]);
    assert.ok(r >= 6 && r <= 9, `star ${i / 3} radius ${r}`);
  }
  assert.equal(core.starPositions(0, 1).length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/route-globe-core.test.js`
Expected: FAIL — `DEFAULT_ZOOM.place` is 1.1, `labelDir` undefined, `bankAngle`/`starPositions` not functions.

- [ ] **Step 3: Implement**

In `assets/js/route-globe-core.js`:

Replace the `DEFAULT_ZOOM` line and its comment with:

```js
  /* Camera distance from the globe centre (radius 1) per stop kind, unless the
     stop carries its own data-zoom. Towns stop at 1.7 so the limb stays in
     frame (see framing()); a region is a full-sphere pull-back, not a marker. */
  var DEFAULT_ZOOM = { place: 1.7, remote: 1.7, region: 3.0 };
  var LABEL_DIRS = { n: true, ne: true, e: true, se: true, s: true, sw: true, w: true, nw: true };
```

In `parseStops`, replace the `stops.push({ ... })` call with:

```js
      var labelDir = "e";
      if (item.labelDir != null) {
        if (LABEL_DIRS[item.labelDir]) labelDir = item.labelDir;
        else warnings.push("stop " + index + ": unknown label direction, using e");
      }
      stops.push({
        index: index, lat: lat, lng: lng, kind: kind, zoom: zoom, labelDir: labelDir,
        key: item.key == null ? String(index) : String(item.key)
      });
```

Add before `function resolvePose`:

```js
  /* Roll the camera on long flights so the hop reads as banking, not a pan.
     Zero below 2°, full 6° from 12°, sin-shaped so both ends rest level. */
  function bankAngle(travel, hopAngle, direction) {
    var hop = Number(hopAngle) || 0;
    if (!(hop > 2 * DEG)) return 0;
    var t = clamp(Number(travel) || 0, 0, 1);
    var strength = clamp((hop - 2 * DEG) / (10 * DEG), 0, 1);
    var sign = direction < 0 ? -1 : 1;
    return sign * 6 * DEG * strength * Math.sin(Math.PI * t);
  }
```

In `resolvePose`, replace the body from `var hop = ...` to the end of the function with:

```js
    var hopAngle = angleBetween(a.dir, b.dir);
    var hop = Math.min(hopAngle * 0.6, 0.35);
    var distance = a.distance + (b.distance - a.distance) * seg.travel + hop * Math.sin(Math.PI * seg.travel);
    var bank = seg.travel <= 0 || seg.travel >= 1 ? 0 : bankAngle(seg.travel, hopAngle, cross(a.dir, b.dir).y);
    return {
      activeIndex: seg.travel < 0.5 ? seg.from : seg.to,
      from: seg.from, to: seg.to, travel: seg.travel,
      direction: dir, distance: distance, position: scale(dir, distance), bank: bank
    };
```

Also add `bank: 0` to the empty-keyframes early return in `resolvePose`:

```js
      return { activeIndex: 0, from: 0, to: 0, travel: 0, direction: { x: 0, y: 0, z: 1 },
               distance: DEFAULT_ZOOM.region, position: { x: 0, y: 0, z: DEFAULT_ZOOM.region }, bank: 0 };
```

Add after `idleDriftOffset`:

```js
  /* A fixed starfield in a 6–9 shell around the globe, seeded so the sky is
     the same on every visit (mulberry32). Dark theme only; the adapter hides it
     on light. */
  function starPositions(count, seed) {
    var n = Math.max(0, count | 0);
    var s = ((seed | 0) >>> 0) || 1;
    function rand() {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    var out = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var z = rand() * 2 - 1, phi = rand() * Math.PI * 2, r = 6 + rand() * 3, c = Math.sqrt(1 - z * z);
      out[i * 3] = r * c * Math.cos(phi);
      out[i * 3 + 1] = r * z;
      out[i * 3 + 2] = r * c * Math.sin(phi);
    }
    return out;
  }
```

Export both (next to `idleDriftOffset: idleDriftOffset,`):

```js
    bankAngle: bankAngle,
    starPositions: starPositions,
```

- [ ] **Step 4: Run the whole suite**

Run: `node --test "tests/*.test.js"`
Expected: all PASS. (`route-globe-section.test.js` still passes: the markup's zooms are still ≤ 3 and the stops have no `data-label-dir` yet.)

- [ ] **Step 5: Commit**

```bash
git add assets/js/route-globe-core.js tests/route-globe-core.test.js
git commit -m "feat(globe): banking, seeded starfield, label directions and the 1.7 zoom floor in the core"
```

---

### Task 3: Vendor the Line2 addon and add the import map

**Files:**
- Create: `assets/vendor/three/lines/Line2.js`, `LineSegments2.js`, `LineGeometry.js`, `LineSegmentsGeometry.js`, `LineMaterial.js`
- Modify: `assets/vendor/README.md`
- Modify: `index.html` (`<head>`)
- Test: `tests/route-globe-section.test.js`

**Interfaces:**
- Produces: `import("/assets/vendor/three/lines/Line2.js")` etc. resolve at runtime; their `import ... from 'three'` resolves through the import map to `./assets/vendor/three/three.module.min.js`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/route-globe-section.test.js`:

```js
test('the Line2 addon is vendored beside three.js and pinned in the README', () => {
  const lines = path.join(root, 'assets', 'vendor', 'three', 'lines');
  for (const name of ['Line2', 'LineSegments2', 'LineGeometry', 'LineSegmentsGeometry', 'LineMaterial']) {
    const file = path.join(lines, `${name}.js`);
    assert.ok(fs.existsSync(file), `${name}.js is vendored`);
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(/from 'three'|from "three"|from '\.\/Line/.test(src), `${name}.js is the unmodified ESM addon`);
    assert.doesNotMatch(src, /from '\.\.\/three\.module/, `${name}.js keeps the bare "three" specifier (the import map resolves it)`);
  }
  const readme = fs.readFileSync(path.join(root, 'assets', 'vendor', 'README.md'), 'utf8');
  assert.match(readme, /three\/lines\//);
  assert.match(readme, /examples\/jsm\/lines/);
  assert.match(readme, /importmap/);
});

test('the import map maps "three" to the same file the adapter imports, before any script tag', () => {
  const map = html.match(/<script type="importmap">\s*(\{[\s\S]*?\})\s*<\/script>/);
  assert.ok(map, 'an inline import map is present');
  const parsed = JSON.parse(map[1]);
  assert.equal(parsed.imports.three, './assets/vendor/three/three.module.min.js');
  assert.ok(html.indexOf('<script type="importmap">') < html.indexOf('<script src='), 'the import map precedes every external script');
  assert.doesNotMatch(parsed.imports.three, /\?v=/, 'no cache tag: the adapter imports the bare path, and the two must be one module');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/route-globe-section.test.js`
Expected: FAIL — `Line2.js is vendored` and `an inline import map is present`.

- [ ] **Step 3: Vendor the addon files from the pinned tarball**

From the repo root, in a scratch directory (not inside the repo):

```bash
SCRATCH="$(mktemp -d)"
curl -sSL -o "$SCRATCH/three.tgz" https://registry.npmjs.org/three/-/three-0.185.1.tgz
mkdir -p "$SCRATCH/three" && tar -xzf "$SCRATCH/three.tgz" -C "$SCRATCH/three"
mkdir -p assets/vendor/three/lines
for f in Line2 LineSegments2 LineGeometry LineSegmentsGeometry LineMaterial; do
  cp "$SCRATCH/three/package/examples/jsm/lines/$f.js" assets/vendor/three/lines/
done
ls -la assets/vendor/three/lines
grep -l "from 'three'" assets/vendor/three/lines/*.js
```

Expected: five files, each ~2–25 KB; `LineMaterial.js`, `LineSegmentsGeometry.js` and `LineSegments2.js` contain `from 'three'`. If the tarball's sha512 is needed for the README, it is already recorded there from the r185 vendoring (`5aojFCXK…`).

- [ ] **Step 4: Record the files in the vendor README**

In `assets/vendor/README.md`, replace the paragraph starting `The addons (\`OrbitControls\` etc.) are deliberately not vendored;` with:

```markdown
  The fat-line addon is vendored alongside, unmodified, from the same tarball's
  `examples/jsm/lines/`:

  - `three/lines/Line2.js`, `three/lines/LineSegments2.js`, `three/lines/LineGeometry.js`,
    `three/lines/LineSegmentsGeometry.js`, `three/lines/LineMaterial.js`

  They import the bare specifier `three`, which `index.html` resolves with an inline
  `<script type="importmap">` to `./assets/vendor/three/three.module.min.js` — the exact
  URL `route-globe.js` imports itself, so only one copy of three.js ever loads. Do not
  add `?v=` to either side of that mapping. `OrbitControls` and the other addons are
  still deliberately not vendored; the globe's drag-to-orbit is a small additive offset
  in `route-globe-core.js`.
```

- [ ] **Step 5: Add the import map to `index.html`**

In `<head>`, immediately after the closing `</script>` of the inline theme/language script (the one that starts `document.documentElement.classList.replace('no-js', 'js');`), insert:

```html
  <script type="importmap">
    { "imports": { "three": "./assets/vendor/three/three.module.min.js" } }
  </script>
```

- [ ] **Step 6: Run the tests and the UI harness**

Run: `node --test "tests/*.test.js"`
Expected: PASS.

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/verify_recruiter_ui.ps1`
Expected: PASS (the import map has no `src`, so the `?v=` checks ignore it).

- [ ] **Step 7: Commit**

```bash
git add assets/vendor/three/lines assets/vendor/README.md index.html tests/route-globe-section.test.js
git commit -m "chore(globe): vendor three.js Line2 addon (0.185.1) and resolve 'three' with an import map"
```

---

### Task 4: Merged heading, anchors, rail wrapper and stop attributes

**Files:**
- Modify: `index.html` (skip link, nav, hero button, `#route` section head and stops, `#journey` main)
- Modify: `assets/js/i18n.js`
- Test: `tests/route-globe-section.test.js`

**Interfaces:**
- Produces: `<div class="route-rail" id="route-rail">` wrapping `<span class="route-rail-progress">` + `<ol id="route-stops">` — the adapter (Task 6) reads `route-rail` and `.route-rail-progress`.
- Produces: `data-label-dir` on stops, read by the adapter through `parseStops`.
- Produces: `<main class="section wrap journey-continued" id="journey">` with no `section-head`.

- [ ] **Step 1: Write the failing tests**

In `tests/route-globe-section.test.js`, change the first test's journey lookup:

```js
  const journey = html.indexOf('<main class="section wrap journey-continued" id="journey">');
```

Append:

```js
test('one heading introduces both the globe and the timeline', () => {
  assert.match(section, /<p class="eyebrow" data-i18n="globe\.eyebrow">The Journey · 1992 → Today<\/p>/);
  assert.match(section, /<h2 id="route-h2" data-i18n="globe\.h2">One small town, one line of travel — every stop <em>still running<\/em> somewhere\.<\/h2>/);
  assert.match(section, /data-i18n="globe\.p">Scroll to fly the route town by town/);
  assert.match(section, /marked <b>Retired<\/b>\./);
  const journey = html.slice(html.indexOf('<main class="section wrap journey-continued" id="journey">'));
  assert.doesNotMatch(journey.slice(0, 400), /section-head/, 'the timeline no longer repeats the heading');
  for (const key of ['journey.eyebrow', 'journey.h2', 'journey.p']) {
    assert.doesNotMatch(html, new RegExp(`data-i18n="${key.replace('.', '\\.')}"`), `${key} left the DOM`);
    assert.equal(I18N_MS[key], undefined, `${key} left i18n.js`);
  }
  assert.match(I18N_MS['globe.h2'], /<em>beroperasi<\/em>/);
  assert.match(I18N_MS['globe.p'], /<b>Dihentikan<\/b>/);
});

test('the journey anchors land on the merged section', () => {
  assert.match(html, /<a class="skip-link" href="#route"/);
  assert.match(html, /<a href="#route" data-i18n="nav\.journey">/);
  assert.match(html, /<a class="btn btn-ghost" href="#route" data-i18n="hero\.walk">/);
  assert.doesNotMatch(html, /href="#journey"/, 'nothing still jumps past the globe');
});

test('the caption rail wraps the stops list with its progress bar first', () => {
  assert.match(section, /<div class="route-rail" id="route-rail">\s*<span class="route-rail-progress" aria-hidden="true"><\/span>\s*<ol class="route-stops" id="route-stops">/);
  assert.match(section, /<\/ol>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/section>/);
});

test('stops carry valid label directions and the Klang Valley fans out', () => {
  const dirs = [...section.matchAll(/data-label-dir="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(dirs.length >= 6, 'the four places and three footprints are directed');
  for (const d of dirs) assert.match(d, /^(n|ne|e|se|s|sw|w|nw)$/);
  const kl = section.match(/data-lat="3\.1390"[^>]*data-label-dir="([^"]+)"/);
  const sa = section.match(/data-lat="3\.0733"[^>]*data-label-dir="([^"]+)"/);
  const pj = section.match(/data-lat="3\.1073"[^>]*data-label-dir="([^"]+)"/);
  assert.ok(kl && sa && pj, 'the first stop at each Klang Valley place is directed');
  assert.equal(new Set([kl[1], sa[1], pj[1]]).size, 3, 'three different directions');
});

test('zooms sit between the limb floor and the pull-back', () => {
  const zooms = [...section.matchAll(/data-zoom="([^"]+)"/g)].map((m) => Number(m[1]));
  assert.equal(zooms.length, 9);
  for (const z of zooms) assert.ok(z >= 1.5 && z <= 3.2, `zoom ${z} in [1.5, 3.2]`);
  assert.equal(zooms[zooms.length - 1], 3);
});
```

Also relax the existing zoom assertion in `'stops carry town-level coordinates…'` from `stop.zoom <= 3` to `stop.zoom <= 3.2`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/route-globe-section.test.js`
Expected: the five new tests FAIL and the first test fails on the journey lookup.

- [ ] **Step 3: Update `index.html`**

Anchors — three edits:

```html
  <a class="skip-link" href="#route" data-i18n="skip">Skip to the journey</a>
```
```html
        <a href="#route" data-i18n="nav.journey">Journey</a>
```
```html
          <a class="btn btn-ghost" href="#route" data-i18n="hero.walk">Walk the timeline ↓</a>
```

Section head of `#route`:

```html
    <div class="section-head reveal">
      <p class="eyebrow" data-i18n="globe.eyebrow">The Journey · 1992 → Today</p>
      <h2 id="route-h2" data-i18n="globe.h2">One small town, one line of travel — every stop <em>still running</em> somewhere.</h2>
      <p data-i18n="globe.p">Scroll to fly the route town by town — on a desktop, drag the globe to look around. Below it, every port of call is a real era with its live links; systems since decommissioned are honestly marked <b>Retired</b>.</p>
    </div>
```

Stage contents — replace from `<p class="route-hint"` through `</ol>` with (note the rail wrapper, the new zooms and the label directions):

```html
        <p class="route-hint" aria-hidden="true"><span data-i18n="globe.hint">Drag to orbit</span></p>

        <div class="route-rail" id="route-rail">
          <span class="route-rail-progress" aria-hidden="true"></span>
          <ol class="route-stops" id="route-stops">
            <li class="route-stop" data-lat="4.7667" data-lng="103.4167" data-kind="place" data-zoom="1.8" data-label-dir="ne">
              <span class="route-stop-year" data-i18n="globe.born.year">1992</span>
              <b class="route-stop-place" data-i18n="globe.born.place">Dungun, Terengganu</b>
              <span class="route-stop-desc" data-i18n="globe.born.desc">Born here. Kindergarten to secondary school, all in one small east-coast town.</span>
            </li>
            <li class="route-stop" data-lat="4.7667" data-lng="103.4167" data-kind="place" data-zoom="1.75">
              <span class="route-stop-year" data-i18n="globe.school.year">→ 2009</span>
              <b class="route-stop-place" data-i18n="globe.school.place">SMK Balai Besar, Dungun</b>
              <span class="route-stop-desc" data-i18n="globe.school.desc">Secondary school. SPM 2009 — Pure Sciences, with an A+ in Mathematics.</span>
            </li>
            <li class="route-stop" data-lat="4.7667" data-lng="103.4167" data-kind="place" data-zoom="1.7">
              <span class="route-stop-year" data-i18n="globe.diploma.year">2010 — 2013</span>
              <b class="route-stop-place" data-i18n="globe.diploma.place">UiTM Dungun</b>
              <span class="route-stop-desc" data-i18n="globe.diploma.desc">Diploma in Computer Science. First real application: a bus ticketing system in PHP.</span>
            </li>
            <li class="route-stop" data-lat="3.1390" data-lng="101.6869" data-kind="place" data-zoom="1.65" data-label-dir="ne">
              <span class="route-stop-year" data-i18n="globe.myemro.year">2013 — 2014</span>
              <b class="route-stop-place" data-i18n="globe.myemro.place">Kuala Lumpur</b>
              <span class="route-stop-desc" data-i18n="globe.myemro.desc">First job at MyEMRO — aircraft maintenance scheduling in Ruby on Rails.</span>
            </li>
            <li class="route-stop" data-lat="3.0733" data-lng="101.5185" data-kind="place" data-zoom="1.65" data-label-dir="w">
              <span class="route-stop-year" data-i18n="globe.degree.year">2013 — 2016</span>
              <b class="route-stop-place" data-i18n="globe.degree.place">Shah Alam</b>
              <span class="route-stop-desc" data-i18n="globe.degree.desc">B.IT (Hons.) Intelligent Systems Engineering at UiTM, studied while already working.</span>
            </li>
            <li class="route-stop" data-lat="3.1073" data-lng="101.6067" data-kind="place" data-zoom="1.65" data-label-dir="se">
              <span class="route-stop-year" data-i18n="globe.trm.year">2015 — 2023</span>
              <b class="route-stop-place" data-i18n="globe.trm.place">Petaling Jaya</b>
              <span class="route-stop-desc" data-i18n="globe.trm.desc">Eight years at TRM Nett Systems — 15+ systems for the nation's agencies, ports and customs.</span>
            </li>
            <li class="route-stop" data-lat="3.0733" data-lng="101.5185" data-kind="remote" data-zoom="1.65">
              <span class="route-stop-year" data-i18n="globe.ncs.year">Feb — Aug 2023</span>
              <b class="route-stop-place" data-i18n="globe.ncs.place">Shah Alam · remote</b>
              <span class="route-stop-desc" data-i18n="globe.ncs.desc">Remote contract for NCS — Motorola Solutions' public-safety Android platform, delivered from Shah Alam.</span>
            </li>
            <li class="route-stop" data-lat="3.1390" data-lng="101.6869" data-kind="place" data-zoom="1.65">
              <span class="route-stop-year" data-i18n="globe.retailaim.year">Aug 2023 — Present</span>
              <b class="route-stop-place" data-i18n="globe.retailaim.place">Kuala Lumpur</b>
              <span class="route-stop-desc" data-i18n="globe.retailaim.desc">RetailAIM Malaysia — sole developer of RetailAIM® Plus, now Full Stack Web Specialist.</span>
            </li>
            <li class="route-stop" data-lat="7.5" data-lng="109.5" data-kind="region" data-zoom="3">
              <span class="route-stop-year" data-i18n="globe.sea.year">Today</span>
              <b class="route-stop-place" data-i18n="globe.sea.place">Southeast Asia</b>
              <span class="route-stop-desc" data-i18n="globe.sea.desc">RetailAIM® Plus runs live for 20+ FMCG brands across four countries.</span>
              <ul class="route-arcs">
                <li data-lat="1.3521" data-lng="103.8198" data-kind="footprint" data-label-dir="s" data-i18n="globe.sea.sg">Singapore</li>
                <li data-lat="13.7563" data-lng="100.5018" data-kind="footprint" data-label-dir="n" data-i18n="globe.sea.th">Bangkok, Thailand</li>
                <li data-lat="14.5995" data-lng="120.9842" data-kind="footprint" data-label-dir="e" data-i18n="globe.sea.ph">Manila, Philippines</li>
              </ul>
            </li>
          </ol>
        </div>
```

`#journey` — replace the opening tag and remove its section head:

```html
  <main class="section wrap journey-continued" id="journey">
    <div class="timeline" id="timeline">
```

(The three lines `<div class="section-head reveal">` … `</div>` that held `journey.eyebrow`, `journey.h2`, `journey.p` are deleted.)

Note: the HTML comment above the section (`<!-- Stops are the data: … -->`) still describes the attributes; append a line to it: `Each stop may carry data-label-dir (n|ne|e|se|s|sw|w|nw) for its projected label.`

- [ ] **Step 4: Update `assets/js/i18n.js`**

Replace the three `globe.eyebrow`/`globe.h2`/`globe.p` lines with:

```js
  "globe.eyebrow": "Perjalanan · 1992 → Kini",
  "globe.h2": "Satu pekan kecil, satu garis perjalanan — setiap hentian masih <em>beroperasi</em> di suatu tempat.",
  "globe.p": "Tatal untuk menyusuri laluan dari satu pekan ke pekan seterusnya — pada desktop, seret glob untuk melihat sekeliling. Di bawahnya, setiap persinggahan ialah era sebenar dengan pautan langsungnya; sistem yang telah ditamatkan operasinya ditanda secara jujur sebagai <b>Dihentikan</b>.",
```

Delete the three lines `"journey.eyebrow": …`, `"journey.h2": …`, `"journey.p": …` (and the blank line that separated them from `globe.*`, if that leaves two blank lines).

- [ ] **Step 5: Run the whole suite and the harnesses**

Run: `node --test "tests/*.test.js"`
Expected: PASS.

Run the five `tools/` harnesses (see Global Constraints).
Expected: all PASS. `verify_recruiter_ui.ps1` checks recruiter copy, not the journey head.

- [ ] **Step 6: Check the fallback in a browser**

```bash
python -m http.server 8080
```

Open `http://localhost:8080/#route` with DevTools → Rendering → "Emulate CSS prefers-reduced-motion: reduce" enabled, reload. Expected: one heading, the poster, the plain stops grid, then the timeline immediately below with no second heading. `document.getElementById('route').dataset.globe` reads `reduced-motion`.

- [ ] **Step 7: Commit**

```bash
git add index.html assets/js/i18n.js tests/route-globe-section.test.js
git commit -m "feat(globe): one heading for route and timeline, caption rail wrapper, label directions and limb-safe zooms"
```

---

### Task 5: Full-bleed stage, rail, labels and mobile CSS

**Files:**
- Modify: `assets/css/style.css` (replace the `/* ---------- route globe ---------- */` block; add `.journey-continued`; extend the reduced-motion block)
- Test: `tests/route-globe-section.test.js`

**Interfaces:**
- Consumes: markup from Task 4 (`.route-rail`, `.route-rail-progress`).
- Produces: classes the adapter (Task 6) toggles or creates: `.route-globe.is-live`, `.route-stop.is-active`, `.route-labels`, `.route-label`, `.route-label.dir-{n,ne,e,se,s,sw,w,nw}`, `.route-label.is-active`, `.route-fade` (applied to the canvas in markup via the adapter), `.route-rail-progress` height/top set inline by JS.

- [ ] **Step 1: Write the failing tests**

Append to `tests/route-globe-section.test.js`:

```js
test('the live stage is full-bleed, borderless and fades into the page', () => {
  assert.match(css, /\.route-track \{[^}]*width: 100vw;[^}]*margin-left: calc\(50% - 50vw\)/);
  const live = css.match(/\.route-globe\.is-live \.route-stage \{([^}]*)\}/);
  assert.ok(live, 'live stage rule exists');
  assert.match(live[1], /position: sticky/);
  assert.match(live[1], /top: 0/);
  assert.match(live[1], /height: 100dvh/);
  assert.doesNotMatch(live[1], /border|box-shadow|border-radius|background/);
  assert.match(css, /\.route-fade \{[^}]*mask-image: linear-gradient\(to bottom, transparent, #000 10%, #000 90%, transparent\)/);
  assert.match(css, /\.journey-continued \{ padding-top: 24px; \}/);
});

test('the rail and labels are styled and frozen under reduced motion', () => {
  assert.match(css, /\.route-globe\.is-live \.route-stop::before \{[^}]*border-radius: 50%/);
  assert.match(css, /\.route-globe\.is-live \.route-stop\.is-active::before \{[^}]*border-color: var\(--teal\)/);
  assert.match(css, /\.route-rail-progress \{[^}]*linear-gradient\(180deg, var\(--teal-deep\), var\(--teal\)\)/);
  for (const dir of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    assert.match(css, new RegExp(`\\.route-label\\.dir-${dir}::before`), `leader line for ${dir}`);
  }
  const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/);
  assert.match(block[1], /\.route-label, \.route-rail-progress \{ transition: none; \}/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/route-globe-section.test.js`
Expected: the two new tests FAIL.

- [ ] **Step 3: Replace the route globe CSS block**

In `assets/css/style.css`, replace everything from the line `/* ---------- route globe ---------- */` (there are two identical comment lines; replace from the first) up to, but not including, `/* ---------- section headers ---------- */` with:

```css
/* ---------- route globe ---------- */
/* Static by default: a full-width poster and a plain list of stops. route-globe.js
   adds .is-live once three.js is drawing, which turns the stage into a full-bleed
   sticky scrollytelling panel, the list into a caption rail on the timeline's
   spine line, and appends the projected place labels. The stage has no box of its
   own: the canvas clears to transparent and fades into the page atmosphere. */
.route-globe { padding-bottom: 0; }
.route-track { position: relative; width: 100vw; margin-left: calc(50% - 50vw); }
.route-stage { position: relative; }
.route-canvas { display: none; width: 100%; height: 100%; touch-action: pan-y; }
.route-fade {
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 10%, #000 90%, transparent);
  mask-image: linear-gradient(to bottom, transparent, #000 10%, #000 90%, transparent);
}
.route-poster {
  width: 100%; height: auto; aspect-ratio: 16 / 9; object-fit: cover;
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 10%, #000 90%, transparent);
  mask-image: linear-gradient(to bottom, transparent, #000 10%, #000 90%, transparent);
}
.route-poster-light { display: none; }
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) .route-poster-dark { display: none; }
  :root:not([data-theme="dark"]) .route-poster-light { display: block; }
}
:root[data-theme="light"] .route-poster-dark { display: none; }
:root[data-theme="light"] .route-poster-light { display: block; }
:root[data-theme="dark"] .route-poster-dark { display: block; }
:root[data-theme="dark"] .route-poster-light { display: none; }
.route-hint { display: none; }

.route-rail { max-width: 1100px; margin: 26px auto 0; padding: 0 28px; }
.route-rail-progress { display: none; }
.route-stops {
  list-style: none;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px;
}
.route-stop {
  background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
  padding: 18px 20px; font-size: 0.92rem; color: var(--muted);
}
.route-stop-year {
  display: block; font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.2em;
  color: var(--teal); text-transform: uppercase;
}
.route-stop-place {
  display: block; font-family: var(--display); font-weight: 600; font-size: 1.15rem;
  color: var(--paper); margin: 6px 0 6px; line-height: 1.2;
}
.route-stop-desc { display: block; }
.route-arcs { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.route-arcs li {
  font-family: var(--mono); font-size: 0.66rem; letter-spacing: 0.08em;
  color: var(--teal); border: 1px solid var(--teal-deep); border-radius: 999px; padding: 3px 9px;
}

/* live mode: the stage */
.route-globe.is-live .route-stage {
  position: sticky; top: 0; height: 100vh; height: 100dvh; z-index: 1; overflow: hidden;
}
.route-globe.is-live .route-canvas { display: block; position: absolute; inset: 0; }
.route-globe.is-live .route-poster { display: none; }
.route-globe.is-live .route-hint {
  position: absolute; right: 28px; bottom: 22px; margin: 0;
  font-family: var(--mono); font-size: 0.64rem; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--muted); opacity: 0.85; transition: opacity 0.4s;
}
.route-globe.is-live.has-dragged .route-hint { opacity: 0; }
@media (hover: hover) and (pointer: fine) {
  .route-globe.is-live .route-hint { display: block; }
  .route-globe.is-live .route-canvas { cursor: grab; }
  .route-globe.is-live.is-dragging .route-canvas { cursor: grabbing; }
}

/* live mode: the caption rail on the spine line */
.route-globe.is-live .route-rail {
  position: absolute; top: 50%; transform: translateY(-50%);
  left: max(28px, calc(50% - 550px + 28px)); width: min(400px, 42vw); max-width: none;
  max-height: calc(100vh - 140px); margin: 0; padding: 0 0 0 calc(var(--spine-x) + 30px);
  overflow: hidden; pointer-events: none;
}
.route-globe.is-live .route-rail::before {
  content: ""; position: absolute; top: 22px; bottom: 22px; left: var(--spine-x);
  width: 2px; background: var(--line);
}
.route-globe.is-live .route-rail-progress {
  display: block; position: absolute; left: var(--spine-x); top: 22px; width: 2px; height: 0;
  background: linear-gradient(180deg, var(--teal-deep), var(--teal));
  box-shadow: 0 0 12px rgba(var(--teal-rgb), 0.55); z-index: 1;
  transition: height 0.35s ease;
}
.route-globe.is-live .route-stops { display: block; }
.route-globe.is-live .route-stop {
  position: relative; background: none; border: none; border-radius: 0;
  padding: 10px 0 12px; font-size: 0.9rem;
  opacity: 0.42; transition: opacity 0.35s ease;
}
.route-globe.is-live .route-stop::before {
  content: ""; position: absolute; left: -38px; top: 14px; z-index: 2;
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--ink); border: 2px solid var(--line);
  transition: border-color 0.5s, box-shadow 0.5s;
}
.route-globe.is-live .route-stop.is-active { opacity: 1; }
.route-globe.is-live .route-stop.is-active::before {
  border-color: var(--teal);
  box-shadow: 0 0 0 5px rgba(var(--teal-rgb), 0.14), 0 0 16px rgba(var(--teal-rgb), 0.6);
}
.route-globe.is-live .route-stop-place { font-size: 1.05rem; margin: 4px 0 0; }
.route-globe.is-live .route-stop-desc,
.route-globe.is-live .route-arcs {
  max-height: 0; overflow: hidden; margin-top: 0;
  transition: max-height 0.4s ease, margin-top 0.4s ease;
}
.route-globe.is-live .route-stop.is-active .route-stop-desc { max-height: 8em; margin-top: 6px; }
.route-globe.is-live .route-stop.is-active .route-arcs { max-height: 4em; margin-top: 10px; }

/* live mode: projected place labels */
.route-labels { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.route-label {
  position: absolute; left: 0; top: 0; margin: 0; white-space: nowrap; will-change: transform;
  font-family: var(--mono); font-size: 0.66rem; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--muted); opacity: 0.7; transition: opacity 0.3s, color 0.3s;
}
.route-label.is-active { color: var(--paper); opacity: 1; }
.route-label[hidden] { display: none; }
.route-label::before { content: ""; position: absolute; background: currentColor; opacity: 0.55; }
.route-label.dir-e::before  { right: 100%; top: 50%; width: 12px; height: 1px; margin-right: 4px; }
.route-label.dir-w::before  { left: 100%; top: 50%; width: 12px; height: 1px; margin-left: 4px; }
.route-label.dir-n::before  { left: 50%; top: 100%; width: 1px; height: 12px; margin-top: 4px; }
.route-label.dir-s::before  { left: 50%; bottom: 100%; width: 1px; height: 12px; margin-bottom: 4px; }
.route-label.dir-ne::before { right: 100%; top: 100%; width: 12px; height: 1px; transform: rotate(-45deg); transform-origin: right center; }
.route-label.dir-nw::before { left: 100%; top: 100%; width: 12px; height: 1px; transform: rotate(45deg); transform-origin: left center; }
.route-label.dir-se::before { right: 100%; bottom: 100%; width: 12px; height: 1px; transform: rotate(45deg); transform-origin: right center; }
.route-label.dir-sw::before { left: 100%; bottom: 100%; width: 12px; height: 1px; transform: rotate(-45deg); transform-origin: left center; }

/* the timeline continues straight under the stage */
.journey-continued { padding-top: 24px; }

@media (max-width: 899px) {
  .route-globe.is-live .route-stage { height: min(100vh, 720px); height: min(100dvh, 720px); }
  .route-globe.is-live .route-rail {
    top: auto; bottom: 16px; left: 12px; right: 12px; width: auto; transform: none;
    max-height: none; padding: 0; overflow: visible;
  }
  .route-globe.is-live .route-rail::before,
  .route-globe.is-live .route-rail-progress { display: none; }
  .route-globe.is-live .route-stops { position: relative; min-height: 8.5em; }
  .route-globe.is-live .route-stop {
    position: absolute; left: 0; right: 0; bottom: 0;
    padding: 14px 16px; font-size: 0.86rem;
    background: rgba(var(--teal-rgb), 0.06); backdrop-filter: blur(6px);
    border: 1px solid var(--line); border-radius: 14px;
    opacity: 0; transform: translateY(8px);
    transition: opacity 0.35s ease, transform 0.35s ease;
  }
  .route-globe.is-live .route-stop::before { display: none; }
  .route-globe.is-live .route-stop.is-active { opacity: 1; transform: none; }
  .route-globe.is-live .route-stop-desc,
  .route-globe.is-live .route-arcs { max-height: none; overflow: visible; }
  .route-globe.is-live .route-stop-desc { margin-top: 6px; }
  .route-globe.is-live .route-arcs { margin-top: 10px; }
  .route-label { font-size: 0.6rem; }
}

```

- [ ] **Step 4: Extend the reduced-motion block**

In the `@media (prefers-reduced-motion: reduce)` block, replace `.route-stop { transition: none; transform: none; }` with:

```css
  .route-stop { transition: none; transform: none; }
  .route-label, .route-rail-progress { transition: none; }
```

- [ ] **Step 5: Run the tests**

Run: `node --test "tests/*.test.js"`
Expected: PASS.

- [ ] **Step 6: Check the static layout in a browser**

With `python -m http.server 8080` running, open `http://localhost:8080/#route` with reduced motion emulated (the live adapter is rewritten in Task 6; until then the old adapter still runs against the new CSS, so use the reduced-motion fallback to judge the static layout). Expected at 1440 and 375 widths: the poster spans the full viewport width with faded top/bottom edges; the stops grid is centred within the 1100px column; the timeline starts right under it.

- [ ] **Step 7: Commit**

```bash
git add assets/css/style.css tests/route-globe-section.test.js
git commit -m "style(globe): full-bleed stage, caption rail on the spine line, projected labels, mobile caption"
```

---

### Task 6: Rewrite the adapter

**Files:**
- Rewrite: `assets/js/route-globe.js` (whole file)
- Test: manual, in the browser (no DOM/WebGL in `node --test`); the section test from Task 3 already pins the addon/import-map contract this file relies on.

**Interfaces:**
- Consumes: `core.framing`, `core.limbInFrame` (Task 1); `core.bankAngle`, `resolvePose().bank`, `core.starPositions`, `stop.labelDir`, `DEFAULT_ZOOM` (Task 2); the five addon modules and the import map (Task 3); `#route-rail`, `.route-rail-progress`, `data-label-dir` (Task 4); every class in Task 5.
- Produces: `section.dataset.globe` ∈ `live | live-thin | loading | error | <gate reason>`; `.route-fade` on the canvas; `.route-labels` container with `.route-label` children; inline `top`/`height` on `.route-rail-progress`; the `--route-gutter` custom property on `<html>` (vertical scrollbar width, consumed by `.route-track` in Task 5's CSS).

- [ ] **Step 1: Replace the file**

Write `assets/js/route-globe.js` with exactly this content:

```js
/* Route globe — the DOM/WebGL adapter. Reads the stops list, decides whether
   this device may render, lazily imports the vendored three.js (and its Line2
   addon for fat lines) when the section approaches, then scrubs the camera with
   scroll. Every geometry, framing and choreography decision comes from
   route-globe-core.js; this file only owns browser objects: the renderer, the
   shader materials, the projected DOM labels and the caption rail. Off the
   happy path (reduced motion, no WebGL2, save-data, load failure, lost
   context) the section stays the poster + list it renders without JS, and the
   reason is written to section.dataset.globe. If only the Line2 addon fails,
   the globe still renders with 1px lines and reports "live-thin". */
(function () {
  "use strict";

  var core = window.ROUTE_GLOBE_CORE;
  var section = document.getElementById("route");
  var track = document.getElementById("route-track");
  var stage = document.getElementById("route-stage");
  var canvas = document.getElementById("route-canvas");
  var rail = document.getElementById("route-rail");
  var list = document.getElementById("route-stops");
  if (!core || !section || !track || !stage || !canvas || !rail || !list) return;

  var SEGMENT_SCROLL_SHARE = 0.42; /* viewport heights of scroll per stop-to-stop hop */
  var DPR_MAX = 1.75;              /* the stage is full-bleed now; 2 was fill-rate hungry */
  var IDLE_FRAME_MS = 32;          /* the breathing sway, pulses and the travelling light run at ~30 fps */
  var NARROW_MAX_WIDTH = 899;      /* matches the CSS breakpoint for the caption layout */
  var STAR_COUNT = 600;
  var STAR_SEED = 1992;
  var PULSE_MS = 1800;             /* active-marker ring period */
  var TRAVEL_MS = 2600;            /* one lap of the light along the drawn route */
  var MARKER_SCALE = 3.6;          /* plane half-size per unit of core.markerRadius() */
  var RAIL_NODE_Y = 22;            /* node centre below the li top: 14px top + 8px radius (style.css) */
  var THREE_URL = "../vendor/three/three.module.min.js";
  var LINES_DIR = "../vendor/three/lines/";
  var LINE_MODULES = ["Line2", "LineSegments2", "LineGeometry", "LineSegmentsGeometry", "LineMaterial"];
  var DATA_URL = "../data/route-globe-coastlines.json";
  var LIGHT_DIR = { x: -0.6, y: 0.7, z: 0.5 }; /* view space: upper-left, like the CSS atmosphere */
  /* dx, dy, anchor translate — mirrors .route-label.dir-* leader lines in style.css */
  var LABEL_OFFSETS = {
    e: [18, 0, "0, -50%"], w: [-18, 0, "-100%, -50%"], n: [0, -18, "-50%, -100%"], s: [0, 18, "-50%, 0"],
    ne: [14, -14, "0, -100%"], nw: [-14, -14, "-100%, -100%"], se: [14, 14, "0, 0"], sw: [-14, 14, "-100%, 0"]
  };

  var root = document.documentElement;
  var state = "idle";

  function warn(where, reason) {
    if (window.console && console.warn) console.warn("[route-globe] " + where + ": " + reason);
  }
  function transition(event) { state = core.nextState(state, event); return state; }

  /* 100vw includes the vertical scrollbar; publish its width so the CSS
     full-bleed track can subtract it (see .route-track in style.css). This
     runs before the gate so the poster fallback is exact too. */
  function publishGutter() {
    root.style.setProperty("--route-gutter", Math.max(0, window.innerWidth - root.clientWidth) + "px");
  }
  publishGutter();
  window.addEventListener("resize", publishGutter);

  /* Same cache-busting discipline as chatbot.js: forward our own ?v= to the
     coastline fetch. The vendored three.js and its addon are pinned by path
     instead — and the import map resolves the addon's bare "three" to the very
     same URL imported here, so exactly one copy of three.js loads. */
  var currentScript = document.currentScript;
  var scriptSrc = currentScript && currentScript.src;
  var versionMatch = scriptSrc ? String(scriptSrc).match(/[?&]v=([^&#]+)/) : null;
  var ASSET_VERSION_QUERY = versionMatch ? "?v=" + versionMatch[1] : "";
  var BASE = scriptSrc ? new URL(".", scriptSrc).href : new URL("assets/js/", location.href).href;
  function assetUrl(relative, versioned) {
    return new URL(relative, BASE).href + (versioned ? ASSET_VERSION_QUERY : "");
  }

  /* ---- stops: the <ol> is the data source and the caption rail ---- */
  var items = Array.prototype.slice.call(list.querySelectorAll("li[data-lat]"));
  var parsed = core.parseStops(items.map(function (li) {
    return {
      lat: li.getAttribute("data-lat"), lng: li.getAttribute("data-lng"),
      kind: li.getAttribute("data-kind"), zoom: li.getAttribute("data-zoom"),
      labelDir: li.getAttribute("data-label-dir") || undefined,
      key: li.getAttribute("data-i18n") || undefined
    };
  }));
  var timeline = core.buildTimeline(parsed.stops);
  parsed.warnings.concat(timeline.warnings).forEach(function (w) { warn("stops", w); });
  var keyframes = core.buildCameraKeyframes(timeline.keyframable);
  var keyframeEls = timeline.keyframable.map(function (stop) { return items[stop.index]; });
  var keyframeStops = timeline.keyframable;
  if (keyframes.length < 2) { section.dataset.globe = "too-few-stops"; return; }

  /* ---- gate ---- */
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var saveData = !!(navigator.connection && navigator.connection.saveData);
  function probeWebGL2() {
    try {
      var probe = document.createElement("canvas");
      return !!(window.WebGL2RenderingContext && probe.getContext("webgl2"));
    } catch (e) { return false; }
  }
  function gate(withProbe) {
    return core.evaluateGate({
      reducedMotion: reduced,
      saveData: saveData,
      hasWebGL2: withProbe ? probeWebGL2() : true,
      hasIntersectionObserver: "IntersectionObserver" in window
    });
  }
  var early = gate(false);
  if (!early.eligible) { transition("gate-fail"); section.dataset.globe = early.reason; return; }

  /* Load only when the visitor is heading this way. */
  var approach = new IntersectionObserver(function (entries) {
    if (!entries.some(function (e) { return e.isIntersecting; })) return;
    approach.disconnect();
    start();
  }, { rootMargin: "600px 0px" });
  approach.observe(section);

  /* The addon is optional: a failure here degrades to 1px lines, never to the poster. */
  function loadLines() {
    return Promise.all(LINE_MODULES.map(function (name) {
      return import(assetUrl(LINES_DIR + name + ".js", false));
    })).then(function (mods) {
      var out = {};
      LINE_MODULES.forEach(function (name, i) { out[name] = mods[i][name]; });
      return out;
    }, function (err) {
      warn("lines", err && err.message ? err.message : String(err));
      return null;
    });
  }

  function start() {
    var full = gate(true);
    if (!full.eligible) { transition("gate-fail"); section.dataset.globe = full.reason; return; }
    transition("enter-viewport");
    section.dataset.globe = "loading";
    Promise.all([
      import(assetUrl(THREE_URL, false)),
      fetch(assetUrl(DATA_URL, true)).then(function (res) {
        if (!res.ok) throw new Error("coastlines HTTP " + res.status);
        return res.json();
      }),
      loadLines()
    ]).then(function (loaded) {
      build(loaded[0], loaded[1], loaded[2]);
    }, function (err) {
      transition("load-fail");
      section.dataset.globe = "error";
      warn("load", err && err.message ? err.message : String(err));
    });
  }

  /* ---- shaders ---- */
  var SURFACE_VERTEX = [
    "varying vec3 vNormal; varying vec3 vView; varying vec3 vPos;",
    "void main() {",
    "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
    "  vNormal = normalize(normalMatrix * normal);",
    "  vView = normalize(-mv.xyz);",
    "  vPos = position;",
    "  gl_Position = projectionMatrix * mv;",
    "}"
  ].join("\n");
  /* Hemisphere-lit surface whose shadow side falls into the page background,
     a little value noise so the ocean is not a flat fill, and a fresnel rim. */
  var SURFACE_FRAGMENT = [
    "uniform vec3 base; uniform vec3 shadow; uniform vec3 rim; uniform vec3 lightDir;",
    "uniform float strength; uniform float noiseAmp;",
    "varying vec3 vNormal; varying vec3 vView; varying vec3 vPos;",
    "float hash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }",
    "float vnoise(vec3 x) {",
    "  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),",
    "             mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);",
    "}",
    "void main() {",
    "  float wrap = 0.35;",
    "  float lit = clamp((dot(vNormal, lightDir) + wrap) / (1.0 + wrap), 0.0, 1.0);",
    "  lit = lit * lit * (3.0 - 2.0 * lit);",
    "  float n = vnoise(vPos * 9.0) * 2.0 - 1.0;",
    "  vec3 col = mix(shadow, base, lit) * (1.0 + noiseAmp * n);",
    "  float f = pow(1.0 - max(dot(vNormal, vView), 0.0), 3.0);",
    "  gl_FragColor = vec4(mix(col, rim, f * strength), 1.0);",
    "  #include <colorspace_fragment>",
    "}"
  ].join("\n");
  var ATMO_VERTEX = [
    "varying vec3 vNormal; varying vec3 vView;",
    "void main() {",
    "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
    "  vNormal = normalize(normalMatrix * normal);",
    "  vView = normalize(-mv.xyz);",
    "  gl_Position = projectionMatrix * mv;",
    "}"
  ].join("\n");
  /* Back faces of a slightly larger sphere: the outward normal faces away from
     the camera, so -dot runs 0 at the outer edge to ~0.45 at the globe's limb. */
  var ATMO_FRAGMENT = [
    "uniform vec3 glow; uniform float peak;",
    "varying vec3 vNormal; varying vec3 vView;",
    "void main() {",
    "  float f = smoothstep(0.0, 0.45, -dot(vNormal, vView));",
    "  gl_FragColor = vec4(glow, f * f * peak);",
    "  #include <colorspace_fragment>",
    "}"
  ].join("\n");
  /* Line vertices fade as they turn away from the camera, so the far side and
     the crowded limb dissolve instead of reading as a flat outline. */
  var FADE_VERTEX = [
    "varying float vFade;",
    "void main() {",
    "  vec4 wp = modelMatrix * vec4(position, 1.0);",
    "  vec3 toCam = normalize(cameraPosition - wp.xyz);",
    "  vFade = smoothstep(-0.15, 0.30, dot(normalize(position), toCam));",
    "  gl_Position = projectionMatrix * viewMatrix * wp;",
    "}"
  ].join("\n");
  var FADE_FRAGMENT = [
    "uniform vec3 color; uniform float opacity; varying float vFade;",
    "void main() {",
    "  gl_FragColor = vec4(color, opacity * vFade);",
    "  #include <colorspace_fragment>",
    "}"
  ].join("\n");
  /* A soft dot, an expanding pulse ring while active, and a static halo for
     remote stops — one quad per marker, additive on dark. */
  var MARKER_VERTEX = [
    "varying vec2 vUv;",
    "void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }"
  ].join("\n");
  var MARKER_FRAGMENT = [
    "uniform vec3 color; uniform float opacity; uniform float pulse; uniform float halo;",
    "varying vec2 vUv;",
    "void main() {",
    "  float r = length(vUv);",
    "  float dotR = 0.28;",
    "  float a = 1.0 - smoothstep(dotR * 0.75, dotR, r);",
    "  float ring = 0.0;",
    "  if (pulse >= 0.0) {",
    "    float pr = mix(dotR * 1.5, 0.98, pulse);",
    "    ring = (1.0 - smoothstep(0.0, 0.05, abs(r - pr))) * (1.0 - pulse) * 0.8;",
    "  }",
    "  ring += halo * (1.0 - smoothstep(0.0, 0.035, abs(r - 0.7))) * 0.5;",
    "  a = max(a, ring);",
    "  if (a < 0.01) discard;",
    "  gl_FragColor = vec4(color, a * opacity);",
    "  #include <colorspace_fragment>",
    "}"
  ].join("\n");

  function build(THREE, data, LINES) {
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: "low-power" });
    } catch (e) {
      transition("load-fail"); section.dataset.globe = "error"; warn("renderer", e && e.message); return;
    }
    renderer.setClearColor(0x000000, 0);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(38, 1, 0.01, 40);
    var globe = new THREE.Group();
    scene.add(globe);

    function tint(color, rgb) { color.setRGB(rgb.r, rgb.g, rgb.b, THREE.SRGBColorSpace); }

    /* ---- surface + atmosphere ---- */
    var sphereMat = new THREE.ShaderMaterial({
      uniforms: {
        base: { value: new THREE.Color(0x12171a) }, shadow: { value: new THREE.Color(0x0b0e10) },
        rim: { value: new THREE.Color(0x3ecfbb) }, strength: { value: 0.45 },
        lightDir: { value: new THREE.Vector3(LIGHT_DIR.x, LIGHT_DIR.y, LIGHT_DIR.z).normalize() },
        noiseAmp: { value: 0.03 }
      },
      vertexShader: SURFACE_VERTEX, fragmentShader: SURFACE_FRAGMENT
    });
    globe.add(new THREE.Mesh(new THREE.SphereGeometry(0.996, 96, 64), sphereMat));

    var atmoMat = new THREE.ShaderMaterial({
      uniforms: { glow: { value: new THREE.Color(0x3ecfbb) }, peak: { value: 0.55 } },
      vertexShader: ATMO_VERTEX, fragmentShader: ATMO_FRAGMENT,
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    var atmo = new THREE.Mesh(new THREE.SphereGeometry(1.09, 64, 48), atmoMat);
    atmo.renderOrder = 1;
    globe.add(atmo);

    /* ---- coastlines + graticule: 1px, fading away from the camera ---- */
    function fadeLineMaterial(opacity) {
      return new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Color(0xffffff) }, opacity: { value: opacity } },
        vertexShader: FADE_VERTEX, fragmentShader: FADE_FRAGMENT, transparent: true, depthWrite: false
      });
    }
    function thinSegments(positions, material) {
      var geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      var obj = new THREE.LineSegments(geo, material);
      globe.add(obj);
      return obj;
    }
    var graticuleMat = fadeLineMaterial(0.16);
    thinSegments(core.graticulePositions(15, 1.0005), graticuleMat);
    var coastMat = fadeLineMaterial(0.62);
    thinSegments(core.buildLinePositions(data, 1.001), coastMat);

    /* ---- stars (dark only) ---- */
    var starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(core.starPositions(STAR_COUNT, STAR_SEED), 3));
    var starMat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.35, depthWrite: false });
    var stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    /* ---- route + arcs: fat Line2 when the addon loaded, 1px lines otherwise ---- */
    var path = core.buildRoutePath(keyframes, { samples: 32, radius: 1.004 });
    var routeLengths = cumulativeLengths(path.positions);
    function cumulativeLengths(pos) {
      var out = [0];
      for (var i = 3; i < pos.length; i += 3) {
        var dx = pos[i] - pos[i - 3], dy = pos[i + 1] - pos[i - 2], dz = pos[i + 2] - pos[i - 1];
        out.push(out[out.length - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz));
      }
      return out;
    }
    var arcPairs = (function () {
      var arr = [];
      timeline.footprints.forEach(function (fp) {
        var target = core.latLngToVector(fp.stop.lat, fp.stop.lng, 1);
        var origin = keyframes[fp.originIndex].dir;
        var pts = core.greatCircleArc(origin, target, { segments: 48, radius: 1.004, arcHeight: 0.16 });
        for (var i = 0; i + 1 < pts.length; i++) {
          arr.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
        }
      });
      return new Float32Array(arr);
    })();

    /* Both builders return the same small interface so frame() never cares
       which one it got. setCount is in vertices of the polyline. */
    function thinPolyline(positions, LineType) {
      var geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      var mat = new THREE.LineBasicMaterial({ transparent: true, opacity: 1 });
      var obj = new LineType(geo, mat);
      globe.add(obj);
      return {
        setColor: function (rgb) { tint(mat.color, rgb); },
        setOpacity: function (o) { mat.opacity = o; },
        setCount: function (k) { geo.setDrawRange(0, k); },
        setResolution: function () {},
        setPulse: function () {}
      };
    }
    function fatPolyline(positions, segments) {
      var geo = segments ? new LINES.LineSegmentsGeometry() : new LINES.LineGeometry();
      geo.setPositions(positions);
      var Type = segments ? LINES.LineSegments2 : LINES.Line2;
      function make(width, opacity, extra) {
        var opts = { linewidth: width, worldUnits: false, transparent: true, opacity: opacity, depthWrite: false };
        if (extra) for (var k in extra) opts[k] = extra[k];
        var mat = new LINES.LineMaterial(opts);
        var obj = new Type(geo, mat);
        globe.add(obj);
        return obj;
      }
      var main = make(2.5, 0.95);
      var glow = make(7, 0.12);
      var pulse = segments ? null : make(3.5, 1, { dashed: true, dashSize: 0.012, gapSize: 100 });
      if (pulse) pulse.computeLineDistances();
      var mats = [main.material, glow.material];
      if (pulse) mats.push(pulse.material);
      return {
        setColor: function (rgb) { mats.forEach(function (m) { tint(m.color, rgb); }); },
        setOpacity: function (o) {
          main.material.opacity = 0.95 * o; glow.material.opacity = 0.12 * o;
          if (pulse) pulse.material.opacity = o;
        },
        setCount: function (k) {
          var n = Math.max(0, k - 1);
          geo.instanceCount = n;
          main.visible = glow.visible = n > 0;
          if (pulse) pulse.visible = n > 0;
        },
        setResolution: function (w, h) { mats.forEach(function (m) { m.resolution.set(w, h); }); },
        setPulse: function (head) { if (pulse) pulse.material.dashOffset = -head; }
      };
    }
    var route = LINES ? fatPolyline(path.positions, false) : thinPolyline(path.positions, THREE.Line);
    var arcs = LINES ? fatPolyline(arcPairs, true) : thinPolyline(arcPairs, THREE.LineSegments);
    route.setCount(0);
    arcs.setOpacity(0);

    /* ---- markers: one quad per distinct place, plus one per footprint ---- */
    var markerGeo = new THREE.PlaneGeometry(2, 2);
    function markerMaterial(halo) {
      return new THREE.ShaderMaterial({
        uniforms: {
          color: { value: new THREE.Color(0x3ecfbb) }, opacity: { value: 0.95 },
          pulse: { value: -1 }, halo: { value: halo ? 1 : 0 }
        },
        vertexShader: MARKER_VERTEX, fragmentShader: MARKER_FRAGMENT,
        transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending
      });
    }
    function marker(dir, halo) {
      var mat = markerMaterial(halo);
      var mesh = new THREE.Mesh(markerGeo, mat);
      mesh.position.set(dir.x * 1.006, dir.y * 1.006, dir.z * 1.006);
      mesh.lookAt(dir.x * 2, dir.y * 2, dir.z * 2);
      mesh.renderOrder = 3;
      globe.add(mesh);
      return { mesh: mesh, mat: mat, dir: dir, indices: [] };
    }
    /* One marker per place; several keyframes (the Dungun years, the two KL
       jobs, the two Shah Alam stops) share it and any of them lights it. */
    var markersByPlace = {};
    var placeMarkers = [];
    keyframes.forEach(function (kf, i) {
      if (kf.kind === "region") return;
      var id = kf.lat + "," + kf.lng;
      var m = markersByPlace[id];
      if (!m) {
        m = markersByPlace[id] = marker(kf.dir, kf.kind === "remote");
        m.labelDir = keyframeStops[i].labelDir;
        m.labelEl = keyframeEls[i];
        placeMarkers.push(m);
      } else if (kf.kind === "remote") {
        m.mat.uniforms.halo.value = 1;
      }
      m.indices.push(i);
    });
    var footprintMarkers = timeline.footprints.map(function (fp) {
      var m = marker(core.latLngToVector(fp.stop.lat, fp.stop.lng, 1), false);
      m.labelDir = fp.stop.labelDir;
      m.labelEl = items[fp.stop.index];
      m.footprint = true;
      return m;
    });
    var allMaterials = placeMarkers.concat(footprintMarkers).map(function (m) { return m.mat; });

    /* ---- labels: DOM, projected each frame, text from the stops themselves ---- */
    var labelLayer = document.createElement("div");
    labelLayer.className = "route-labels";
    labelLayer.setAttribute("aria-hidden", "true");
    stage.appendChild(labelLayer);
    function labelText(li, footprint) {
      if (footprint) return (li.textContent || "").trim();
      var place = li.querySelector(".route-stop-place");
      return ((place ? place.textContent : "") || "").split(" · ")[0].trim();
    }
    var labels = placeMarkers.concat(footprintMarkers).map(function (m) {
      var el = document.createElement("span");
      el.className = "route-label dir-" + (m.labelDir || "e");
      el.hidden = true;
      labelLayer.appendChild(el);
      return { el: el, marker: m, world: new THREE.Vector3(m.dir.x * 1.006, m.dir.y * 1.006, m.dir.z * 1.006) };
    });
    function refreshLabelText() {
      labels.forEach(function (l) { l.el.textContent = labelText(l.marker.labelEl, !!l.marker.footprint); });
    }
    refreshLabelText();
    var projected = new THREE.Vector3();
    function projectLabels(pose, camDir, reveal) {
      var limit = 1 / pose.distance + 0.04; /* a surface point is hidden by the sphere below this */
      labels.forEach(function (l) {
        var m = l.marker;
        var facing = m.dir.x * camDir.x + m.dir.y * camDir.y + m.dir.z * camDir.z;
        var hidden = facing < limit || (m.footprint && reveal <= 0.02);
        if (l.el.hidden !== hidden) l.el.hidden = hidden;
        if (hidden) return;
        projected.copy(l.world).project(camera);
        var off = LABEL_OFFSETS[m.labelDir] || LABEL_OFFSETS.e;
        var x = (projected.x + 1) * 0.5 * viewW + off[0];
        var y = (1 - projected.y) * 0.5 * viewH + off[1];
        l.el.style.transform = "translate(" + x.toFixed(1) + "px, " + y.toFixed(1) + "px) translate(" + off[2] + ")";
        if (m.footprint) l.el.style.opacity = reveal.toFixed(2);
        var active = m.indices.indexOf(pose.activeIndex) !== -1;
        if (l.el.classList.contains("is-active") !== active) l.el.classList.toggle("is-active", active);
      });
    }

    /* ---- theme: every colour comes from the palette custom properties ---- */
    function cssColor(styles, name, fallback) {
      return core.parseCssColor(styles.getPropertyValue(name)) || fallback;
    }
    function applyTheme() {
      var styles = getComputedStyle(root);
      var teal = cssColor(styles, "--teal", { r: 0.24, g: 0.81, b: 0.73 });
      var tealDeep = cssColor(styles, "--teal-deep", { r: 0.09, g: 0.46, b: 0.43 });
      var ink = cssColor(styles, "--ink", { r: 0.04, g: 0.05, b: 0.06 });
      var panel = cssColor(styles, "--panel", { r: 0.07, g: 0.09, b: 0.1 });
      var panel2 = cssColor(styles, "--panel-2", { r: 0.09, g: 0.11, b: 0.13 });
      var paper = cssColor(styles, "--paper", { r: 0.91, g: 0.9, b: 0.87 });
      var muted = cssColor(styles, "--muted", { r: 0.55, g: 0.58, b: 0.6 });
      var light = ink.r + ink.g + ink.b > 1.5;

      tint(sphereMat.uniforms.base.value, panel);
      tint(sphereMat.uniforms.shadow.value, light ? panel2 : ink);
      tint(sphereMat.uniforms.rim.value, light ? tealDeep : teal);
      sphereMat.uniforms.strength.value = light ? 0.18 : 0.45;

      tint(atmoMat.uniforms.glow.value, light ? tealDeep : teal);
      atmoMat.uniforms.peak.value = light ? 0.16 : 0.55;
      atmoMat.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
      atmoMat.needsUpdate = true;

      tint(graticuleMat.uniforms.color.value, muted);
      tint(coastMat.uniforms.color.value, teal);
      tint(starMat.color, paper);
      stars.visible = !light;

      route.setColor(teal);        /* the route rhymes with the timeline spine */
      arcs.setColor(paper);        /* paper: teal arcs vanish against teal coastlines */
      allMaterials.forEach(function (m) {
        tint(m.uniforms.color.value, teal);
        m.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
        m.needsUpdate = true;
      });
      requestRender();
    }
    new MutationObserver(function (mutations) {
      var lang = mutations.some(function (mu) { return mu.attributeName === "data-lang"; });
      if (lang) refreshLabelText();
      if (mutations.some(function (mu) { return mu.attributeName === "data-theme"; })) applyTheme();
    }).observe(root, { attributes: true, attributeFilter: ["data-theme", "data-lang"] });
    var scheme = window.matchMedia("(prefers-color-scheme: light)");
    if (scheme.addEventListener) scheme.addEventListener("change", applyTheme);

    /* ---- frame state ---- */
    var fraction = 0;
    var offset = { yaw: 0, pitch: 0 };
    var dragging = false;
    var onScreen = false;
    var idleStart = performance.now();
    var lastRender = 0;
    var needsRender = true;
    var raf = null;
    var activeEl = null;
    var lastPose = core.resolvePose(0, keyframes);
    var viewW = 1, viewH = 1, aspect = 1, layoutMode = "wide";
    var dead = false; /* set once the context is lost: nothing schedules again */
    var progressEl = rail.querySelector(".route-rail-progress");

    function requestRender() {
      if (dead) return;
      needsRender = true;
      if (raf === null) raf = requestAnimationFrame(frame);
    }
    function setActive(index) {
      var el = keyframeEls[index];
      if (el === activeEl) return;
      if (activeEl) activeEl.classList.remove("is-active");
      activeEl = el;
      if (el) el.classList.add("is-active");
      if (progressEl && el) progressEl.style.height = Math.max(0, el.offsetTop - keyframeEls[0].offsetTop) + "px";
    }

    var camDir = { x: 0, y: 0, z: 1 };
    function frame(now) {
      raf = null;
      if (dead) return;
      var settling = offset.yaw !== 0 || offset.pitch !== 0;
      var breathing = onScreen && !dragging;
      if (!needsRender && !settling && breathing && now - lastRender < IDLE_FRAME_MS) {
        raf = requestAnimationFrame(frame);
        return;
      }
      if (!dragging && settling) offset = core.decayOffset(offset, 0.9);

      var pose = core.resolvePose(fraction, keyframes);
      lastPose = pose;
      var closeness = Math.min(Math.max(pose.distance - 1, 0), 1);
      var drift = breathing ? core.idleDriftOffset(now - idleStart) : { yaw: 0, pitch: 0 };
      camDir = core.applyOrbitOffset(pose.direction,
        offset.yaw + drift.yaw * closeness, offset.pitch + drift.pitch * closeness);

      var fr = core.framing(pose.distance, aspect, layoutMode);
      camera.fov = fr.fov;
      if (camera.setViewOffset) camera.setViewOffset(viewW, viewH, -fr.offsetX * viewW, -fr.offsetY * viewH, viewW, viewH);
      camera.updateProjectionMatrix();
      camera.position.set(camDir.x * pose.distance, camDir.y * pose.distance, camDir.z * pose.distance);
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);
      if (pose.bank) camera.rotateZ(pose.bank);
      stars.rotation.y = offset.yaw * 0.3;

      var count = core.routeDrawCount(core.routeProgress(fraction, keyframes), path.segmentSamples);
      route.setCount(count);
      var drawn = routeLengths[Math.min(Math.max(count, 1), routeLengths.length) - 1];
      route.setPulse(((now / TRAVEL_MS) % 1) * drawn);
      var reveal = core.footprintReveal(fraction, keyframes);
      arcs.setOpacity(reveal * 0.85);

      var scale = core.markerRadius(pose.distance) * MARKER_SCALE;
      var phase = (now % PULSE_MS) / PULSE_MS;
      placeMarkers.forEach(function (m) {
        var active = m.indices.indexOf(pose.activeIndex) !== -1;
        m.mesh.scale.setScalar(scale * (active ? 1.15 : 1));
        m.mat.uniforms.pulse.value = active && breathing ? phase : -1;
        m.mat.uniforms.opacity.value = active ? 1 : 0.8;
      });
      footprintMarkers.forEach(function (m) {
        m.mesh.scale.setScalar(scale * 0.8);
        m.mat.uniforms.opacity.value = reveal * 0.95;
        m.mesh.visible = reveal > 0.02;
      });
      setActive(pose.activeIndex);

      renderer.render(scene, camera);
      projectLabels(pose, camDir, reveal); /* after render: project() reads the camera's world inverse */
      lastRender = now;
      needsRender = false;
      if (breathing || settling || dragging) raf = requestAnimationFrame(frame);
    }

    /* ---- layout + scroll ---- */
    function stickyTop() { return parseFloat(getComputedStyle(stage).top) || 0; }
    function layout() {
      track.style.height = core.trackHeight(stage.clientHeight, keyframes.length, window.innerHeight, SEGMENT_SCROLL_SHARE) + "px";
      var w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      viewW = w; viewH = h; aspect = w / h;
      layoutMode = window.innerWidth <= NARROW_MAX_WIDTH ? "narrow" : "wide";
      renderer.setPixelRatio(core.capDevicePixelRatio(window.devicePixelRatio, DPR_MAX));
      renderer.setSize(w, h, false);
      camera.aspect = aspect;
      route.setResolution(w, h);
      arcs.setResolution(w, h);
      if (progressEl) progressEl.style.top = (keyframeEls[0].offsetTop + RAIL_NODE_Y) + "px";
      if (activeEl && progressEl) progressEl.style.height = Math.max(0, activeEl.offsetTop - keyframeEls[0].offsetTop) + "px";
      onScroll();
      requestRender();
    }
    function onScroll() {
      var rect = track.getBoundingClientRect();
      var next = core.scrollFraction(rect.top, rect.height, stage.clientHeight, stickyTop());
      if (next === fraction) return;
      fraction = next;
      requestRender();
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", layout);

    var visibility = new IntersectionObserver(function (entries) {
      onScreen = entries.some(function (e) { return e.isIntersecting; });
      if (onScreen) { idleStart = performance.now(); requestRender(); }
    }, { threshold: 0 });
    visibility.observe(stage);

    /* ---- drag to orbit (fine pointers only, like the cursor glow) ---- */
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      var lastX = 0, lastY = 0;
      canvas.addEventListener("pointerdown", function (e) {
        if (e.button !== 0) return;
        dragging = true;
        lastX = e.clientX; lastY = e.clientY;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
        section.classList.add("is-dragging", "has-dragged");
        e.preventDefault();
        requestRender();
      });
      canvas.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        var sensitivity = 0.0045 * Math.min(Math.max(lastPose.distance - 1, 0.06), 1);
        offset.yaw -= (e.clientX - lastX) * sensitivity;
        offset.pitch = Math.min(Math.max(offset.pitch - (e.clientY - lastY) * sensitivity, -1.2), 1.2);
        lastX = e.clientX; lastY = e.clientY;
        requestRender();
      });
      function endDrag() {
        if (!dragging) return;
        dragging = false;
        section.classList.remove("is-dragging");
        requestRender();
      }
      canvas.addEventListener("pointerup", endDrag);
      canvas.addEventListener("pointercancel", endDrag);
      canvas.addEventListener("lostpointercapture", endDrag);
    }

    /* A lost context (driver reset, too many contexts, Safari reclaiming
       memory) is terminal: tear the loop down and fall back to the poster.
       Recovery needs a reload; nothing here listens for webglcontextrestored. */
    canvas.addEventListener("webglcontextlost", function (e) {
      e.preventDefault();
      transition("context-lost");
      dead = true;
      if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
      visibility.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", layout);
      section.classList.remove("is-live");
      canvas.classList.remove("route-fade");
      labelLayer.hidden = true;
      section.dataset.globe = "error";
      track.style.height = "";
      if (progressEl) { progressEl.style.height = ""; progressEl.style.top = ""; }
      if (activeEl) { activeEl.classList.remove("is-active"); activeEl = null; }
      warn("render", "webgl context lost");
    });

    /* ---- go live ---- */
    transition("load-success");
    section.classList.add("is-live");
    canvas.classList.add("route-fade");
    section.dataset.globe = LINES ? "live" : "live-thin";
    applyTheme();
    layout();
  }
})();
```

- [ ] **Step 2: Run the unit suite (nothing should regress)**

Run: `node --test "tests/*.test.js"`
Expected: PASS.

- [ ] **Step 3: Verify in the browser — dark, 1440×900**

```bash
python -m http.server 8080
```

Open `http://localhost:8080/#route` in Chrome. In DevTools → Console:

```js
document.getElementById('route').dataset.globe
```
Expected: `"live"`. If it reads `"live-thin"`, the Console will show `[route-globe] lines: …` naming the addon failure — usually the import map is not before the first script, or the mapped URL differs from the adapter's. Fix Task 3 before continuing.

Scroll slowly through the section. Expected at every stop:
- The globe is large, offset right, with its left limb and a teal glow visible; no rectangle, no border; the top and bottom of the canvas fade into the page.
- The dark side of the sphere merges into the page background; the lit side is slightly lighter with faint texture.
- Coastlines fade toward the limb; the far side is not visible.
- The route is a 2–3px teal line with a soft glow and a small bright light travelling along it.
- The active marker pulses; labels read `DUNGUN, TERENGGANU`, `KUALA LUMPUR`, `SHAH ALAM`, `PETALING JAYA` around the markers with leader lines, the three Klang Valley labels in three different directions, never overlapping.
- The caption rail on the left lists all nine stops; the active row is bright with its description expanded, its node lit teal, and the progress bar drawn down to it.
- At "Today" the camera pulls back to a whole sphere, the three arcs fade in (paper colour) with `SINGAPORE`, `BANGKOK, THAILAND`, `MANILA, PHILIPPINES` labels.
- Drag orbits; release settles; the stars parallax slightly.
- The timeline begins directly under the stage with no second heading.

- [ ] **Step 4: Verify light theme and Bahasa Melayu**

Click the theme toggle mid-scroll. Expected: the sphere turns paper-white with a warm shadow side, a soft teal-deep haze instead of a glow, no stars, teal-deep rim; markers are solid (not additive) and legible. Click the language toggle: labels change to `SINGAPURA`, `BANGKOK, THAILAND`, `MANILA, FILIPINA`; the rail shows the Malay captions.

- [ ] **Step 5: Verify 768 and 375 widths**

DevTools device toolbar at 768×1024 and 375×812. Expected: the globe sits high (centre about a third down), whole limb visible at the top of the frame at every stop, the single crossfading caption at the bottom never covers Malaysia, labels smaller, no horizontal scroll (`document.documentElement.scrollWidth === window.innerWidth`).

- [ ] **Step 6: Verify the fallbacks**

- Emulate reduced motion, reload: poster + plain list, `dataset.globe === "reduced-motion"`.
- DevTools → Network → block `**/lines/Line2.js`, reload: the globe renders with 1px lines, `dataset.globe === "live-thin"`, one console warning.
- DevTools → Rendering → "Emulate GPU" is not available; instead, in Console run `document.getElementById('route-canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()` while live. Expected: the poster returns, `dataset.globe === "error"`, labels disappear, the timeline is still reachable.

- [ ] **Step 7: Performance check**

DevTools → Performance, CPU throttling 4×, record a slow scroll through the section. Expected: no long frames above ~16 ms after the first paint; idle on-screen frames at ~30 fps; no frames at all once the section scrolls off (the loop stops).

- [ ] **Step 8: Commit**

```bash
git add assets/js/route-globe.js
git commit -m "feat(globe): lit sphere, atmosphere, fading coastlines, Line2 route, pulsing markers, projected labels and the caption rail"
```

---

### Task 7: Posters, docs, cache tag and final verification

**Files:**
- Replace: `assets/img/route-globe-dark.jpg`, `assets/img/route-globe-light.jpg`
- Modify: `docs/superpowers/specs/2026-07-24-portfolio-site-design.md` (paragraph 2b)
- Modify: `CLAUDE.md` (file table row for `assets/vendor/three/`, the "Route globe" section)
- Modify: `index.html` (`?v=`)

- [ ] **Step 1: Capture the posters**

With the server running, in Chrome at a 1600×900 window (DevTools device toolbar → Responsive → 1600×900, DPR 1), theme forced dark (`localStorage.setItem('theme','dark')`, reload), scroll to the very end of the route track so the final reveal is at rest:

```js
(() => { const t = document.getElementById('route-track'); const r = t.getBoundingClientRect();
  window.scrollTo(0, window.scrollY + r.top + r.height - window.innerHeight); })();
```

Wait a second for the arcs to settle, then in Elements select `#route-stage` → right-click → "Capture node screenshot". Save the PNG, convert to JPEG quality 82 at 1600×900, and overwrite `assets/img/route-globe-dark.jpg`. Repeat with `localStorage.setItem('theme','light')` for `route-globe-light.jpg`.

If the Playwright MCP tools are available in the session, the equivalent is `browser_resize 1600 900` → `browser_navigate http://localhost:8080/#route` → `browser_evaluate` (theme + scroll snippet above, with a 1200 ms wait) → `browser_take_screenshot` with `type: "jpeg"`, `target: "#route-stage"`, then move the file into `assets/img/`.

Check: both files are 1600×900 and under 260 KB:

```bash
node -e "for (const t of ['dark','light']) { const b = require('fs').readFileSync('assets/img/route-globe-'+t+'.jpg'); console.log(t, b.length, b.readUInt16BE(b.indexOf(Buffer.from([0xff,0xc0]))+7), b.readUInt16BE(b.indexOf(Buffer.from([0xff,0xc0]))+5)); }"
```

Expected output: `dark <bytes> 1600 900` and `light <bytes> 1600 900`.

- [ ] **Step 2: Update the registry paragraph**

In `docs/superpowers/specs/2026-07-24-portfolio-site-design.md`, replace paragraph 2b with:

```markdown
2b. **Route globe** (added 2026-09-05, "Horizon" redesign 2026-09-05 — see
   `2026-09-05-route-globe-horizon-design.md`) — a scroll-scrubbed three.js globe that flies
   the life route town by town: born 1992 Dungun → SMK Balai Besar → UiTM Dungun → Kuala
   Lumpur (MyEMRO) → Shah Alam (UiTM degree) → Petaling Jaya (TRM Nett) → Shah Alam, remote
   (NCS) → Kuala Lumpur (RetailAIM) → pull-back reveal with arcs to Singapore, Bangkok and
   Manila for the RetailAIM Plus footprint. Full-bleed and borderless over the page
   atmosphere, lit sphere with a fresnel atmosphere shell, the limb in frame at every stop,
   a caption rail on the timeline's spine line, and one heading shared with the timeline
   (the timeline itself carries no section head). Town-level coordinates only. Renders as a
   poster plus a plain stops list without JS/WebGL2 or under `prefers-reduced-motion`.
   three.js is vendored (`assets/vendor/three/`, plus its `lines/` addon resolved through
   an import map), the only heavy library on the page, and loads lazily.
```

- [ ] **Step 3: Update `CLAUDE.md`**

File table row:

```markdown
| `assets/vendor/three/` | Vendored three.js r185 (`three.module.min.js` + `three.core.min.js`, kept side by side) and its `lines/` fat-line addon, whose bare `three` import the `<head>` import map resolves |
```

Replace the "Route globe (three.js)" section body (up to `#### Regenerating the globe coastlines`) with:

```markdown
The section `#route` between the stats strip and the timeline is a scroll-scrubbed globe
that also carries the journey's only heading (`#journey` has none). Its **data is the
markup**: each `<li data-lat data-lng data-kind data-zoom [data-label-dir]>` in
`#route-stops` is a camera keyframe in DOM order (`place` | `remote` | `region`) and the
nested `data-kind="footprint"` items are the reveal's arc targets. `data-label-dir`
(`n|ne|e|se|s|sw|w|nw`) fans the projected DOM label out from its marker; the three Klang
Valley places must use three different directions or the labels stack. Town-level
coordinates only — the profile's privacy exclusions rule out anything finer, and "Sura
Gate" stays off the map. Adding a stop is an HTML + `i18n.js` edit;
`tests/route-globe-section.test.js` checks ranges, kinds, zoom, directions and MS coverage.

**Zooms stay between 1.5 and 3.2, and the limb is always in frame.** `core.framing()`
picks the FOV and a view offset per distance, aspect and layout, and
`core.limbInFrame()` is the invariant the core test checks on a grid. There is no
street-level zoom on purpose: the marker, pulse, label and rail caption identify the
stop; the sphere identifies the medium. Don't lower `DEFAULT_ZOOM` or a `data-zoom`
below 1.5 without re-running that test.

`route-globe.js` upgrades the section in place only when `evaluateGate` passes (no
`prefers-reduced-motion`, no `saveData`, WebGL2 present) and the section comes within
600px of the viewport; then it dynamically imports the vendored three.js, the five
`lines/` addon modules and the coastline JSON (with the same `?v=` tag). The addon is
optional: if it fails the globe renders with 1px lines and `section.dataset.globe` reads
`live-thin`. Everything else — no JS, reduced motion, no WebGL2, a failed load, a lost
context — leaves the poster (`assets/img/route-globe-{dark,light}.jpg`) and the plain
stops list, and writes the reason to `section.dataset.globe`. Read that attribute before
guessing why the globe is static. Rendering is on demand: frames draw on scroll, drag and
theme change, plus a ~30 fps loop (breathing sway, marker pulse, travelling light) only
while the stage is on screen. Colours are read from the palette custom properties, so a
theme change needs no globe code; the light theme swaps additive blending for normal and
hides the stars.

The stage is full-bleed and transparent (the page atmosphere shows through) with a CSS
mask fading its top and bottom edges; there is deliberately no border, radius, background
or shadow — that box is what made the first version read as an embedded video. The
posters are node screenshots of the finished scene at the final reveal (dark and light,
1600×900). Recapture them when the route, the framing or the palette changes.
```

- [ ] **Step 4: Bump `?v=`**

In `index.html`, replace every `?v=2026-09-05a` with `?v=2026-09-05b` (the stylesheet plus the nine script tags). Confirm:

```bash
grep -c 'v=2026-09-05b' index.html; grep -c 'v=2026-09-05a' index.html
```
Expected: `10` then `0`.

- [ ] **Step 5: Full verification**

```bash
node --test "tests/*.test.js"
node tools/test_jd_extractor.mjs
node tools/test_jd_matcher.mjs
node tools/test_recruiter_cloud_payload.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File tools/verify_recruiter_profile.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools/verify_recruiter_ui.ps1
```
Expected: 0 failing across all six. Then a last browser pass (hard reload so the new `?v=` assets load): dark and light, EN and BM, 375 / 768 / 1440, `dataset.globe === "live"`.

- [ ] **Step 6: Commit**

```bash
git add assets/img/route-globe-dark.jpg assets/img/route-globe-light.jpg docs/superpowers/specs/2026-07-24-portfolio-site-design.md CLAUDE.md index.html
git commit -m "chore(globe): recapture posters for the Horizon globe, update docs, bump ?v= to 2026-09-05b"
```

Hand back to the user for the merge to `main` (pushing `main` is the deploy).
