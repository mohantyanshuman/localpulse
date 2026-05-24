const test = require('node:test');
const assert = require('node:assert');
const { toSignal } = require('../../services/eo/adapters/sentinel3');

test('very hot surface (kelvin) yields high heat magnitude', () => {
  const hot = toSignal(323, { lat: 1, lng: 1 });  // 50 C
  const mild = toSignal(295, { lat: 1, lng: 1 }); // 22 C
  assert.strictEqual(hot.axis, 'heat');
  assert.ok(hot.magnitude > mild.magnitude);
  assert.ok(hot.magnitude > 0.6);
});

test('returns null without a value', () => {
  assert.strictEqual(toSignal(null, { lat: 1, lng: 1 }), null);
});
