// On-device offline inference + verification. Recomputes the headline level from
// cached per-sensor signals with zero network, and cryptographically verifies the
// provenance receipt with the cached ECDSA public key (WebCrypto) — fully offline,
// no shared secret. Canonicalization mirrors services/eo/provenance.js byte-for-byte.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node tests
  if (typeof window !== 'undefined') window.EOOffline = api;                  // browser
})(this, function () {
  const RANK = { ok: 0, elevated: 1, high: 2, severe: 3 };
  function levelFromMagnitude(m) {
    return m >= 0.8 ? 'severe' : m >= 0.55 ? 'high' : m >= 0.3 ? 'elevated' : 'ok';
  }
  function recomputeLevel(perHazard) {
    let topEff = 0, forced = 'ok';
    for (const h of perHazard || []) {
      const eff = (h.magnitude || 0) * (h.confidence || 0);
      if (eff > topEff) topEff = eff;
      if ((h.magnitude || 0) >= 0.8 && (h.confidence || 0) >= 0.7 && RANK.high > RANK[forced]) forced = 'high';
    }
    const w = levelFromMagnitude(topEff);
    return RANK[w] >= RANK[forced] ? w : forced;
  }
  function ageLabel(ts) {
    const min = Math.max(0, Math.round((Date.now() - ts) / 60000));
    return min < 60 ? `${min} min old` : `${Math.round(min / 60)} h old`;
  }

  // --- provenance verification (must match services/eo/provenance.js) ---
  function stableStringify(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  function canonical(payload) {
    return stableStringify({
      level: payload.level,
      sensorsUsed: payload.sensorsUsed,
      predictions: payload.predictions,
      perHazard: payload.perHazard,
    });
  }
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  async function verifyReceipt(payload, receipt, jwk, ttlMs) {
    if (!receipt || !receipt.sig || !jwk) return { valid: false, stale: false };
    const subtle = (typeof crypto !== 'undefined' && crypto.subtle) || null;
    if (!subtle) return { valid: false, stale: false };
    const msg = canonical(payload) + '|' + receipt.model + '|' + receipt.ts;
    let valid = false;
    try {
      const key = await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      valid = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64ToBytes(receipt.sig), new TextEncoder().encode(msg));
    } catch (e) { valid = false; }
    return { valid, stale: Date.now() - receipt.ts > (ttlMs || 3600000) };
  }

  return { recomputeLevel, levelFromMagnitude, ageLabel, canonical, stableStringify, verifyReceipt };
});
