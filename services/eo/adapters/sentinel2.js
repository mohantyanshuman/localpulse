// Sentinel-2 NDVI via CDSE Statistical API as a vegetation-dryness proxy.
// Supporting axis (no baseline in a single-date read), modest confidence.
const sh = require('../sentinelhub');
const { mkSignal } = require('../signal');

// CDSE Statistical API requires a dataMask output to compute stats.
const EVALSCRIPT = `//VERSION=3
function setup(){return {input:["B04","B08","dataMask"],output:[{id:"data",bands:1},{id:"dataMask",bands:1}]}}
function evaluatePixel(s){let d=s.B08+s.B04+1e-6;return {data:[(s.B08-s.B04)/d],dataMask:[s.dataMask]}}`;

// NDVI ~ -0.1 bare/water, ~0.2 sparse, ~0.6+ dense vegetation.
// Dryness magnitude = how far below a healthy 0.6 the NDVI sits, scaled to 0..1.
function toSignal(ndvi, center) {
  if (!Number.isFinite(ndvi)) return null;
  const dryness = Math.max(0, Math.min(1, (0.6 - ndvi) / 0.6));
  return mkSignal({
    axis: 'vegetation',
    magnitude: dryness,
    confidence: 0.5,
    freshness: Date.now(),
    sensor: 'Sentinel-2 MSI',
    distanceKm: 0,
    detail: { ndvi },
  });
}

async function query(lat, lng) {
  const resp = await sh.statistics({ collection: 'sentinel-2-l2a', evalscript: EVALSCRIPT, lat, lng, days: 14 });
  const s = toSignal(sh.latestMean(resp), { lat, lng });
  return s ? [s] : [];
}

module.exports = {
  id: 'sentinel2', axes: ['vegetation'],
  requires: ['COPERNICUS_CLIENT_ID', 'COPERNICUS_CLIENT_SECRET'],
  ttlMs: 24 * 60 * 60 * 1000,
  query, toSignal,
};
