const test = require('node:test');
const assert = require('node:assert');
const { mkSignal, AXES } = require('../../services/eo/signal');

test('AXES contains the seven hazard axes', () => {
  assert.deepStrictEqual(
    [...AXES].sort(),
    ['air', 'fire', 'flood', 'power', 'seismic', 'storm', 'vegetation']
  );
});

test('mkSignal clamps magnitude and confidence to 0..1', () => {
  const s = mkSignal({ axis: 'fire', magnitude: 5, confidence: -2, sensor: 'X', distanceKm: 3 });
  assert.strictEqual(s.magnitude, 1);
  assert.strictEqual(s.confidence, 0);
  assert.strictEqual(s.axis, 'fire');
  assert.ok(typeof s.freshness === 'number');
});

test('mkSignal rejects an unknown axis', () => {
  assert.throws(() => mkSignal({ axis: 'nope', magnitude: 0.5, sensor: 'X', distanceKm: 1 }));
});
