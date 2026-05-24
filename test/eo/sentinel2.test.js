const test = require('node:test');
const assert = require('node:assert');
const { toSignal } = require('../../services/eo/adapters/sentinel2');

test('low NDVI yields higher vegetation-stress magnitude', () => {
  const dry = toSignal(0.1, { lat: 1, lng: 1 });
  const lush = toSignal(0.8, { lat: 1, lng: 1 });
  assert.strictEqual(dry.axis, 'vegetation');
  assert.ok(dry.magnitude > lush.magnitude, 'drier should score higher');
  assert.ok(lush.magnitude < 0.3);
});

test('toSignal returns null when no value', () => {
  assert.strictEqual(toSignal(null, { lat: 1, lng: 1 }), null);
});
