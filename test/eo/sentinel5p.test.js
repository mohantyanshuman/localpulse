const test = require('node:test');
const assert = require('node:assert');
const { toSignal } = require('../../services/eo/adapters/sentinel5p');

test('toSignal maps aerosol index to an air signal', () => {
  const s = toSignal(2.0, { lat: 1, lng: 1 });
  assert.strictEqual(s.axis, 'air');
  assert.ok(s.magnitude > 0.6, `AI 2.0 should be high, got ${s.magnitude}`);
  assert.strictEqual(s.sensor, 'Sentinel-5P TROPOMI');
});

test('toSignal returns null when no value', () => {
  assert.strictEqual(toSignal(null, { lat: 1, lng: 1 }), null);
});
