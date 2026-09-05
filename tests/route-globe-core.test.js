const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../assets/js/route-globe-core.js');

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const len = (v) => Math.hypot(v.x, v.y, v.z);

const stopsRaw = [
  { lat: 4.77, lng: 103.42, kind: 'place', key: 'born', zoom: '1.3' },
  { lat: 4.77, lng: 103.42, kind: 'place', key: 'diploma' },
  { lat: 3.139, lng: 101.687, kind: 'place', key: 'kl' },
  { lat: 3.073, lng: 101.518, kind: 'remote', key: 'ncs' },
  { lat: 8, lng: 109, kind: 'region', key: 'sea', zoom: '2.6' },
  { lat: 1.352, lng: 103.82, kind: 'footprint', key: 'sg' },
  { lat: 14.6, lng: 120.98, kind: 'footprint', key: 'ph' }
];

test('latLngToVector projects onto a Y-up unit sphere with lng 0 facing +Z', () => {
  const origin = core.latLngToVector(0, 0);
  assert.ok(near(origin.x, 0) && near(origin.y, 0) && near(origin.z, 1));
  const pole = core.latLngToVector(90, 45);
  assert.ok(near(pole.y, 1) && near(pole.x, 0) && near(pole.z, 0));
  const east = core.latLngToVector(0, 90);
  assert.ok(near(east.x, 1) && near(east.z, 0));
  assert.ok(near(len(core.latLngToVector(4.77, 103.42, 2.5)), 2.5));
});

test('slerp keeps unit length, honours endpoints and survives coincident and antipodal inputs', () => {
  const a = core.latLngToVector(3, 101), b = core.latLngToVector(14, 121);
  assert.deepEqual(core.slerp(a, b, 0), a);
  const end = core.slerp(a, b, 1);
  assert.ok(near(end.x, b.x) && near(end.y, b.y) && near(end.z, b.z));
  assert.ok(near(len(core.slerp(a, b, 0.37)), 1));
  const mid = core.slerp(a, b, 0.5);
  assert.ok(near(core.angleBetween(a, mid), core.angleBetween(mid, b)));
  assert.deepEqual(core.slerp(a, { ...a }, 0.5), a);
  const anti = core.slerp(a, { x: -a.x, y: -a.y, z: -a.z }, 0.5);
  assert.ok(Number.isFinite(anti.x) && near(len(anti), 1));
});

test('greatCircleArc returns segments+1 points, bowed outward by arcHeight', () => {
  const a = core.latLngToVector(3, 101), b = core.latLngToVector(1, 103);
  const pts = core.greatCircleArc(a, b, { segments: 10, radius: 1, arcHeight: 0.2 });
  assert.equal(pts.length, 11);
  assert.ok(near(len(pts[0]), 1) && near(len(pts[10]), 1));
  assert.ok(near(len(pts[5]), 1.2, 1e-9));
});

test('parseStops validates coordinates, defaults kind and zoom, and reports bad rows', () => {
  const { stops, warnings } = core.parseStops([
    ...stopsRaw,
    { lat: 91, lng: 0 },
    { lat: 'x', lng: 10 },
    { lat: 1, lng: 1, kind: 'castle', zoom: '0.5' }
  ]);
  assert.equal(stops.length, 8);
  assert.equal(warnings.length, 3);
  assert.equal(stops[0].zoom, 1.3);
  assert.equal(stops[1].zoom, core.DEFAULT_ZOOM.place);
  assert.equal(stops[4].zoom, 2.6);
  assert.equal(stops[7].kind, 'place');
  assert.equal(stops[7].zoom, core.DEFAULT_ZOOM.place);
});

test('buildTimeline separates keyframes from footprints and resolves their origin and anchor', () => {
  const { stops } = core.parseStops(stopsRaw);
  const { keyframable, footprints, warnings } = core.buildTimeline(stops);
  assert.deepEqual(keyframable.map((s) => s.key), ['born', 'diploma', 'kl', 'ncs', 'sea']);
  assert.equal(footprints.length, 2);
  assert.equal(footprints[0].originIndex, 3, 'arcs fly out of the last place/remote stop, not the region');
  assert.equal(footprints[0].stop.zoom, null, 'footprints never frame the camera');
  assert.equal(warnings.length, 0);
  const orphan = core.buildTimeline(core.parseStops([{ lat: 1, lng: 1, kind: 'footprint' }]).stops);
  assert.equal(orphan.footprints.length, 0);
  assert.equal(orphan.warnings.length, 1);
});

