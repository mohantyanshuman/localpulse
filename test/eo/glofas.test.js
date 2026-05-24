const test = require('node:test');
const assert = require('node:assert');
const { toSignal } = require('../../services/eo/adapters/glofas');

test('a discharge surge above baseline yields elevated flood magnitude', () => {
  const s = toSignal({ daily: { river_discharge: [10, 11, 12, 40, 55] } }, { lat: 1, lng: 1 });
  assert.strictEqual(s.axis, 'flood');
  assert.ok(s.magnitude > 0.5, `surge should be elevated, got ${s.magnitude}`);
});

test('flat discharge yields low magnitude', () => {
  const s = toSignal({ daily: { river_discharge: [10, 10, 10, 10, 10] } }, { lat: 1, lng: 1 });
  assert.ok(s.magnitude < 0.2);
});

test('returns null without discharge data', () => {
  assert.strictEqual(toSignal({ daily: {} }, { lat: 1, lng: 1 }), null);
});
