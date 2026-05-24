// On-device offline inference: recompute the headline level from cached per-sensor
// signals with zero network, mirroring the server's confidence-weighted roll-up.
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
  return { recomputeLevel, levelFromMagnitude, ageLabel };
});
