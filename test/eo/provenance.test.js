const test = require('node:test');
const assert = require('node:assert');
const PR = require('../../services/eo/provenance');

test('ECDSA sign then verify round-trips; tamper is detected', () => {
  const payload = {
    level: 'high',
    sensorsUsed: ['VIIRS NOAA-20', 'CAMS'],
    predictions: [{ hazard: 'flood', likelihood: 'high' }],
    perHazard: [{ axis: 'flood', level: 'high' }],
  };
  const receipt = PR.sign(payload);
  assert.strictEqual(receipt.alg, 'ES256');
  assert.ok(receipt.sig && receipt.inputsHash);
  assert.strictEqual(PR.verify(payload, receipt).valid, true);
  const tampered = { ...payload, level: 'severe' };
  assert.strictEqual(PR.verify(tampered, receipt).valid, false);
});

test('publicKeyJwk exports an EC P-256 public key the browser can import', () => {
  const jwk = PR.publicKeyJwk();
  assert.strictEqual(jwk.kty, 'EC');
  assert.strictEqual(jwk.crv, 'P-256');
  assert.ok(jwk.x && jwk.y);
});

test('verify reports stale beyond ttl', () => {
  const payload = { level: 'ok' };
  const receipt = PR.sign(payload);
  receipt.ts -= 7200000; // 2h ago (also breaks the signature, which is correct)
  const r = PR.verify(payload, receipt, null, 3600000);
  assert.strictEqual(r.stale, true);
});

test('stableStringify is order-independent', () => {
  assert.strictEqual(PR.stableStringify({ b: 1, a: 2 }), PR.stableStringify({ a: 2, b: 1 }));
});

test('sequential receipts form an unbroken tamper-evident chain', () => {
  const r1 = PR.sign({ level: 'ok', sensorsUsed: ['a'], predictions: [], perHazard: [] });
  const r2 = PR.sign({ level: 'elevated', sensorsUsed: ['a'], predictions: [], perHazard: [] });
  const r3 = PR.sign({ level: 'high', sensorsUsed: ['a'], predictions: [], perHazard: [] });
  assert.strictEqual(r2.prevHash, r1.receiptHash);
  assert.strictEqual(r3.prevHash, r2.receiptHash);
  assert.strictEqual(PR.verifyChain([r1, r2, r3]).ok, true);
});

test('reordering or deleting a warning breaks the chain', () => {
  const r1 = PR.sign({ level: 'ok', sensorsUsed: ['a'], predictions: [], perHazard: [] });
  const r2 = PR.sign({ level: 'high', sensorsUsed: ['a'], predictions: [], perHazard: [] });
  const r3 = PR.sign({ level: 'severe', sensorsUsed: ['a'], predictions: [], perHazard: [] });
  assert.strictEqual(PR.verifyChain([r1, r3, r2]).ok, false); // reordered
  assert.strictEqual(PR.verifyChain([r1, r3]).ok, false);     // r2 deleted
});
