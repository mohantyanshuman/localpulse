const test = require('node:test');
const assert = require('node:assert');
const { toSignal } = require('../../services/eo/adapters/sentinel5p-co');

test('high CO column yields a higher air magnitude', () => {
  const hi = toSignal(0.08, { lat: 1, lng: 1 });
  const lo = toSignal(0.03, { lat: 1, lng: 1 });
  assert.strictEqual(hi.axis, 'air');
  assert.ok(hi.magnitude > lo.magnitude);
  assert.strictEqual(hi.sensor, 'Sentinel-5P TROPOMI (CO)');
});

test('returns null when no value', () => {
  assert.strictEqual(toSignal(null, { lat: 1, lng: 1 }), null);
});
