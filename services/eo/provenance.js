// Tamper-evident, offline-verifiable provenance for a prediction payload.
// Receipt binds a canonical hash of the payload + sensor inputs, signed with HMAC.
const crypto = require('crypto');

function canonical(payload) {
  const pick = {
    level: payload.level,
    sensorsUsed: payload.sensorsUsed,
    predictions: payload.predictions,
    perHazard: payload.perHazard,
  };
  return JSON.stringify(pick, Object.keys(pick).sort());
}

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function sign(payload, secret = process.env.SYNC_SECRET || process.env.INGEST_TOKEN || 'localpulse-sync', model = 'eo-1') {
  const canon = canonical(payload);
  const inputsHash = sha256(canon);
  const ts = Date.now();
  const sig = crypto.createHmac('sha256', secret).update(`${inputsHash}.${model}.${ts}`).digest('hex');
  return { inputsHash, model, ts, sig };
}

function verify(payload, receipt, secret = process.env.SYNC_SECRET || process.env.INGEST_TOKEN || 'localpulse-sync', ttlMs = 3600000) {
  if (!receipt || !receipt.sig) return { valid: false, stale: false };
  const inputsHash = sha256(canonical(payload));
  const expected = crypto.createHmac('sha256', secret).update(`${inputsHash}.${receipt.model}.${receipt.ts}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(receipt.sig));
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b) && inputsHash === receipt.inputsHash;
  const stale = Date.now() - receipt.ts > ttlMs;
  return { valid, stale };
}

module.exports = { sign, verify, canonical };
