// Open-Meteo storm proxy: wind gusts + convective available potential energy (CAPE)
// + precipitation. Keyless. Fills the previously-uncovered storm axis.
const { getJson } = require('../http');
const { mkSignal } = require('../signal');

// Gusts: 60 km/h notable, 90 damaging, 120+ severe. CAPE: 1000 thunderstorm, 2500 severe.
function toSignal(j, center) {
  const c = j && j.current;
  if (!c) return null;
  const gust = Number(c.wind_gusts_10m) || 0;
  const cape = (j.hourly && Array.isArray(j.hourly.cape) && Math.max(...j.hourly.cape.map(Number).filter(Number.isFinite))) || 0;
  const precip = Number(c.precipitation) || 0;
  const gustMag = Math.max(0, Math.min(1, (gust - 30) / 90));
  const capeMag = Math.max(0, Math.min(1, cape / 2500));
  const precipMag = Math.max(0, Math.min(1, precip / 20));
  const magnitude = Math.max(0, Math.min(1, 0.5 * gustMag + 0.35 * capeMag + 0.15 * precipMag));
  return mkSignal({
    axis: 'storm',
    magnitude,
    confidence: 0.7,
    freshness: Date.parse(c.time) || Date.now(),
    sensor: 'Open-Meteo (GFS/ECMWF)',
    distanceKm: 0,
    detail: { gustKmh: gust, cape, precipMm: precip },
  });
}

async function query(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=wind_speed_10m,wind_gusts_10m,precipitation&hourly=cape&forecast_days=1&timezone=auto`;
  const j = await getJson(url, 8000);
  const s = toSignal(j, { lat, lng });
  return s ? [s] : [];
}

module.exports = { id: 'storm', axes: ['storm'], requires: [], ttlMs: 30 * 60 * 1000, query, toSignal };
