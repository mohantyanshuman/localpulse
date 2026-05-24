const test = require('node:test');
const assert = require('node:assert');
const dss = require('../../services/dss');

test('mergeEo raises DSS level when a severe satellite axis is present', () => {
  const base = { level: 'ok', score: 1, recommendations: [], headline: { en: 'Calm' } };
  const eo = { level: 'severe', perHazard: [{ axis: 'fire', level: 'severe', confidence: 0.9, magnitude: 0.85, sensorsUsed: ['VIIRS NOAA-20'], gapNote: 'x' }], sensorsUsed: ['VIIRS NOAA-20'] };
  const merged = dss.mergeEo(base, eo);
  assert.strictEqual(merged.level, 'severe');
  assert.ok(merged.recommendations.some((r) => /fire/i.test(r.text || r)));
  assert.ok(merged.satellite, 'merged carries a satellite summary');
});

test('mergeEo is a no-op when eo is null', () => {
  const base = { level: 'ok', score: 1, recommendations: [], headline: { en: 'Calm' } };
  assert.deepStrictEqual(dss.mergeEo(base, null), base);
});
