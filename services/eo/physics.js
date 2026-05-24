// Physics-constrained hazard propagation. Interpretable formulas (Rothermel-style
// fire ROS; rainfall-runoff slope proxy) constrained by satellite-derived inputs.
// Elevation/slope from the keyless Open-Meteo Elevation API.
const { getJson } = require('./http');

// Simplified Rothermel: ROS = R0 * dryness * (1 + windFactor + slopeFactor).
function fireRateOfSpread({ drynessP, windKmh, slopeDeg }) {
  const dry = Math.max(0, Math.min(1, drynessP));
  const R0 = 1.5; // base m/min in cured fuel
  const windFactor = Math.pow(Math.max(0, windKmh) / 10, 1.5) * 0.4;
  const slopeFactor = Math.pow(Math.tan((Math.max(0, slopeDeg) * Math.PI) / 180), 2) * 3;
  const ros = R0 * dry * (1 + windFactor + slopeFactor);
  return { rosMPerMin: +ros.toFixed(2), reachKm1h: +((ros * 60) / 1000).toFixed(2) };
}

// Flood onset proxy: intense rain on steep ground concentrates runoff faster.
function floodOnsetFactor({ rainMmPerH, slopeDeg }) {
  const rain = Math.max(0, Math.min(1, rainMmPerH / 40));
  const slope = Math.max(0, Math.min(1, slopeDeg / 20));
  return +Math.max(0, Math.min(1, 0.6 * rain + 0.4 * rain * slope)).toFixed(3);
}

// Estimate slope+aspect from a center elevation and a 4-point ring (N,E,S,W) at ~ringKm.
function slopeFromRing(center, ring, ringKm) {
  const [n, e, s, w] = ring.map(Number);
  const dz_ns = (n - s);
  const dz_ew = (e - w);
  const dist = Math.max(0.001, ringKm * 1000 * 2);
  const grad = Math.sqrt(dz_ns * dz_ns + dz_ew * dz_ew) / dist;
  const slopeDeg = (Math.atan(grad) * 180) / Math.PI;
  const aspectDeg = ((Math.atan2(dz_ew, dz_ns) * 180) / Math.PI + 360) % 360;
  return { slopeDeg: +slopeDeg.toFixed(2), aspectDeg: +aspectDeg.toFixed(1) };
}

async function terrain(lat, lng, ringKm = 1) {
  const d = ringKm / 111;
  const pts = [[lat + d, lng], [lat, lng + d], [lat - d, lng], [lat, lng - d]];
  const lats = [lat, ...pts.map((p) => p[0])].join(',');
  const lngs = [lng, ...pts.map((p) => p[1])].join(',');
  const j = await getJson(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`, 7000);
  const el = j && Array.isArray(j.elevation) ? j.elevation : null;
  if (!el || el.length < 5) return null;
  return { elevationM: el[0], ...slopeFromRing(el[0], el.slice(1), ringKm) };
}

module.exports = { fireRateOfSpread, floodOnsetFactor, slopeFromRing, terrain };
