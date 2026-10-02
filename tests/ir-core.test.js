const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../assets/js/ir-core.js');

test('GTIN check digits: EAN-13, UPC-A and EAN-8 validate; a flipped digit does not', () => {
  assert.equal(core.isValidGtin('9556001234560'), false);
  assert.equal(core.isValidGtin('4006381333931'), true);   // EAN-13
  assert.equal(core.isValidGtin('036000291452'), true);    // UPC-A
  assert.equal(core.isValidGtin('96385074'), true);        // EAN-8
  assert.equal(core.isValidGtin('4006381333932'), false);
  assert.equal(core.isValidGtin('4006 3813 3393 1'), true, 'spaces are ignored');
  assert.equal(core.isValidGtin('40063813339'), false, 'eleven digits is not a GTIN');
  assert.equal(core.isValidGtin('ABC'), false);
  assert.equal(core.isValidGtin(null), false);
});

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

test('a survey item is complete only when barcode, width and height are all valid', () => {
  assert.equal(core.surveyStatus({ barcode: '4006381333931', width: '8', height: '20' }), 'completed');
  assert.equal(core.surveyStatus({ barcode: '4006381333932', width: '8', height: '20' }), 'incomplete');
  assert.equal(core.surveyStatus({ barcode: '4006381333931', width: '', height: '20' }), 'incomplete');
  assert.equal(core.surveyStatus(null), 'incomplete');
});

test('compliance is judged against the hurdle rate', () => {
  assert.deepEqual(core.compliance(17, 20, 80), { pct: 85, pass: true, gap: -5 });
  assert.deepEqual(core.compliance(14, 20, 80), { pct: 70, pass: false, gap: 10 });
  assert.equal(core.compliance(25, 20, 80).pct, 100, 'found never exceeds expected');
  assert.equal(core.compliance(3, 0, 80).pass, false);
});

test('bulk selection toggles and never exceeds the ceiling', () => {
  let sel = [];
  sel = core.toggleSelection(sel, 'a');
  sel = core.toggleSelection(sel, 'b');
  assert.deepEqual(sel, ['a', 'b']);
  sel = core.toggleSelection(sel, 'a');
  assert.deepEqual(sel, ['b']);
  const full = core.toggleSelection(['x', 'y'], 'z', 2);
  assert.deepEqual(full, ['x', 'y']);
  assert.equal(core.BULK_MAX, 200);
});

test('verdicts apply to pending lines only, and only approvals move the KPI tiles', () => {
  const lines = [
    { id: 'l1', kpi: 'osa', restores: 6 },
    { id: 'l2', kpi: 'sos', restores: 4 },
    { id: 'l3', kpi: 'osa', restores: 3, verdict: 'reject' }
  ];
  const approved = core.applyVerdict(lines, ['l1', 'l3'], 'approve');
  assert.equal(approved[0].verdict, 'approve');
  assert.equal(approved[2].verdict, 'reject', 'an already judged line keeps its verdict');
  assert.equal(lines[0].verdict, undefined, 'input is not mutated');
  const kpis = core.kpisAfter({ osa: 78, sos: 41 }, approved);
  assert.deepEqual(kpis, { osa: 84, sos: 41 });
  assert.deepEqual(core.tally(approved), { pending: 1, approve: 1, reject: 1 });
  assert.equal(core.kpisAfter({ osa: 98 }, [{ id: 'x', kpi: 'osa', restores: 9, verdict: 'approve' }]).osa, 100, 'capped at 100');
  assert.throws(() => core.applyVerdict(lines, ['l1'], 'maybe'));
});
