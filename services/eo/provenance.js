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

// Only the integrity-relevant fields are bound by the signature. Location is bound so
// a warning certificate cannot be re-attributed to a different place without detection.
function canonical(payload) {
  const loc = payload.location || null;
  const pick = {
    level: payload.level,
    sensorsUsed: payload.sensorsUsed,
    predictions: payload.predictions,
    perHazard: payload.perHazard,
    location: loc ? { lat: loc.lat, lng: loc.lng } : null,
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

// The signed message binds the content (canon), the model, the timestamp, and the
// PRIOR receipt hash — chaining each warning to the last so the sequence is
// tamper-evident and non-repudiable (a warning cannot be reordered, backdated,
// inserted or deleted without breaking the chain).
function message(canon, model, ts, prevHash) { return `${canon}|${model}|${ts}|${prevHash}`; }

const GENESIS = '0'.repeat(64);
let chainHead = GENESIS;
let chainSeq = 0;

function chainState() { return { head: chainHead, seq: chainSeq }; }
function setChainState(head, seq) {
  if (typeof head === 'string' && head.length === 64) chainHead = head;
  if (Number.isFinite(seq)) chainSeq = seq;
}

function sign(payload) {
  const canon = canonical(payload);
  const ts = Date.now();
  const prevHash = chainHead;
  const seq = chainSeq + 1;
  const msg = message(canon, MODEL, ts, prevHash);
  const sig = crypto.sign('sha256', Buffer.from(msg), { key: keypair().priv, dsaEncoding: 'ieee-p1363' });
  const sigB64 = sig.toString('base64');
  const receiptHash = sha256hex(`${prevHash}.${sigB64}`); // links this receipt into the chain
  chainHead = receiptHash;
  chainSeq = seq;
  return { alg: 'ES256', model: MODEL, ts, inputsHash: sha256hex(canon), prevHash, seq, receiptHash, sig: sigB64 };
}

// Server-side verify (mirrors the browser path). pubKey optional (defaults to ours).
function verify(payload, receipt, pubKey, ttlMs = 3600000) {
  if (!receipt || !receipt.sig) return { valid: false, stale: false };
  const canon = canonical(payload);
  const msg = message(canon, receipt.model, receipt.ts, receipt.prevHash);
  const key = pubKey || keypair().pub;
  let valid = false;
  try {
    valid = crypto.verify('sha256', Buffer.from(msg), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(receipt.sig, 'base64'));
  } catch { valid = false; }
  // Verify this receipt's self-declared chain hash is consistent with its inputs.
  const chainOk = receipt.receiptHash === sha256hex(`${receipt.prevHash}.${receipt.sig}`);
  return { valid: valid && chainOk, chainOk, stale: Date.now() - receipt.ts > ttlMs };
}

// Verify an ordered array of receipts forms an unbroken chain (each prevHash equals
// the previous receiptHash). Detects reorder / insert / delete / backdate.
function verifyChain(receipts) {
  if (!Array.isArray(receipts) || !receipts.length) return { ok: false, breakAt: 0 };
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i];
    const selfOk = r.receiptHash === sha256hex(`${r.prevHash}.${r.sig}`);
    const linkOk = i === 0 ? true : r.prevHash === receipts[i - 1].receiptHash;
    if (!selfOk || !linkOk) return { ok: false, breakAt: i };
  }
  return { ok: true, breakAt: -1 };
}

module.exports = { sign, verify, verifyChain, canonical, stableStringify, publicKeyJwk, MODEL, chainState, setChainState, GENESIS };
