// Tamper-evident, OFFLINE-verifiable provenance for a prediction payload.
// Uses ECDSA P-256 (asymmetric): the server signs with a private key; any recipient
// device verifies with the PUBLIC key alone, with no network and no shared secret.
// This is the genuine technical effect: integrity + auditability of an automated
// hazard decision, checkable on-device offline. Signature is emitted in IEEE-P1363
// (r||s) form so the browser WebCrypto API can verify it directly.
const crypto = require('crypto');

// Deterministic, recursively key-sorted JSON so server and client canonicalize
// byte-identically regardless of property order.
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

// Only the integrity-relevant fields are bound by the signature.
function canonical(payload) {
  const pick = {
    level: payload.level,
    sensorsUsed: payload.sensorsUsed,
    predictions: payload.predictions,
    perHazard: payload.perHazard,
  };
  return stableStringify(pick);
}

function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

const MODEL = 'eo-2';
let KP = null;

function keypair() {
  if (KP) return KP;
  let pem = process.env.EO_SIGNING_KEY;
  // Accept either a raw PEM or a single-line base64-encoded PEM (env-file friendly).
  if (pem && !pem.includes('BEGIN')) { try { pem = Buffer.from(pem, 'base64').toString('utf8'); } catch { /* keep as-is */ } }
  try {
    if (pem) {
      const priv = crypto.createPrivateKey(pem);
      const pub = crypto.createPublicKey(priv);
      KP = { priv, pub };
      return KP;
    }
  } catch { /* fall through to ephemeral */ }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  KP = { priv: privateKey, pub: publicKey };
  return KP;
}

// Public key as JWK, for the browser to import and verify with.
function publicKeyJwk() {
  return keypair().pub.export({ format: 'jwk' });
}

function message(canon, model, ts) { return `${canon}|${model}|${ts}`; }

function sign(payload) {
  const canon = canonical(payload);
  const ts = Date.now();
  const msg = message(canon, MODEL, ts);
  const sig = crypto.sign('sha256', Buffer.from(msg), { key: keypair().priv, dsaEncoding: 'ieee-p1363' });
  return { alg: 'ES256', model: MODEL, ts, inputsHash: sha256hex(canon), sig: sig.toString('base64') };
}

// Server-side verify (mirrors the browser path). pubKey optional (defaults to ours).
function verify(payload, receipt, pubKey, ttlMs = 3600000) {
  if (!receipt || !receipt.sig) return { valid: false, stale: false };
  const canon = canonical(payload);
  const msg = message(canon, receipt.model, receipt.ts);
  const key = pubKey || keypair().pub;
  let valid = false;
  try {
    valid = crypto.verify('sha256', Buffer.from(msg), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(receipt.sig, 'base64'));
  } catch { valid = false; }
  return { valid, stale: Date.now() - receipt.ts > ttlMs };
}

module.exports = { sign, verify, canonical, stableStringify, publicKeyJwk, MODEL };