function keyframes() {
  const { stops } = core.parseStops(stopsRaw);
  return core.buildCameraKeyframes(core.buildTimeline(stops).keyframable);
}

test('resolvePose rests on the first and last keyframes and dwells before travelling', () => {
  const kf = keyframes();
  const start = core.resolvePose(0, kf), end = core.resolvePose(1, kf);
  assert.equal(start.activeIndex, 0);
  assert.ok(near(start.distance, 1.3) && near(len(start.position), 1.3));
  assert.equal(end.activeIndex, kf.length - 1);
  assert.ok(near(end.distance, 2.6));
  const dwell = core.resolvePose(0.05, kf); // inside the first segment's opening dwell
  assert.equal(dwell.travel, 0);
  assert.deepEqual(dwell.direction, kf[0].dir);
});

test('resolvePose advances monotonically and flips the active stop mid-travel', () => {
  const kf = keyframes();
  let last = -1;
  for (let f = 0; f <= 1.0001; f += 0.01) {
    const pose = core.resolvePose(f, kf);
    assert.ok(pose.activeIndex >= last);
    assert.ok(Number.isFinite(pose.position.x));
    last = pose.activeIndex;
  }
  const seg = 1 / (kf.length - 1);
  assert.equal(core.resolvePose(seg * 1.45, kf).activeIndex, 1);
  assert.equal(core.resolvePose(seg * 1.55, kf).activeIndex, 2);
  assert.equal(core.resolvePose(0, []).activeIndex, 0);
});

test('footprintReveal and routeProgress track the final segment', () => {
  const kf = keyframes();
  assert.equal(core.footprintReveal(0, kf), 0);
  assert.equal(core.footprintReveal(0.5, kf), 0);
  assert.equal(core.footprintReveal(1, kf), 1);
  const lastStart = (kf.length - 2) / (kf.length - 1);
  assert.ok(core.footprintReveal(lastStart + 0.5 / (kf.length - 1), kf) > 0);
  assert.equal(core.routeProgress(0, kf), 0);
  assert.equal(core.routeProgress(1, kf), kf.length - 1);
  assert.equal(core.footprintReveal(0, [kf[0]]), 1);
});

test('buildRoutePath skips region segments and routeDrawCount counts vertices progressively', () => {
  const kf = keyframes();
  const path = core.buildRoutePath(kf, { samples: 10 });
  assert.deepEqual(path.segmentSamples, [11, 10, 10, 0]);
  assert.equal(path.positions.length, 31 * 3);
  assert.equal(core.routeDrawCount(0, path.segmentSamples), 0);
  assert.equal(core.routeDrawCount(1, path.segmentSamples), 11);
  assert.equal(core.routeDrawCount(1.5, path.segmentSamples), 16);
  assert.equal(core.routeDrawCount(4, path.segmentSamples), 31);
});

test('applyOrbitOffset rotates without changing length and yaw is reversible', () => {
  const dir = core.latLngToVector(3, 101);
  const turned = core.applyOrbitOffset(dir, 0.3, 0.1);
  assert.ok(near(len(turned), 1));
  assert.ok(core.angleBetween(dir, turned) > 0.2);
  const back = core.applyOrbitOffset(core.applyOrbitOffset(dir, 0.3, 0), -0.3, 0);
  assert.ok(near(back.x, dir.x) && near(back.y, dir.y) && near(back.z, dir.z));
});

test('decayOffset shrinks toward zero and snaps small values', () => {
  assert.deepEqual(core.decayOffset({ yaw: 1, pitch: -1 }, 0.5), { yaw: 0.5, pitch: -0.5 });
  assert.deepEqual(core.decayOffset({ yaw: 0.00005, pitch: 0 }), { yaw: 0, pitch: 0 });
});

test('idleDriftOffset stays tiny and starts at rest', () => {
  assert.deepEqual(core.idleDriftOffset(0), { yaw: 0, pitch: 0 });
  const d = core.idleDriftOffset(1300);
  assert.ok(Math.abs(d.yaw) <= 0.05 && Math.abs(d.pitch) <= 0.018);
});

