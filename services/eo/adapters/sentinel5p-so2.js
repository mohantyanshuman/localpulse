// Sentinel-5P TROPOMI SO2 total column via CDSE Statistical API -> air axis
// (volcanic/industrial pollution). Complements the NO2/aerosol adapters. requires Copernicus creds.
const sh = require('../sentinelhub');
const { mkSignal } = require('../signal');

// dataMask output is REQUIRED by the Statistical API.
const EVALSCRIPT = `//VERSION=3
function setup(){return {input:["SO2","dataMask"],output:[{id:"data",bands:1},{id:"dataMask",bands:1}]}}
function evaluatePixel(s){return {data:[s.SO2],dataMask:[s.dataMask]}}`;

// SO2 column mol/m2: ~1e-4 clean .. volcanic/industrial spikes much higher. Map over [0, 1e-3].
function toSignal(so2, center) {
  if (!Number.isFinite(so2)) return null;
  return mkSignal({
    axis: 'air',
    magnitude: Math.max(0, Math.min(1, so2 / 1e-3)),
    confidence: 0.7,
    freshness: Date.now(),
    sensor: 'Sentinel-5P TROPOMI (SO2)',
    distanceKm: 0,
    detail: { so2_mol_m2: so2 },
  });
}

async function query(lat, lng) {
  const resp = await sh.statistics({ collection: 'sentinel-5p-l2', evalscript: EVALSCRIPT, lat, lng, days: 7 });
  const s = toSignal(sh.latestMean(resp), { lat, lng });
  return s ? [s] : [];
}

module.exports = {
  id: 'sentinel5p-so2', axes: ['air'],
  requires: ['COPERNICUS_CLIENT_ID', 'COPERNICUS_CLIENT_SECRET'],
  ttlMs: 3 * 60 * 60 * 1000, query, toSignal,
};
