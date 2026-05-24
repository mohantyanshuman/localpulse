const test = require('node:test');
const assert = require('node:assert');
const O = require('../../public/js/eo-offline');

test('recomputeLevel is confidence-weighted (offline parity with server)', () => {
  const lone = O.recomputeLevel([{ axis: 'vegetation', magnitude: 0.85, confidence: 0.5 }]);
  assert.ok(['ok', 'elevated'].includes(lone));
  const strong = O.recomputeLevel([{ axis: 'fire', magnitude: 0.7, confidence: 0.9 }]);
  assert.ok(['high', 'severe'].includes(strong));
});

test('ageLabel describes staleness', () => {
  assert.match(O.ageLabel(Date.now() - 120000), /min/);
});
