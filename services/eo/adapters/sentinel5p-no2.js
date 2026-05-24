// Sentinel-5P TROPOMI tropospheric NO2 column via CDSE Statistical API -> air axis
// (pollution). Complements the aerosol-index adapter. requires Copernicus creds.
const sh = require('../sentinelhub');
const { mkSignal } = require('../signal');

// dataMask output is REQUIRED by the Statistical API.
const EVALSCRIPT = `//VERSION=3
function setup(){return {input:["NO2","dataMask"],output:[{id:"data",bands:1},{id:"dataMask",bands:1}]}}
function evaluatePixel(s){return {data:[s.NO2],dataMask:[s.dataMask]}}`;

// NO2 column mol/m2: ~2e-5 clean .. ~2e-4 polluted. Map over [0, 2.5e-4].
function toSignal(no2, center) {
  if (!Number.isFinite(no2)) return null;
  return mkSignal({
    axis: 'air',
    magnitude: Math.max(0, Math.min(1, no2 / 2.5e-4)),
    confidence: 0.7,
    freshness: Date.now(),
    sensor: 'Sentinel-5P TROPOMI (NO2)',
    distanceKm: 0,
    detail: { no2_mol_m2: no2 },
  });
}

async function query(lat, lng) {
  const resp = await sh.statistics({ collection: 'sentinel-5p-l2', evalscript: EVALSCRIPT, lat, lng, days: 7 });
  const s = toSignal(sh.latestMean(resp), { lat, lng });
  return s ? [s] : [];
}

module.exports = {
  id: 'sentinel5p-no2', axes: ['air'],
  requires: ['COPERNICUS_CLIENT_ID', 'COPERNICUS_CLIENT_SECRET'],
  ttlMs: 3 * 60 * 60 * 1000, query, toSignal,
};
