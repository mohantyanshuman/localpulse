const test = require('node:test');
const assert = require('node:assert');
const skill = require('../../services/eo/skill');
const confirm = require('../../services/eo/confirm');
const world = require('../../services/eo/world');

test('skill: brier and Platt calibration basics', () => {
  assert.strictEqual(skill.brier([1, 0], [1, 0]), 0);
  assert.ok(Math.abs(skill.calibrate(0.7, { a: 1, b: 0 }) - 0.7) < 0.02);
});

test('confirm requires cross-sensor corroboration and yields a continuous closeness', () => {
  assert.strictEqual(confirm.confirm({ observedMag: 0.8, sensorCount: 1 }).occurred, false);
  assert.strictEqual(confirm.confirm({ observedMag: 0.8, sensorCount: 2 }).occurred, true);
  assert.strictEqual(confirm.closeness(0.7, 0.7), 1);
});

test('Platt recalibration LEARNS to reduce Brier on overconfident forecasts', () => {
  let params = { a: 1, b: 0 };
  const outcomes = [];
  for (let i = 0; i < 400; i++) { const o = (i % 10 < 3) ? 1 : 0; outcomes.push(o); params = skill.updateParams(params, [{ p: 0.8, outcome: o }]); }
  const rawBrier = skill.brier(outcomes.map(() => 0.8), outcomes);
  const calBrier = skill.brier(outcomes.map(() => skill.calibrate(0.8, params)), outcomes);
  assert.ok(calBrier < rawBrier);
});

test('regionOf partitions the globe into climate-zone buckets', () => {
  assert.strictEqual(world.regionOf(30.9, 77.1), world.regionOf(31.0, 77.9)); // same 15deg bucket
  assert.notStrictEqual(world.regionOf(30.9, 77.1), world.regionOf(48.8, 2.3)); // Solan vs Paris differ
  assert.strictEqual(world.regionOf(NaN, NaN), 'GLOBAL');
});

test('ENSEMBLE per region: a calibrating engine overtakes identity; closeness + regions tracked', () => {
  world._reset();
  // train two distinct regions independently
  for (let i = 0; i < 80; i++) {
    world.recordForecast('flood', 'a' + i, 0.8, 30.9, 77.1);
    world.observe('flood', 'a' + i, { observedMag: (i % 10 < 3) ? 0.7 : 0.2, sensorCount: 2 }, 30.9, 77.1);
    world.recordForecast('flood', 'b' + i, 0.8, 48.8, 2.3);
    world.observe('flood', 'b' + i, { observedMag: (i % 10 < 3) ? 0.7 : 0.2, sensorCount: 2 }, 48.8, 2.3);
  }
  const r = world.report().hazards.flood;
  assert.ok(r.n >= 160);
  assert.strictEqual(r.regions, 2);             // two regions learned separately
  assert.notStrictEqual(r.bestEngine, 'identity');
  assert.ok(r.closeness > 0 && r.closeness <= 1);
  assert.strictEqual(r.engines, world.ENGINES.length);
});

test('per-region ensemble state is durable via serialize/load', () => {
  world._reset();
  for (let i = 0; i < 25; i++) { world.recordForecast('air', 'c' + i, 0.6, 28.6, 77.2); world.observe('air', 'c' + i, { observedMag: 0.6, sensorCount: 2 }, 28.6, 77.2); }
  const snap = world.serialize();
  world._reset();
  world.load(snap);
  assert.ok(world.report().hazards.air.n >= 25);
});
