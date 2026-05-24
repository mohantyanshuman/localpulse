const test = require('node:test');
const assert = require('node:assert');
const PR = require('../../services/eo/provenance');

test('sign then verify round-trips; tamper is detected', () => {
  const payload = { level: 'high', sensorsUsed: ['VIIRS NOAA-20', 'CAMS'], predictions: [{ hazard: 'flood', likelihood: 'high' }] };
  const receipt = PR.sign(payload, 'secret-key');
  assert.ok(receipt.sig && receipt.inputsHash);
  assert.strictEqual(PR.verify(payload, receipt, 'secret-key').valid, true);
  const tampered = { ...payload, level: 'severe' };
  assert.strictEqual(PR.verify(tampered, receipt, 'secret-key').valid, false);
});

test('verify reports stale beyond ttl', () => {
  const receipt = PR.sign({ level: 'ok' }, 'k');
  receipt.ts -= 7200000; // 2h ago
  const r = PR.verify({ level: 'ok' }, receipt, 'k', 3600000);
  assert.strictEqual(r.stale, true);
});
