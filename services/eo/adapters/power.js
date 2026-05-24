// NASA POWER multi-day precipitation (MERRA-2 / satellite-assimilated). Keyless.
// Lags ~1-2 days, so it backstops the flood axis with accumulated rainfall when
// real-time radar is unavailable.
const { getJson } = require('../http');
const { mkSignal } = require('../signal');

function ymd(d) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Sum of 3-day rainfall (mm) -> 0..1. ~150mm over 3 days is a serious flood signal.
function rainToMagnitude(mm) {
  return Math.max(0, Math.min(1, mm / 150));
}

function toSignal(j, center) {
  const series = j && j.properties && j.properties.parameter && j.properties.parameter.PRECTOTCORR;
  if (!series) return null;
  const vals = Object.values(series).map(Number).filter((v) => Number.isFinite(v) && v > -900);
  const totalMm = Math.round(vals.reduce((a, b) => a + b, 0));
  return mkSignal({
    axis: 'flood',
    magnitude: rainToMagnitude(totalMm),
    confidence: 0.6,
    freshness: Date.now(),
    sensor: 'NASA POWER (MERRA-2)',
    distanceKm: 0,
    detail: { totalMm, days: vals.length },
  });
}

async function query(lat, lng) {
  const end = new Date();
  const start = new Date(end.getTime() - 3 * 24 * 3600 * 1000);
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR` +
    `&latitude=${lat}&longitude=${lng}&start=${ymd(start)}&end=${ymd(end)}&format=JSON&community=AG`;
  const j = await getJson(url, 9000);
  const s = toSignal(j, { lat, lng });
  return s ? [s] : [];
}

module.exports = {
  id: 'power',
  axes: ['flood'],
  requires: [],
  ttlMs: 6 * 60 * 60 * 1000,
  query,
  toSignal,
};
