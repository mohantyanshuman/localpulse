const test = require('node:test');
const assert = require('node:assert');
const skill = require('../../services/eo/skill');
const world = require('../../services/eo/world');

test('brier and calibrate basics', () => {
  assert.strictEqual(skill.brier([1, 0], [1, 0]), 0);
  assert.ok(skill.brier([0.5, 0.5], [1, 0]) > 0);
  assert.ok(Math.abs(skill.calibrate(0.7, { a: 1, b: 0 }) - 0.7) < 0.02);
});

test('Platt recalibration LEARNS to reduce Brier on overconfident forecasts', () => {
  // Raw forecasts always say 0.8, but the event only occurs ~30% of the time.
  let params = { a: 1, b: 0 };
  const outcomes = [];
  for (let i = 0; i < 400; i++) {
    const o = (i % 10 < 3) ? 1 : 0;
    outcomes.push(o);
    params = skill.updateParams(params, [{ p: 0.8, outcome: o }]);
  }
  const rawBrier = skill.brier(outcomes.map(() => 0.8), outcomes);
  const calBrier = skill.brier(outcomes.map(() => skill.calibrate(0.8, params)), outcomes);
  assert.ok(calBrier < rawBrier, `calibrated Brier ${calBrier} should beat raw ${rawBrier}`);
  assert.ok(Math.abs(skill.calibrate(0.8, params) - 0.3) < 0.15, 'calibrated prob should approach observed 0.3');
});

test('world loop scores skill, reports it, and is durable via serialize/load', () => {
  world._reset();
  for (let i = 0; i < 50; i++) {
    const cell = 'c' + i;
    world.recordForecast('flood', cell, 0.85);
    world.observe('flood', cell, i % 5 === 0); // event ~20% of the time
  }
  const r = world.report();
  assert.strictEqual(r.hazards.flood.n, 50);
  assert.ok(Number.isFinite(r.hazards.flood.brier));
  assert.ok(r.hazards.flood.calibration && Number.isFinite(r.hazards.flood.calibration.a));
  // durable round-trip preserves learned params + running aggregates
  const snap = world.serialize();
  world._reset();
  world.load(snap);
  assert.strictEqual(world.report().hazards.flood.n, 50);
});

test('observeFromMagnitude maps observed magnitude to a binary event at EVENT_MAG', () => {
  world._reset();
  world.recordForecast('fire', 'x', 0.6);
  assert.strictEqual(world.observeFromMagnitude('fire', 'x', world.EVENT_MAG + 0.1), true);
  // no pending now
  assert.strictEqual(world.observeFromMagnitude('fire', 'x', 0.9), false);
});
