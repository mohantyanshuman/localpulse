const test = require('node:test');
const assert = require('node:assert');
const { toSignal } = require('../../services/eo/adapters/openmeteo-air');

test('toSignal maps US AQI into an air signal with scaled magnitude', () => {
  const s = toSignal({ current: { us_aqi: 180, pm2_5: 90, time: '2026-05-24T08:00' } }, { lat: 1, lng: 1 });
  assert.strictEqual(s.axis, 'air');
  assert.ok(s.magnitude > 0.5, `expected unhealthy magnitude, got ${s.magnitude}`);
  assert.strictEqual(s.detail.us_aqi, 180);
});

test('toSignal returns null when no current block', () => {
  assert.strictEqual(toSignal({}, { lat: 1, lng: 1 }), null);
});
