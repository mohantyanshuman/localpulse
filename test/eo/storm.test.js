const test = require('node:test');
const assert = require('node:assert');
const { toSignal } = require('../../services/eo/adapters/storm');

test('high gusts and CAPE produce a high storm magnitude', () => {
  const s = toSignal({ current: { wind_gusts_10m: 90, precipitation: 5, time: '2026-05-24T08:00' }, hourly: { cape: [2500] } }, { lat: 1, lng: 1 });
  assert.strictEqual(s.axis, 'storm');
  assert.ok(s.magnitude > 0.6, `severe gusts should score high, got ${s.magnitude}`);
});

test('calm conditions produce low magnitude', () => {
  const s = toSignal({ current: { wind_gusts_10m: 10, precipitation: 0, time: '2026-05-24T08:00' }, hourly: { cape: [100] } }, { lat: 1, lng: 1 });
  assert.ok(s.magnitude < 0.2);
});

test('toSignal returns null when no current block', () => {
  assert.strictEqual(toSignal({}, { lat: 1, lng: 1 }), null);
});
