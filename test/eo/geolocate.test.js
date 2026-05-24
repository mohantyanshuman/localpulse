const test = require('node:test');
const assert = require('node:assert');
const { coarseFromHeaders } = require('../../services/geolocate');

test('coarseFromHeaders reads Cloudflare lat/lng headers', () => {
  const loc = coarseFromHeaders({ 'cf-iplatitude': '48.85', 'cf-iplongitude': '2.35', 'cf-ipcountry': 'FR' });
  assert.ok(Math.abs(loc.lat - 48.85) < 1e-6);
  assert.ok(Math.abs(loc.lng - 2.35) < 1e-6);
  assert.strictEqual(loc.source, 'edge');
});

test('coarseFromHeaders falls back when headers absent', () => {
  const loc = coarseFromHeaders({}, { lat: 20, lng: 0 });
  assert.strictEqual(loc.lat, 20);
  assert.strictEqual(loc.source, 'default');
});
