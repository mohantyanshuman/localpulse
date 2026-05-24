const test = require('node:test');
const assert = require('node:assert');
const { toSignal } = require('../../services/eo/adapters/power');

test('toSignal sums recent precipitation into a flood signal', () => {
  const j = { properties: { parameter: { PRECTOTCORR: { '20260522': 40, '20260523': 70, '20260524': 30 } } } };
  const s = toSignal(j, { lat: 1, lng: 1 });
  assert.strictEqual(s.axis, 'flood');
  assert.strictEqual(s.detail.totalMm, 140);
  assert.ok(s.magnitude > 0.5, `heavy multi-day rain should be elevated, got ${s.magnitude}`);
});

test('toSignal ignores POWER fill value -999', () => {
  const j = { properties: { parameter: { PRECTOTCORR: { '20260524': -999 } } } };
  const s = toSignal(j, { lat: 1, lng: 1 });
  assert.strictEqual(s.detail.totalMm, 0);
});
