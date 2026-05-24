const test = require('node:test');
const assert = require('node:assert');
const O = require('../../public/js/eo-offline');
const PR = require('../../services/eo/provenance');

test('recomputeLevel is confidence-weighted (offline parity with server)', () => {
  const lone = O.recomputeLevel([{ axis: 'vegetation', magnitude: 0.85, confidence: 0.5 }]);
  assert.ok(['ok', 'elevated'].includes(lone));
  const strong = O.recomputeLevel([{ axis: 'fire', magnitude: 0.7, confidence: 0.9 }]);
  assert.ok(['high', 'severe'].includes(strong));
});

test('ageLabel describes staleness', () => {
  assert.match(O.ageLabel(Date.now() - 120000), /min/);
});

test('canonical matches the server provenance canonicalization', () => {
  const payload = { level: 'high', sensorsUsed: ['b', 'a'], predictions: [{ hazard: 'flood' }], perHazard: [{ axis: 'flood', level: 'high' }] };
  assert.strictEqual(O.canonical(payload), PR.canonical(payload));
});

test('WebCrypto verifies a Node-signed ECDSA receipt (cross-stack, offline path)', async () => {
  const payload = {
    level: 'severe',
    sensorsUsed: ['VIIRS NOAA-20', 'CAMS', 'Sentinel-5P TROPOMI'],
    predictions: [{ hazard: 'flood', likelihood: 'high' }],
    perHazard: [{ axis: 'flood', level: 'high', magnitude: 0.7, confidence: 0.8 }],
  };
  const receipt = PR.sign(payload);
  const jwk = PR.publicKeyJwk();
  const ok = await O.verifyReceipt(payload, receipt, jwk);
  assert.strictEqual(ok.valid, true, 'genuine receipt must verify via WebCrypto');
  const tampered = { ...payload, level: 'ok' };
  const bad = await O.verifyReceipt(tampered, receipt, jwk);
  assert.strictEqual(bad.valid, false, 'tampered payload must fail verification');
});
