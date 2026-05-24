const test = require('node:test');
const assert = require('node:assert');
const D = require('../../services/eo/divergence');

test('jsDivergence is ~0 for identical, higher for opposite', () => {
  assert.ok(D.jsDivergence(0.8, 0.8) < 1e-6);
  assert.ok(D.jsDivergence(0.05, 0.95) > 0.5);
});

test('analyzeAxis flags consensus vs blindspot', () => {
  const consensus = D.analyzeAxis('air', [{ sensor: 'a', magnitude: 0.7 }, { sensor: 'b', magnitude: 0.72 }]);
  assert.strictEqual(consensus.flag, 'consensus');
  const blind = D.analyzeAxis('flood', [{ sensor: 'a', magnitude: 0.05 }, { sensor: 'b', magnitude: 0.9 }]);
  assert.ok(['blindspot', 'suspect'].includes(blind.flag));
  assert.ok(blind.divergence > consensus.divergence);
});

test('analyzeAxis with a single sensor reports flag single', () => {
  const one = D.analyzeAxis('fire', [{ sensor: 'a', magnitude: 0.5 }]);
  assert.strictEqual(one.flag, 'single');
  assert.strictEqual(one.divergence, 0);
});
