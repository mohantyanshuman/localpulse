const test = require('node:test');
const assert = require('node:assert');
const { parseCsv, rowsToSignals } = require('../../services/eo/adapters/firms');

const CSV = `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight
30.9100,77.1000,330.5,0.4,0.4,2026-05-24,0812,N,nominal,2.0NRT,295.1,12.4,D
31.5000,78.0000,360.0,0.4,0.4,2026-05-24,0813,N,high,2.0NRT,300.0,88.0,D`;

test('parseCsv returns row objects keyed by header', () => {
  const rows = parseCsv(CSV);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].latitude, '30.9100');
  assert.strictEqual(rows[1].confidence, 'high');
});

test('rowsToSignals keeps fires within radius and scales magnitude by FRP', () => {
  const rows = parseCsv(CSV);
  const sigs = rowsToSignals(rows, { lat: 30.91, lng: 77.10 }, 'VIIRS NOAA-20', 60);
  // first row is ~0km away (kept), second is >60km away (dropped)
  assert.strictEqual(sigs.length, 1);
  assert.strictEqual(sigs[0].axis, 'fire');
  assert.strictEqual(sigs[0].sensor, 'VIIRS NOAA-20');
  assert.ok(sigs[0].magnitude > 0 && sigs[0].magnitude <= 1);
});
