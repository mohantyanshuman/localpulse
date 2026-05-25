// Warning Certificate: a self-contained, portable, independently-verifiable artifact
// attesting WHAT hazard was warned, WHERE, WHEN, by which sensors, and at which ordinal
// position in a tamper-evident chain. It embeds the issuer's public key so any third
// party (citizen, responder, insurer, court) can verify it OFFLINE, with no server and
// no distributed ledger — establishing non-repudiable disaster-warning accountability.
const crypto = require('crypto');
const provenance = require('./provenance');

function fingerprint(jwk) {
  return crypto.createHash('sha256').update(JSON.stringify(jwk, Object.keys(jwk).sort())).digest('hex').slice(0, 16);
}

function headlineOf(body) {
  const place = (body.location && (body.location.place || `${body.location.lat},${body.location.lng}`)) || 'the queried location';
  return `Hazard level ${String(body.level || 'unknown').toUpperCase()} for ${place}, ${body.sensorsUsed ? body.sensorsUsed.length : 0} sensors reporting.`;
}

// Build a certificate from a warning body. Reuses the body's signature/receipt if
// present (so the chain is not double-advanced); otherwise signs once.
function issue(body, meta) {
  const receipt = body.provenance || provenance.sign(body);
  const jwk = provenance.publicKeyJwk();
  return {
    kind: 'localpulse-warning-certificate',
    version: 1,
    issuer: (meta && meta.issuer) || 'localpulse',
    issuedAt: receipt.ts,
    headline: headlineOf(body),
    location: body.location || null,
    level: body.level,
    sensorsUsed: body.sensorsUsed,
    perHazard: body.perHazard,
    predictions: body.predictions,
    receipt,
    publicKeyJwk: jwk,
    publicKeyFingerprint: fingerprint(jwk),
    verifyHint: 'Verify offline: import publicKeyJwk (ECDSA P-256), recompute the canonical encoding of {level,sensorsUsed,predictions,perHazard,location}, and ECDSA-verify the receipt signature over canon|model|ts|prevHash. Chain self-consistency: receiptHash == sha256(prevHash + "." + sig).',
  };
}

// Self-contained verification using the certificate's OWN embedded public key.
// validity = signature valid AND chain self-consistent. Staleness is reported but does
// not invalidate a certificate as a historical record of what was warned and when.
function verifyCertificate(cert) {
  if (!cert || cert.kind !== 'localpulse-warning-certificate') return { valid: false, reason: 'not-a-certificate' };
  if (!cert.receipt || !cert.publicKeyJwk) return { valid: false, reason: 'incomplete-certificate' };
  let key;
  try { key = crypto.createPublicKey({ key: cert.publicKeyJwk, format: 'jwk' }); } catch { return { valid: false, reason: 'bad-public-key' }; }
  const payload = { level: cert.level, sensorsUsed: cert.sensorsUsed, predictions: cert.predictions, perHazard: cert.perHazard, location: cert.location };
  const r = provenance.verify(payload, cert.receipt, key, Infinity); // Infinity ttl: never "stale-invalid"
  return {
    valid: r.valid,
    chainOk: r.chainOk,
    fingerprint: cert.publicKeyFingerprint,
    seq: cert.receipt.seq,
    issuedAt: cert.issuedAt,
    reason: r.valid ? 'ok' : 'signature-or-chain-mismatch',
  };
}

module.exports = { issue, verifyCertificate, fingerprint, headlineOf };