test('markerRadius grows with camera distance inside its clamp', () => {
  assert.ok(core.markerRadius(1.1) < core.markerRadius(2.6));
  assert.equal(core.markerRadius(1), 0.0004);
  assert.equal(core.markerRadius(50), 0.03);
});

test('scrollFraction and trackHeight describe the sticky scrub', () => {
  assert.equal(core.scrollFraction(80, 2000, 600, 80), 0);
  assert.equal(core.scrollFraction(-620, 2000, 600, 80), 0.5);
  assert.equal(core.scrollFraction(-5000, 2000, 600, 80), 1);
  assert.equal(core.scrollFraction(0, 600, 600, 80), 0);
  assert.equal(core.trackHeight(600, 9, 1000, 0.42), 600 + 8 * 420);
  assert.equal(core.trackHeight(600, 1, 1000), 600);
});

test('capDevicePixelRatio clamps into [1, max]', () => {
  assert.equal(core.capDevicePixelRatio(3), 2);
  assert.equal(core.capDevicePixelRatio(0.5), 1);
  assert.equal(core.capDevicePixelRatio(1.5, 1.25), 1.25);
  assert.equal(core.capDevicePixelRatio(undefined), 1);
});

test('parseCssColor reads hex, the --teal-rgb triple and rgb() identically', () => {
  const hex = core.parseCssColor('#3ecfbb');
  const triple = core.parseCssColor(' 62, 207, 187 ');
  const fn = core.parseCssColor('rgb(62, 207, 187)');
  assert.deepEqual(hex, triple);
  assert.deepEqual(hex, fn);
  assert.deepEqual(core.parseCssColor('#fff'), { r: 1, g: 1, b: 1 });
  assert.equal(core.parseCssColor('teal'), null);
  assert.equal(core.parseCssColor('300, 0, 0'), null);
  assert.equal(core.parseCssColor(undefined), null);
});

test('buildLinePositions expands runs into segment pairs on the sphere', () => {
  const data = { version: 1, scale: 100, runs: [3, 2], points: [0, 0, 9000, 0, 9000, 9000, 18000, 0, -18000, 0] };
  const out = core.buildLinePositions(data);
  assert.equal(out.length, 3 * 6);
  assert.ok(near(out[0], 0) && near(out[2], 1));
  assert.ok(near(out[3], 1) && near(out[5], 0, 1e-6));
  for (let i = 0; i < out.length; i += 3) assert.ok(near(Math.hypot(out[i], out[i + 1], out[i + 2]), 1));
  assert.throws(() => core.buildLinePositions({ scale: 100, runs: [2], points: [0, 0] }));
  assert.throws(() => core.buildLinePositions(null));
});

test('graticulePositions yields finite segment pairs', () => {
  const g = core.graticulePositions(30);
  assert.ok(g.length > 0 && g.length % 6 === 0);
  for (let i = 0; i < g.length; i++) assert.ok(Number.isFinite(g[i]));
});

test('evaluateGate refuses reduced motion, save-data and missing WebGL2 in that order', () => {
  assert.deepEqual(core.evaluateGate({ hasWebGL2: true }), { eligible: true, reason: 'eligible' });
  assert.equal(core.evaluateGate({ hasWebGL2: true, reducedMotion: true, saveData: true }).reason, 'reduced-motion');
  assert.equal(core.evaluateGate({ hasWebGL2: true, saveData: true }).reason, 'save-data');
  assert.equal(core.evaluateGate({ hasWebGL2: false }).reason, 'webgl2-unavailable');
  assert.equal(core.evaluateGate({ hasWebGL2: true, hasIntersectionObserver: false }).reason, 'no-intersection-observer');
});

test('nextState follows the load state machine and ignores illegal events', () => {
  assert.equal(core.nextState('idle', 'gate-fail'), 'gated-off');
  assert.equal(core.nextState('idle', 'enter-viewport'), 'pending');
  assert.equal(core.nextState('pending', 'load-success'), 'ready');
  assert.equal(core.nextState('pending', 'load-fail'), 'error');
  assert.equal(core.nextState('ready', 'context-lost'), 'error');
  assert.equal(core.nextState('ready', 'enter-viewport'), 'ready');
  assert.equal(core.nextState('gated-off', 'enter-viewport'), 'gated-off');
  assert.equal(core.nextState('nonsense', 'load-success'), 'nonsense');
});
