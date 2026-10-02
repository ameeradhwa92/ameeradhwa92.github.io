const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../assets/js/ir-core.js');

test('centimetre input accepts the decimal comma and rejects out-of-range sizes', () => {
  assert.equal(core.parseCm('12.5'), 12.5);
  assert.equal(core.parseCm('12,5'), 12.5);
  assert.equal(core.parseCm(' 7 '), 7);
  assert.equal(core.parseCm('0.4'), null);
  assert.equal(core.parseCm('61'), null);
  assert.equal(core.parseCm('-3'), null);
  assert.equal(core.parseCm('1e1'), null);
  assert.equal(core.parseCm(''), null);
});

test('the pack keeps its proportions and its longest side always fits the frame', () => {
  const tall = core.packSize('8', '20', 2);
  assert.equal(tall.y, 2);
  assert.ok(Math.abs(tall.x - 0.8) < 1e-9);
  assert.ok(tall.z < tall.x, 'depth follows width');
  const wide = core.packSize('40', '10', 3);
  assert.equal(wide.x, 3);
  for (const size of [tall, wide]) {
    assert.ok(Math.max(size.x, size.y, size.z) <= 3 + 1e-9);
  }
  assert.equal(core.packSize('abc', '10'), null);
});

test('every sample pack is a valid size and the cycle wraps round', () => {
  assert.ok(core.SAMPLE_PACKS.length >= 3);
  for (const [w, h] of core.SAMPLE_PACKS) {
    assert.ok(core.packSize(String(w), String(h), 2), `${w} × ${h} is a usable size`);
  }
  assert.equal(core.nextPack(0), 1);
  assert.equal(core.nextPack(core.SAMPLE_PACKS.length - 1), 0);
  assert.equal(core.nextPack(-1), 0);
  assert.equal(core.nextPack('x'), 0);
});
