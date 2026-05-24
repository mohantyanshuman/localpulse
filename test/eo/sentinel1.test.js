const test = require('node:test');
const assert = require('node:assert');
const { toSignal } = require('../../services/eo/adapters/sentinel1');

test('low VV backscatter (water) yields higher flood magnitude', () => {
  const wet = toSignal(-20, { lat: 1, lng: 1 });
  const dry = toSignal(-5, { lat: 1, lng: 1 });
  assert.strictEqual(wet.axis, 'flood');
  assert.ok(wet.magnitude > dry.magnitude, 'smoother (lower dB) = more water');
});

test('toSignal returns null when no value', () => {
  assert.strictEqual(toSignal(null, { lat: 1, lng: 1 }), null);
});
