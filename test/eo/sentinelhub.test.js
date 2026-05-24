const test = require('node:test');
const assert = require('node:assert');
const { hasCreds, latestMean, bboxAround } = require('../../services/eo/sentinelhub');

test('hasCreds reflects env presence', () => {
  const prev = process.env.COPERNICUS_CLIENT_ID;
  delete process.env.COPERNICUS_CLIENT_ID;
  assert.strictEqual(hasCreds(), false);
  process.env.COPERNICUS_CLIENT_ID = 'x';
  process.env.COPERNICUS_CLIENT_SECRET = 'y';
  assert.strictEqual(hasCreds(), true);
  if (prev === undefined) { delete process.env.COPERNICUS_CLIENT_ID; delete process.env.COPERNICUS_CLIENT_SECRET; }
});

test('bboxAround builds a [w,s,e,n] box around a point', () => {
  const b = bboxAround(30.9, 77.1, 0.05);
  assert.deepStrictEqual(b, [77.05, 30.85, 77.15, 30.95]);
});

test('latestMean extracts the most recent interval mean from a stats response', () => {
  const resp = { data: [
    { interval: { from: '2026-05-20T00:00:00Z' }, outputs: { data: { bands: { B0: { stats: { mean: 1.1 } } } } } },
    { interval: { from: '2026-05-23T00:00:00Z' }, outputs: { data: { bands: { B0: { stats: { mean: 2.4 } } } } } },
  ] };
  assert.strictEqual(latestMean(resp), 2.4);
});

test('latestMean returns null on empty/garbage', () => {
  assert.strictEqual(latestMean({ data: [] }), null);
  assert.strictEqual(latestMean(null), null);
});
