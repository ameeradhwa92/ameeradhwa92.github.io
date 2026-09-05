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
  const journey = html.indexOf('<main class="section wrap" id="journey">');
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
    if (stop.kind !== 'footprint') assert.ok(stop.zoom > 1 && stop.zoom <= 3, `zoom in range for ${stop.key}`);
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
