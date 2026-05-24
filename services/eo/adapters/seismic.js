// USGS earthquakes (ground sensor network) as a real-world event layer.
// Keyless. Returns one signal per qualifying quake within radius.
const { getJson, haversineKm } = require('../http');
const { mkSignal } = require('../signal');

const RADIUS_KM = 350;

// Richter M -> 0..1. M2.5 felt, M5 damaging, M6.5+ severe.
function magToMagnitude(m) {
  if (!Number.isFinite(m)) return 0;
  return Math.max(0, Math.min(1, (m - 2.5) / 4.5));
}

function toSignals(geo, center, radiusKm = RADIUS_KM) {
  const feats = (geo && geo.features) || [];
  const out = [];
  for (const f of feats) {
    const m = Number(f.properties && f.properties.mag);
    const coords = f.geometry && f.geometry.coordinates;
    if (!Array.isArray(coords)) continue;
    const lat = coords[1];
    const lng = coords[0];
    const distanceKm = haversineKm(center, { lat, lng });
    if (distanceKm > radiusKm) continue;
    out.push(mkSignal({
      axis: 'seismic',
      magnitude: magToMagnitude(m),
      confidence: 0.95,
      freshness: Number(f.properties.time) || Date.now(),
      sensor: 'USGS Seismic Network',
      distanceKm,
      detail: { mag: m, place: f.properties.place, depthKm: coords[2] },
    }));
  }
  // strongest first
  return out.sort((a, b) => b.magnitude - a.magnitude).slice(0, 5);
}

async function query(lat, lng) {
  const start = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson` +
    `&latitude=${lat}&longitude=${lng}&maxradiuskm=${RADIUS_KM}&minmagnitude=2.5&starttime=${start}`;
  const geo = await getJson(url, 9000);
  return toSignals(geo, { lat, lng });
}

module.exports = {
  id: 'seismic',
  axes: ['seismic'],
  requires: [],
  ttlMs: 15 * 60 * 1000,
  query,
  toSignals,
};
