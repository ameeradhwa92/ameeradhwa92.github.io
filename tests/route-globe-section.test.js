const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets', 'css', 'style.css'), 'utf8');
const core = require('../assets/js/route-globe-core.js');

// i18n.js assigns window.I18N_MS; evaluate it with a stub window.
const i18nSource = fs.readFileSync(path.join(root, 'assets', 'js', 'i18n.js'), 'utf8');
const I18N_MS = new Function('window', i18nSource + '; return window.I18N_MS;')({});

const sectionMatch = html.match(/<section class="section wrap route-globe" id="route"[\s\S]*?<\/section>/);
const section = sectionMatch ? sectionMatch[0] : '';

test('the route section sits between the stats strip and the timeline', () => {
  assert.ok(section, 'route section markup is present');
  const stats = html.indexOf('<section class="stats"');
  const route = html.indexOf('id="route"');
  const journey = html.indexOf('<main class="section wrap journey-continued" id="journey">');
  assert.ok(stats > -1 && stats < route && route < journey);
});

test('every visible string in the route section has a Bahasa Melayu translation', () => {
  const keys = [...section.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 30, `expected the stops and chrome to be keyed, found ${keys.length}`);
  for (const key of keys) {
    assert.match(key, /^globe\./, `route section keys use the globe.* namespace: ${key}`);
    assert.equal(typeof I18N_MS[key], 'string', `missing MS entry for ${key}`);
    assert.ok(I18N_MS[key].trim().length > 0, `empty MS entry for ${key}`);
  }
});

test('stops carry town-level coordinates, a known kind and a sane zoom, in a valid order', () => {
  const items = [...section.matchAll(/<li[^>]*data-lat="([^"]+)"[^>]*data-lng="([^"]+)"[^>]*data-kind="([^"]+)"(?:[^>]*data-zoom="([^"]+)")?[^>]*>/g)];
  assert.ok(items.length >= 9, 'at least the nine keyframes plus footprints');
  const raw = items.map((m) => ({ lat: m[1], lng: m[2], kind: m[3], zoom: m[4] }));
  const parsed = core.parseStops(raw);
  assert.deepEqual(parsed.warnings, []);
  for (const stop of parsed.stops) {
    assert.ok(stop.lat >= -12 && stop.lat <= 25 && stop.lng >= 95 && stop.lng <= 125, 'all stops lie in Southeast Asia');
    assert.ok(/^\d+\.\d{1,4}$/.test(String(Math.abs(Number(raw[stop.index].lat)))), 'coordinates carry at most four decimals (town level)');
    if (stop.kind !== 'footprint') assert.ok(stop.zoom > 1 && stop.zoom <= 3.2, `zoom in range for ${stop.key}`);
  }
  const timeline = core.buildTimeline(parsed.stops);
  assert.deepEqual(timeline.warnings, []);
  assert.equal(timeline.keyframable[0].kind, 'place', 'the route starts at a place');
  assert.equal(timeline.keyframable[timeline.keyframable.length - 1].kind, 'region', 'the route ends on the pull-back reveal');
  assert.equal(timeline.footprints.length, 3, 'Singapore, Thailand and the Philippines');
  const origin = timeline.keyframable[timeline.footprints[0].originIndex];
  assert.equal(origin.kind, 'place');
  assert.ok(Math.abs(origin.lat - 3.139) < 0.01, 'the footprint arcs fan out of Kuala Lumpur');
});

test('the stage carries the canvas, both theme posters and the stops list', () => {
  assert.match(section, /<canvas class="route-canvas" id="route-canvas" aria-hidden="true"><\/canvas>/);
  for (const theme of ['dark', 'light']) {
    const re = new RegExp(`<img class="route-poster route-poster-${theme}" src="(assets/img/route-globe-${theme}\\.jpg)" width="\\d+" height="\\d+" loading="lazy"[^>]*alt="">`);
    const m = section.match(re);
    assert.ok(m, `${theme} poster is lazy, sized and decorative`);
    assert.ok(fs.existsSync(path.join(root, m[1])), `${m[1]} exists`);
  }
  assert.match(section, /<ol class="route-stops" id="route-stops">/);
});

test('the two route scripts load after chatbot.js and share the single ?v= tag', () => {
  assert.match(
    html,
    /<script src="assets\/js\/chatbot\.js\?v=([^"]+)" defer><\/script>\s*<script src="assets\/js\/route-globe-core\.js\?v=\1" defer><\/script>\s*<script src="assets\/js\/route-globe\.js\?v=\1" defer><\/script>/
  );
});

test('the shipped coastline file decodes with the core projection', () => {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'data', 'route-globe-coastlines.json'), 'utf8'));
  assert.equal(data.version, 1);
  const positions = core.buildLinePositions(data);
  assert.ok(positions.length > 6000 * 6, 'thousands of segments');
  assert.ok(fs.statSync(path.join(root, 'assets', 'data', 'route-globe-coastlines.json')).size < 200000, 'stays under 200 KB raw');
});

test('reduced motion also freezes the caption crossfade in CSS', () => {
  const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/);
  assert.ok(block, 'reduced-motion block exists');
  assert.match(block[1], /\.route-stop \{[^}]*transition: none/);
});

test('the vendored three.js pair is present and pinned in the vendor README', () => {
  const vendor = path.join(root, 'assets', 'vendor', 'three');
  assert.ok(fs.existsSync(path.join(vendor, 'three.module.min.js')));
  assert.ok(fs.existsSync(path.join(vendor, 'three.core.min.js')));
  const readme = fs.readFileSync(path.join(root, 'assets', 'vendor', 'README.md'), 'utf8');
  assert.match(readme, /three\.js `0\.185\.1`/);
});

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

test('the live stage is full-bleed, borderless and fades into the page', () => {
  assert.match(css, /\.route-track \{[^}]*width: calc\(100vw - var\(--route-gutter, 0px\)\);[^}]*margin-left: calc\(50% - 50vw \+ var\(--route-gutter, 0px\) \/ 2\)/);
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
