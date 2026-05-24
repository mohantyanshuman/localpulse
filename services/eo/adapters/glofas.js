// Open-Meteo GloFAS river discharge (satellite + model reanalysis). Keyless.
// Third, independent flood sensor (alongside NASA POWER and Sentinel-1 SAR):
// a discharge peak well above the recent baseline signals rising water.
const { getJson } = require('../http');
const { mkSignal } = require('../signal');

function toSignal(j, center) {
  const arr = j && j.daily && Array.isArray(j.daily.river_discharge)
    ? j.daily.river_discharge.map(Number).filter(Number.isFinite) : null;
  if (!arr || arr.length < 2) return null;
  const peak = Math.max(...arr);
  const baseline = arr.slice(0, Math.max(1, Math.floor(arr.length / 2)));
  const base = baseline.reduce((a, b) => a + b, 0) / baseline.length || 1e-6;
  const ratio = peak / base; // 1 = flat, >2 = strong surge
  const magnitude = Math.max(0, Math.min(1, (ratio - 1) / 3));
  return mkSignal({
    axis: 'flood',
    magnitude,
    confidence: 0.65,
    freshness: Date.now(),
    sensor: 'GloFAS (Open-Meteo)',
    distanceKm: 0,
    detail: { peak, base: +base.toFixed(2), ratio: +ratio.toFixed(2) },
  });
}

async function query(lat, lng) {
  const url = `https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lng}&daily=river_discharge&forecast_days=7`;
  const j = await getJson(url, 8000);
  const s = toSignal(j, { lat, lng });
  return s ? [s] : [];
}

module.exports = { id: 'glofas', axes: ['flood'], requires: [], ttlMs: 6 * 60 * 60 * 1000, query, toSignal };
