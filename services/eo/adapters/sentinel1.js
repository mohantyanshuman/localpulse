// Sentinel-1 SAR VV backscatter via CDSE Statistical API as a surface-water proxy.
// SAR penetrates cloud and works at night, covering the optical sensors' gap on the
// flood axis. Single-date extent is approximate; modest confidence.
const sh = require('../sentinelhub');
const { mkSignal } = require('../signal');

// CDSE Statistical API requires a dataMask output to compute stats.
const EVALSCRIPT = `//VERSION=3
function setup(){return {input:["VV","dataMask"],output:[{id:"data",bands:1},{id:"dataMask",bands:1}]}}
function evaluatePixel(s){return {data:[s.VV],dataMask:[s.dataMask]}}`;

// VV linear backscatter from CDSE is ~0..1; water is very low. We accept either a
// dB value (negative) or linear (0..1) and normalize: lower => more water.
// Map dB range [-25,-5] -> [1,0]; if value looks linear (>=0 and <=1), use 1-value.
function toSignal(vv, center) {
  if (!Number.isFinite(vv)) return null;
  let mag;
  if (vv >= 0 && vv <= 1) mag = 1 - vv;            // linear backscatter
  else mag = Math.max(0, Math.min(1, (-5 - vv) / 20)); // dB: -5 dry .. -25 water
  return mkSignal({
    axis: 'flood',
    magnitude: Math.max(0, Math.min(1, mag)),
    confidence: 0.55,
    freshness: Date.now(),
    sensor: 'Sentinel-1 SAR',
    distanceKm: 0,
    detail: { vv },
  });
}

async function query(lat, lng) {
  const resp = await sh.statistics({ collection: 'sentinel-1-grd', evalscript: EVALSCRIPT, lat, lng, days: 12 });
  const s = toSignal(sh.latestMean(resp), { lat, lng });
  return s ? [s] : [];
}

module.exports = {
  id: 'sentinel1', axes: ['flood'],
  requires: ['COPERNICUS_CLIENT_ID', 'COPERNICUS_CLIENT_SECRET'],
  ttlMs: 6 * 60 * 60 * 1000,
  query, toSignal,
};
