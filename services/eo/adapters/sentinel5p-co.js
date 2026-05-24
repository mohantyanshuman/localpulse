// Sentinel-5P TROPOMI CO total column via CDSE Statistical API -> air axis
// (combustion/fire-plume pollution). Complements the NO2/SO2/aerosol adapters. requires Copernicus creds.
const sh = require('../sentinelhub');
const { mkSignal } = require('../signal');

// dataMask output is REQUIRED by the Statistical API.
const EVALSCRIPT = `//VERSION=3
function setup(){return {input:["CO","dataMask"],output:[{id:"data",bands:1},{id:"dataMask",bands:1}]}}
function evaluatePixel(s){return {data:[s.CO],dataMask:[s.dataMask]}}`;

// CO column mol/m2: background ~0.03 .. combustion/fire plumes higher. Map over [0, 0.1].
function toSignal(co, center) {
  if (!Number.isFinite(co)) return null;
  return mkSignal({
    axis: 'air',
    magnitude: Math.max(0, Math.min(1, co / 0.1)),
    confidence: 0.7,
    freshness: Date.now(),
    sensor: 'Sentinel-5P TROPOMI (CO)',
    distanceKm: 0,
    detail: { co_mol_m2: co },
  });
}

async function query(lat, lng) {
  const resp = await sh.statistics({ collection: 'sentinel-5p-l2', evalscript: EVALSCRIPT, lat, lng, days: 7 });
  const s = toSignal(sh.latestMean(resp), { lat, lng });
  return s ? [s] : [];
}

module.exports = {
  id: 'sentinel5p-co', axes: ['air'],
  requires: ['COPERNICUS_CLIENT_ID', 'COPERNICUS_CLIENT_SECRET'],
  ttlMs: 3 * 60 * 60 * 1000, query, toSignal,
};
