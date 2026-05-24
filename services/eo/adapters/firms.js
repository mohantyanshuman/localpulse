// NASA FIRMS active fire across multiple satellites. One free MAP_KEY queries
// all sources; each source is a different platform so overpass gaps are covered.
const { getText, haversineKm } = require('../http');
const { mkSignal } = require('../signal');

const SOURCES = [
  { src: 'VIIRS_SNPP_NRT', sensor: 'VIIRS S-NPP' },
  { src: 'VIIRS_NOAA20_NRT', sensor: 'VIIRS NOAA-20' },
  { src: 'VIIRS_NOAA21_NRT', sensor: 'VIIRS NOAA-21' },
  { src: 'MODIS_NRT', sensor: 'MODIS' },
];
const RADIUS_KM = 60;

function parseCsv(text) {
  const lines = String(text).trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    const row = {};
    header.forEach((h, i) => { row[h.trim()] = (cols[i] || '').trim(); });
    return row;
  });
}

function confToScore(c) {
  if (c === 'high' || c === 'h') return 1;
  if (c === 'nominal' || c === 'n') return 0.7;
  if (c === 'low' || c === 'l') return 0.4;
  const n = parseFloat(c);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n / 100)) : 0.5;
}

function freshnessOf(row) {
  const d = row.acq_date; // YYYY-MM-DD
  const t = (row.acq_time || '0000').padStart(4, '0');
  const iso = `${d}T${t.slice(0, 2)}:${t.slice(2)}:00Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Date.now();
}

function rowsToSignals(rows, center, sensor, radiusKm = RADIUS_KM) {
  const out = [];
  for (const row of rows) {
    const lat = parseFloat(row.latitude);
    const lng = parseFloat(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const distanceKm = haversineKm(center, { lat, lng });
    if (distanceKm > radiusKm) continue;
    const frp = parseFloat(row.frp) || 0;
    const conf = confToScore(row.confidence);
    // magnitude: closer + hotter (FRP) + higher confidence = stronger.
    const proximity = 1 - distanceKm / radiusKm;
    const heat = Math.min(1, frp / 100);
    const magnitude = Math.max(heat, 0.4) * conf * (0.5 + 0.5 * proximity);
    out.push(mkSignal({
      axis: 'fire',
      magnitude,
      confidence: conf,
      freshness: freshnessOf(row),
      sensor,
      distanceKm,
      detail: { frp, confidence: row.confidence, daynight: row.daynight },
    }));
  }
  return out;
}

async function query(lat, lng) {
  const key = process.env.FIRMS_MAP_KEY;
  if (!key) return [];
  const d = 0.6; // ~66km half-box
  const area = `${(lng - d).toFixed(3)},${(lat - d).toFixed(3)},${(lng + d).toFixed(3)},${(lat + d).toFixed(3)}`;
  const center = { lat, lng };
  const perSource = await Promise.all(
    SOURCES.map(async ({ src, sensor }) => {
      const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${src}/${area}/1`;
      const text = await getText(url, 8000);
      if (!text || /Invalid/i.test(text)) return [];
      return rowsToSignals(parseCsv(text), center, sensor);
    })
  );
  return perSource.flat();
}

module.exports = {
  id: 'firms',
  axes: ['fire'],
  requires: ['FIRMS_MAP_KEY'],
  ttlMs: 10 * 60 * 1000,
  query,
  // exported for unit tests:
  parseCsv,
  rowsToSignals,
};
