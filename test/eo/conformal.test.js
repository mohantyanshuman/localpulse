const test = require('node:test');
const assert = require('node:assert');
const C = require('../../services/eo/conformal');
const predlog = require('../../services/eo/predlog');

test('quantile returns the split-conformal (1-alpha) nonconformity threshold', () => {
  const scores = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  const q = C.conformalQuantile(scores, 0.1); // 90% coverage
  assert.ok(q >= 0.9 && q <= 1.0);
});

test('interval is honest: calibrated:false when below min calibration size', () => {
  const r = C.interval(0.6, [0.1, 0.2], 0.1);
  assert.strictEqual(r.calibrated, false);
  assert.ok(r.low <= 0.6 && r.high >= 0.6);
});

test('interval is calibrated with enough samples', () => {
  const scores = Array.from({ length: 60 }, (_, i) => ((i + 1) / 60) * 0.5);
  const r = C.interval(0.6, scores, 0.1);
  assert.strictEqual(r.calibrated, true);
  assert.ok(r.high - r.low > 0);
});

test('predlog records, attaches outcomes, and yields nonconformity scores', () => {
  predlog._reset();
  predlog.record({ cell: '1,1', hazard: 'flood', pred: 0.8 });
  predlog.record({ cell: '1,1', hazard: 'flood', pred: 0.4 });
  predlog.attachOutcome('1,1', 'flood', 0.5);
  const s = predlog.scores('flood');
  assert.strictEqual(s.length, 2);
  assert.ok(s.every((x) => x >= 0 && x <= 1));
});
