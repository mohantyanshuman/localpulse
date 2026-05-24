const test = require('node:test');
const assert = require('node:assert');
const { toSignal } = require('../../services/eo/adapters/sentinel5p-no2');

test('high NO2 column yields a higher air magnitude', () => {
  const hi = toSignal(0.0002, { lat: 1, lng: 1 });
  const lo = toSignal(0.00002, { lat: 1, lng: 1 });
  assert.strictEqual(hi.axis, 'air');
  assert.ok(hi.magnitude > lo.magnitude);
  assert.strictEqual(hi.sensor, 'Sentinel-5P TROPOMI (NO2)');
});

test('returns null when no value', () => {
  assert.strictEqual(toSignal(null, { lat: 1, lng: 1 }), null);
});
