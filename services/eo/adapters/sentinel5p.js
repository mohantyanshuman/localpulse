// Sentinel-5P TROPOMI UV aerosol index via CDSE Statistical API. Cross-checks the
// keyless CAMS air adapter on the air axis. requires Copernicus creds; skips if absent.
const sh = require('../sentinelhub');
const { mkSignal } = require('../signal');

const EVALSCRIPT = `//VERSION=3
function setup(){return {input:["AER_AI_354_388","dataMask"],output:[{id:"data",bands:1}]}}
function evaluatePixel(s){return {data:[s.AER_AI_354_388]}}`;

// Aerosol index: <0 clean, ~1 hazy, >2 heavy smoke/dust. Map to 0..1 over [0,3].
function toSignal(ai, center) {
  if (!Number.isFinite(ai)) return null;
  return mkSignal({
    axis: 'air',
    magnitude: Math.max(0, Math.min(1, ai / 3)),
    confidence: 0.75,
    freshness: Date.now(),
    sensor: 'Sentinel-5P TROPOMI',
    distanceKm: 0,
    detail: { aerosolIndex: ai },
  });
}

async function query(lat, lng) {
  const resp = await sh.statistics({ collection: 'sentinel-5p-l2', evalscript: EVALSCRIPT, lat, lng, days: 7 });
  const s = toSignal(sh.latestMean(resp), { lat, lng });
  return s ? [s] : [];
}

module.exports = {
  id: 'sentinel5p', axes: ['air'],
  requires: ['COPERNICUS_CLIENT_ID', 'COPERNICUS_CLIENT_SECRET'],
  ttlMs: 3 * 60 * 60 * 1000,
  query, toSignal,
};
