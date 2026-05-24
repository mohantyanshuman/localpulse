const test = require('node:test');
const assert = require('node:assert');
const P = require('../../services/eo/physics');

test('fireRateOfSpread rises with wind, dryness, and upslope', () => {
  const calm = P.fireRateOfSpread({ drynessP: 0.3, windKmh: 5, slopeDeg: 0 });
  const extreme = P.fireRateOfSpread({ drynessP: 0.9, windKmh: 45, slopeDeg: 20 });
  assert.ok(extreme.rosMPerMin > calm.rosMPerMin);
  assert.ok(extreme.reachKm1h > 0);
});

test('floodOnsetFactor is higher for steep terrain + intense rain', () => {
  const flat = P.floodOnsetFactor({ rainMmPerH: 5, slopeDeg: 1 });
  const steep = P.floodOnsetFactor({ rainMmPerH: 30, slopeDeg: 15 });
  assert.ok(steep > flat && steep <= 1);
});

test('slopeFromRing computes a non-negative slope from elevation samples', () => {
  const s = P.slopeFromRing(1000, [1000, 1100, 1000, 900], 1.0);
  assert.ok(s.slopeDeg >= 0 && Number.isFinite(s.aspectDeg));
});
