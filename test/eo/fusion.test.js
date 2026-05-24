const test = require('node:test');
const assert = require('node:assert');
const { _reset } = require('../../services/eo/cache');
const { fuseSignals, levelFromMagnitude } = require('../../services/eo/fusion');
const { mkSignal } = require('../../services/eo/signal');

test('levelFromMagnitude maps thresholds', () => {
  assert.strictEqual(levelFromMagnitude(0.1), 'ok');
  assert.strictEqual(levelFromMagnitude(0.35), 'elevated');
  assert.strictEqual(levelFromMagnitude(0.6), 'high');
  assert.strictEqual(levelFromMagnitude(0.85), 'severe');
});

test('fuseSignals boosts confidence when two sensors agree on an axis', () => {
  const signals = [
    mkSignal({ axis: 'fire', magnitude: 0.7, confidence: 0.7, sensor: 'VIIRS NOAA-20', distanceKm: 3 }),
    mkSignal({ axis: 'fire', magnitude: 0.6, confidence: 0.7, sensor: 'MODIS', distanceKm: 4 }),
  ];
  const out = fuseSignals(signals, []);
  const fire = out.perHazard.find((h) => h.axis === 'fire');
  assert.strictEqual(fire.sensorsUsed.length, 2);
  assert.ok(fire.confidence > 0.7, 'agreement should raise confidence');
  assert.match(fire.gapNote, /VIIRS NOAA-20|MODIS/);
  assert.strictEqual(out.level, 'high');
});

test('fuseSignals reports skipped adapter ids', () => {
  const out = fuseSignals([], ['firms']);
  assert.deepStrictEqual(out.skipped, ['firms']);
  assert.strictEqual(out.level, 'ok');
});

test('fuse skips Sentinel adapters when Copernicus creds are absent', async () => {
  const prevId = process.env.COPERNICUS_CLIENT_ID;
  const prevSecret = process.env.COPERNICUS_CLIENT_SECRET;
  delete process.env.COPERNICUS_CLIENT_ID;
  delete process.env.COPERNICUS_CLIENT_SECRET;
  const { fuse } = require('../../services/eo/fusion');
  const out = await fuse(0, 0);
  assert.ok(out.skipped.includes('sentinel5p'));
  assert.ok(out.skipped.includes('sentinel1'));
  assert.ok(out.skipped.includes('sentinel2'));
  if (prevId !== undefined) process.env.COPERNICUS_CLIENT_ID = prevId;
  if (prevSecret !== undefined) process.env.COPERNICUS_CLIENT_SECRET = prevSecret;
});
