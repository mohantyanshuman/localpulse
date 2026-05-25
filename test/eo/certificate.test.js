const test = require('node:test');
const assert = require('node:assert');
const cert = require('../../services/eo/certificate');

const body = {
  level: 'high',
  sensorsUsed: ['VIIRS NOAA-20', 'CAMS (Sentinel-5P assimilated)'],
  predictions: [{ hazard: 'flood', likelihood: 'high' }],
  perHazard: [{ axis: 'flood', level: 'high', magnitude: 0.7, confidence: 0.8 }],
  location: { lat: 18.43, lng: 102.02, place: 'Test' },
};

test('issued certificate is self-contained and self-verifies', () => {
  const c = cert.issue(body);
  assert.strictEqual(c.kind, 'localpulse-warning-certificate');
  assert.ok(c.publicKeyJwk && c.publicKeyJwk.kty === 'EC');
  assert.ok(c.receipt && c.receipt.sig && c.receipt.receiptHash);
  const r = cert.verifyCertificate(c);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.chainOk, true);
});

test('tampering the level invalidates the certificate', () => {
  const c = cert.issue(body);
  c.level = 'ok';
  assert.strictEqual(cert.verifyCertificate(c).valid, false);
});

test('tampering the location invalidates the certificate', () => {
  const c = cert.issue(body);
  c.location = { lat: 0, lng: 0 };
  assert.strictEqual(cert.verifyCertificate(c).valid, false);
});

test('a non-certificate object is rejected', () => {
  assert.strictEqual(cert.verifyCertificate({}).valid, false);
  assert.strictEqual(cert.verifyCertificate({ kind: 'localpulse-warning-certificate' }).valid, false);
});
