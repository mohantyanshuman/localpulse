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
  assert.strictEqual(confirm.confirm({ observedMag: 0.8, sensorCount: 1 }).occurred, false); // lone sensor != confirmed
  assert.strictEqual(confirm.confirm({ observedMag: 0.8, sensorCount: 2 }).occurred, true);
  assert.ok(confirm.confirm({ observedMag: 0.8, sensorCount: 3 }).confidence >= confirm.confirm({ observedMag: 0.8, sensorCount: 2 }).confidence);
  assert.strictEqual(confirm.closeness(0.7, 0.7), 1);
});

test('Platt recalibration LEARNS to reduce Brier on overconfident forecasts', () => {
  let params = { a: 1, b: 0 };
  const outcomes = [];
  for (let i = 0; i < 400; i++) { const o = (i % 10 < 3) ? 1 : 0; outcomes.push(o); params = skill.updateParams(params, [{ p: 0.8, outcome: o }]); }
  const rawBrier = skill.brier(outcomes.map(() => 0.8), outcomes);
  const calBrier = skill.brier(outcomes.map(() => skill.calibrate(0.8, params)), outcomes);
  assert.ok(calBrier < rawBrier, `calibrated ${calBrier} should beat raw ${rawBrier}`);
});

test('ENSEMBLE: a calibrating engine overtakes the identity baseline; closeness tracked', () => {
  world._reset();
  for (let i = 0; i < 120; i++) {
    const cell = 'c' + i;
    world.recordForecast('flood', cell, 0.8);          // overconfident raw forecast
    const occur = (i % 10 < 3);                          // event only ~30% of the time
    world.observe('flood', cell, { observedMag: occur ? 0.7 : 0.2, sensorCount: 2 });
  }
  const r = world.report().hazards.flood;
  assert.ok(r.n >= 120);
  assert.strictEqual(r.engines, world.ENGINES.length);
  assert.notStrictEqual(r.leader, 'identity', 'a recalibrating engine should win over the baseline');
  const identity = r.members.find((m) => m.name === 'identity');
  assert.ok(r.leaderBrier < identity.brier, `leader ${r.leaderBrier} must beat identity ${identity.brier}`);
  assert.ok(r.closeness > 0 && r.closeness <= 1);
});

test('ensemble state is durable via serialize/load', () => {
  world._reset();
  for (let i = 0; i < 25; i++) { const cell = 'd' + i; world.recordForecast('air', cell, 0.6); world.observe('air', cell, { observedMag: 0.6, sensorCount: 2 }); }
  const snap = world.serialize();
  world._reset();
  world.load(snap);
  const r = world.report().hazards.air;
  assert.ok(r.n >= 25);
  assert.strictEqual(r.engines, world.ENGINES.length);
});

test('observeFromMagnitude stays backward-compatible', () => {
  world._reset();
  world.recordForecast('fire', 'x', 0.6);
  assert.strictEqual(world.observeFromMagnitude('fire', 'x', confirm.EVENT_MAG + 0.1, 2), true);
  assert.strictEqual(world.observeFromMagnitude('fire', 'x', 0.9, 2), false); // nothing pending
});
