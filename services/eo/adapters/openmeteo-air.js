// Open-Meteo air quality (CAMS global, which assimilates Sentinel-5P TROPOMI).
// Keyless. Point JSON. Fills the hours when the S5P polar overpass is stale.
const { getJson } = require('../http');
const { mkSignal } = require('../signal');

// US AQI -> 0..1 magnitude. 50=good, 100=moderate, 150=USG, 200=unhealthy, 300+=hazardous.
function aqiToMagnitude(aqi) {
  if (!Number.isFinite(aqi)) return 0;
  return Math.max(0, Math.min(1, aqi / 300));
}

function toSignal(j, center) {
  const c = j && j.current;
  if (!c) return null;
  const aqi = Number(c.us_aqi);
  const freshness = Date.parse(c.time) || Date.now();
  return mkSignal({
    axis: 'air',
    magnitude: aqiToMagnitude(aqi),
    confidence: 0.8,
    freshness,
    sensor: 'CAMS (Sentinel-5P assimilated)',
    distanceKm: 0,
    detail: { us_aqi: aqi, pm2_5: c.pm2_5, pm10: c.pm10, aod: c.aerosol_optical_depth, dust: c.dust },
  });
}

async function query(lat, lng) {
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}` +
    `&current=us_aqi,pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,aerosol_optical_depth,dust&timezone=auto`;
  const j = await getJson(url, 8000);
  const s = toSignal(j, { lat, lng });
  return s ? [s] : [];
}

module.exports = {
  id: 'openmeteo-air',
  axes: ['air'],
  requires: [],
  ttlMs: 60 * 60 * 1000,
  query,
  toSignal,
};
