// Sentinel-3 SLSTR thermal infrared (S8 brightness temperature, Kelvin) via CDSE
// Statistical API -> heat axis. Independent thermal sensor; corroborates extreme
// surface heat. requires Copernicus creds.
const sh = require('../sentinelhub');
const { mkSignal } = require('../signal');

// dataMask output REQUIRED by the Statistical API.
const EVALSCRIPT = `//VERSION=3
function setup(){return {input:["S8","dataMask"],output:[{id:"data",bands:1},{id:"dataMask",bands:1}]}}
function evaluatePixel(s){return {data:[s.S8],dataMask:[s.dataMask]}}`;

// Brightness temp Kelvin: 300 K = 27 C, 318 K = 45 C (extreme), 330 K = 57 C.
// Map [300, 330] K -> [0, 1].
function toSignal(kelvin, center) {
  if (!Number.isFinite(kelvin)) return null;
  return mkSignal({
    axis: 'heat',
    magnitude: Math.max(0, Math.min(1, (kelvin - 300) / 30)),
    confidence: 0.65,
    freshness: Date.now(),
    sensor: 'Sentinel-3 SLSTR',
    distanceKm: 0,
    detail: { brightnessTempK: kelvin, celsius: +(kelvin - 273.15).toFixed(1) },
  });
}

async function query(lat, lng) {
  const resp = await sh.statistics({ collection: 'sentinel-3-slstr', evalscript: EVALSCRIPT, lat, lng, days: 5 });
  const s = toSignal(sh.latestMean(resp), { lat, lng });
  return s ? [s] : [];
}

module.exports = {
  id: 'sentinel3', axes: ['heat'],
  requires: ['COPERNICUS_CLIENT_ID', 'COPERNICUS_CLIENT_SECRET'],
  ttlMs: 6 * 60 * 60 * 1000, query, toSignal,
};
