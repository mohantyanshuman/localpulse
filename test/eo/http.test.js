const test = require('node:test');
const assert = require('node:assert');
const { haversineKm } = require('../../services/eo/http');

test('haversineKm is ~0 for identical points', () => {
  assert.ok(haversineKm({ lat: 30.9, lng: 77.1 }, { lat: 30.9, lng: 77.1 }) < 0.001);
});

test('haversineKm matches a known distance (Delhi->Solan ~260km)', () => {
  const d = haversineKm({ lat: 28.61, lng: 77.21 }, { lat: 30.91, lng: 77.10 });
  assert.ok(d > 250 && d < 270, `expected ~260, got ${d}`);
});
