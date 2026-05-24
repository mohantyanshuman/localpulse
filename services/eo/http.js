// Shared HTTP helpers for Earth-observation adapters. Timeout-bounded and
// degrade to null so one bad feed never breaks fusion. Mirrors services/hazards.js.
const UA = 'LocalPulse/1.0 (+https://localpulse.dmj.one)';

async function getText(url, ms = 8000, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      ...opts,
      headers: { 'User-Agent': UA, ...(opts.headers || {}) },
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url, ms = 8000, opts = {}) {
  const t = await getText(url, ms, opts);
  if (t == null) return null;
  try { return JSON.parse(t); } catch { return null; }
}

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

module.exports = { getText, getJson, haversineKm };
