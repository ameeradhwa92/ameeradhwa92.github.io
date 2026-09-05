// Builds assets/data/route-globe-coastlines.json — the country outlines the
// route globe draws — from the world-atlas TopoJSON redistribution of Natural
// Earth. Run it by hand (never at runtime, never from the test suite):
//
//   curl -sSL -o world-atlas.tgz https://registry.npmjs.org/world-atlas/-/world-atlas-2.0.2.tgz
//   mkdir world-atlas && tar -xzf world-atlas.tgz -C world-atlas
//   node tools/build_route_globe_coastlines.mjs world-atlas/package assets/data/route-globe-coastlines.json
//
// Two detail tiers are stitched together: 1:110m for the whole world and 1:50m
// inside a Southeast Asia bounding box, where the camera gets close. Each
// TopoJSON arc is a shared border drawn exactly once, so there are no doubled
// lines. Output is compact integer lon/lat pairs (see FORMAT below); the
// browser projects them onto the sphere with the same core function the route
// stops use, so coastlines and markers cannot drift apart.
//
// FORMAT: { version, scale, source, runs: [pointCount, ...], points: [lon*scale, lat*scale, ...] }
// A run is one polyline; sum(runs) * 2 === points.length.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../assets/js/route-globe-core.js");

const SEA_BBOX = { west: 92, east: 130, south: -12, north: 25 }; // lon/lat degrees
const SCALE = 100;              // 0.01° ≈ 1.1 km, plenty for 1:50m linework
const TOLERANCE_50M = 0.015;    // Douglas–Peucker, degrees, applied to the detail tier

const [srcDir, outPath = "assets/data/route-globe-coastlines.json"] = process.argv.slice(2);
if (!srcDir) {
  console.error("usage: node tools/build_route_globe_coastlines.mjs <world-atlas package dir> [out.json]");
  process.exit(1);
}

function decodeArcs(topology) {
  const [sx, sy] = topology.transform.scale;
  const [tx, ty] = topology.transform.translate;
  return topology.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx; y += dy;
      return [x * sx + tx, y * sy + ty];
    });
  });
}

function inBox(p) {
  return p[0] >= SEA_BBOX.west && p[0] <= SEA_BBOX.east && p[1] >= SEA_BBOX.south && p[1] <= SEA_BBOX.north;
}

// Split a polyline into maximal runs whose points satisfy `keep`, sharing one
// boundary point with the neighbouring run so the two tiers meet without a gap.
function splitRuns(points, keep) {
  const runs = [];
  let run = [];
  for (let i = 0; i < points.length; i++) {
    const ok = keep(points[i]);
    if (ok) {
      if (run.length === 0 && i > 0) run.push(points[i - 1]);
      run.push(points[i]);
    } else if (run.length) {
      run.push(points[i]);
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs.filter((r) => r.length >= 2);
}

function simplify(points, tolerance) {
  if (tolerance <= 0 || points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxDist = 0, idx = -1;
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let d;
      if (len2 === 0) d = Math.hypot(px - ax, py - ay);
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (d > maxDist) { maxDist = d; idx = i; }
    }
    if (maxDist > tolerance) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

const world = JSON.parse(fs.readFileSync(path.join(srcDir, "countries-110m.json"), "utf8"));
const detail = JSON.parse(fs.readFileSync(path.join(srcDir, "countries-50m.json"), "utf8"));

const runs = [];
for (const arc of decodeArcs(world)) {
  for (const run of splitRuns(arc, (p) => !inBox(p))) runs.push(run);
}
for (const arc of decodeArcs(detail)) {
  for (const run of splitRuns(arc, inBox)) runs.push(simplify(run, TOLERANCE_50M));
}

const points = [];
const lengths = [];
for (const run of runs) {
  const quantized = [];
  let last = null;
  for (const [lon, lat] of run) {
    const q = [Math.round(lon * SCALE), Math.round(lat * SCALE)];
    if (last && last[0] === q[0] && last[1] === q[1]) continue;
    quantized.push(q); last = q;
  }
  if (quantized.length < 2) continue;
  lengths.push(quantized.length);
  for (const q of quantized) points.push(q[0], q[1]);
}

const out = {
  version: 1,
  scale: SCALE,
  source: "Natural Earth 4.1.0 via world-atlas 2.0.2 (110m world, 50m Southeast Asia)",
  runs: lengths,
  points
};
// Sanity: the browser must be able to project every point.
core.buildLinePositions(out);
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`${outPath}: ${lengths.length} runs, ${points.length / 2} points, ${fs.statSync(outPath).size} bytes`);
