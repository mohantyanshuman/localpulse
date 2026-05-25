const test = require('node:test');
const assert = require('node:assert');
const R = require('../../services/eo/route');

test('sampleWaypoints includes both endpoints and scales with distance', () => {
  const from = { lat: 30.90, lng: 77.10 };
  const to = { lat: 30.98, lng: 77.20 };
  const pts = R.sampleWaypoints(from, to, 2);
  assert.deepStrictEqual(pts[0], { lat: 30.9, lng: 77.1 });
  assert.ok(Math.abs(pts[pts.length - 1].lat - 30.98) < 1e-6);
  assert.ok(pts.length >= 3);
});

test('classifyPoint: a projected fire front reaching the path is NO_GO', () => {
  assert.strictEqual(R.classifyPoint({ fireMarginKm: -0.5 }).level, 'NO_GO');
  assert.strictEqual(R.classifyPoint({ fireMarginKm: 2 }).level, 'CAUTION');
  assert.strictEqual(R.classifyPoint({ fireMarginKm: 25 }).level, 'GO');
});

test('classifyPoint flags heavy rain (worse on low ground) and damaging wind', () => {
  assert.strictEqual(R.classifyPoint({ precipMm: 35 }).level, 'NO_GO');
  assert.strictEqual(R.classifyPoint({ precipMm: 15, lowLying: true }).level, 'NO_GO');
  assert.strictEqual(R.classifyPoint({ precipMm: 11 }).level, 'CAUTION');
  assert.strictEqual(R.classifyPoint({ gustKmh: 95 }).level, 'NO_GO');
});

test('latency projection: an OLD fire detection grows the danger zone to reach the path', () => {
  // Fire ~4 km away. Fresh => path clear; hours old => projected front reaches the path.
  const wps = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.05 }]; // ~5.5 km segment
  const fireNear = { lat: 0, lng: 0.036 }; // ~4 km from origin
  const weather = [{ precip: 0, gust: 40, rh: 15 }, { precip: 0, gust: 40, rh: 15 }]; // dry + windy => fast spread
  const elev = [1000, 1000];
  const fresh = R.buildSegments(wps, [{ ...fireNear, ageMin: 0 }], weather, elev, 5);
  const old = R.buildSegments(wps, [{ ...fireNear, ageMin: 300 }], weather, elev, 30); // 5 h old
  assert.ok(R.overallVerdict(old) === 'NO_GO' || R.overallVerdict(old) === 'CAUTION');
  assert.ok(RANK(R.overallVerdict(old)) >= RANK(R.overallVerdict(fresh)), 'older data must never be safer');
  function RANK(v) { return { GO: 0, CAUTION: 1, NO_GO: 2 }[v]; }
});

test('freshnessConfidence is conservative: stale or absent data lowers confidence', () => {
  assert.ok(R.freshnessConfidence(30, true).confidence > R.freshnessConfidence(400, true).confidence);
  const absent = R.freshnessConfidence(Infinity, false);
  assert.ok(absent.confidence <= 0.5);
  assert.match(absent.note, /NOT a guarantee/i);
});
