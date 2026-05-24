const test = require('node:test');
const assert = require('node:assert');
const P = require('../../services/eo/predict');

test('predictFlood flags a rising-discharge + heavy-rain onset', () => {
  const flood = { daily: { river_discharge: [10, 14, 22, 38, 60, 55, 40] } };
  const weather = { hourly: { precipitation: Array(48).fill(2) } }; // 96mm/48h
  const p = P.predictFlood(flood, weather);
  assert.strictEqual(p.hazard, 'flood');
  assert.strictEqual(p.likelihood, 'high');
  assert.ok(p.etaHours >= 0 && /discharge/i.test(p.reasoning));
});

test('predictFlood returns null when calm', () => {
  assert.strictEqual(P.predictFlood({ daily: { river_discharge: [10, 10, 10] } }, { hourly: { precipitation: [0, 0] } }), null);
});

test('predictStorm finds the peak-gust ETA', () => {
  const weather = { hourly: { time: ['t0','t1','t2','t3'], wind_gusts_10m: [20, 30, 95, 40], cape: [100, 200, 2600, 300], precipitation: [0,0,5,1] } };
  const p = P.predictStorm(weather);
  assert.strictEqual(p.hazard, 'storm');
  assert.strictEqual(p.etaHours, 2);
  assert.ok(['moderate','high'].includes(p.likelihood));
});

test('predictAir flags worsening AQI', () => {
  const aq = { hourly: { us_aqi: [60, 90, 140, 180, 175] } };
  const p = P.predictAir(aq);
  assert.strictEqual(p.hazard, 'air');
  assert.ok(['moderate','high'].includes(p.likelihood));
});

test('predictHeat flags a hot forecast day', () => {
  const weather = { daily: { time: ['d0','d1','d2'], temperature_2m_max: [33, 41, 44] } };
  const p = P.predictHeat(weather);
  assert.strictEqual(p.hazard, 'heat');
  assert.ok(p.etaHours >= 24);
});

test('predictFireSpread fires only with active fire + dry strong wind', () => {
  const assessment = { perHazard: [{ axis: 'fire', magnitude: 0.5, confidence: 0.9 }] };
  const weather = { hourly: { wind_speed_10m: [35, 38], relative_humidity_2m: [25, 22] } };
  const yes = P.predictFireSpread(assessment, weather);
  assert.strictEqual(yes.hazard, 'fire');
  assert.ok(['moderate','high'].includes(yes.likelihood));
  const noFire = P.predictFireSpread({ perHazard: [] }, weather);
  assert.strictEqual(noFire, null);
});
