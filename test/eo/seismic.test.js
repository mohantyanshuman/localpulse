const test = require('node:test');
const assert = require('node:assert');
const { toSignals } = require('../../services/eo/adapters/seismic');

const GEO = { features: [
  { properties: { mag: 5.4, time: 1748000000000, place: '10km N of X' }, geometry: { coordinates: [77.0, 30.95, 10] } },
  { properties: { mag: 2.6, time: 1748000000000, place: '5km S of Y' }, geometry: { coordinates: [77.1, 31.5, 8] } },
] };

test('toSignals keeps the strongest nearby quake and scales magnitude by Richter', () => {
  const sigs = toSignals(GEO, { lat: 30.91, lng: 77.10 }, 350);
  assert.ok(sigs.length >= 1);
  assert.strictEqual(sigs[0].axis, 'seismic');
  // M5.4 should be high magnitude
  assert.ok(sigs[0].magnitude > 0.6, `M5.4 should be high, got ${sigs[0].magnitude}`);
});
