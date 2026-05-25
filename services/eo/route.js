// Evacuation-route clearance — LATENCY-AWARE and FAIL-SAFE.
//
// Honest premise: satellite observations are LATENT (active-fire detections can be
// hours old; a fire moves kilometres in that time). A naive "no fire seen near the path
// => GO" is dangerous. So this engine NEVER treats a stale detection as a static point:
//   1. It carries each detection's AGE and projects the hazard FORWARD using a physical
//      spread model over (elapsed time + time to traverse the route), so latency makes
//      the danger zone GROW, not vanish. Absence of fresh data widens the margin, it
//      does not imply safety.
//   2. It computes a CONFIDENCE that decays with data age, and biases CONSERVATIVELY:
//      uncertainty pushes toward caution, never toward a confident clearance.
//   3. Fast, genuinely real-time model signals (precipitation, wind nowcast) are used
//      directly; the slow satellite layer is only used through forward projection.
// The verdict is decision-support, not a guarantee, and the certificate records the data
// age so the basis is accountable.
const { getJson, getText, haversineKm } = require('./http');
const firms = require('./adapters/firms');
const physics = require('./physics');

const WALK_KMH = 4.5;                 // assumed evacuation pace on foot
const BASE_UNCERTAINTY_KM = 1.0;      // detection geolocation + sub-pixel slack
const FRESH_MIN = 60;                 // < 1 h: satellite layer trusted at full weight
const STALE_MIN = 360;                // > 6 h: satellite fire layer cannot, alone, clear

function sampleWaypoints(from, to, stepKm = 8) {
  const d = haversineKm(from, to);
  const n = Math.max(1, Math.ceil(d / stepKm));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ lat: +(from.lat + (to.lat - from.lat) * t).toFixed(5), lng: +(from.lng + (to.lng - from.lng) * t).toFixed(5) });
  }
  return pts;
}

const RANK = { GO: 0, CAUTION: 1, NO_GO: 2 };
const worstOf = (a, b) => (RANK[b] > RANK[a] ? b : a);

// Pure classifier. fireMarginKm = distance to the PROJECTED fire front (already grown by
// elapsed + traverse time); <= 0 means the front can reach this point => NO_GO.
function classifyPoint({ fireMarginKm, precipMm, gustKmh, lowLying }) {
  const reasons = [];
  let level = 'GO';
  const raise = (lvl, why) => { if (RANK[lvl] > RANK[level]) level = lvl; reasons.push(why); };
  if (Number.isFinite(fireMarginKm)) {
    if (fireMarginKm <= 0) raise('NO_GO', `projected fire front reaches the path`);
    else if (fireMarginKm <= 3) raise('CAUTION', `projected fire front within ${fireMarginKm.toFixed(1)} km`);
  }
  if (Number.isFinite(precipMm)) {
    if (precipMm >= 30 || (precipMm >= 12 && lowLying)) raise('NO_GO', `heavy rain ${Math.round(precipMm)} mm/h${lowLying ? ' on low ground' : ''}`);
    else if (precipMm >= 10) raise('CAUTION', `rain ${Math.round(precipMm)} mm/h`);
  }
  if (Number.isFinite(gustKmh)) {
    if (gustKmh >= 90) raise('NO_GO', `damaging wind ${Math.round(gustKmh)} km/h`);
    else if (gustKmh >= 60) raise('CAUTION', `strong wind ${Math.round(gustKmh)} km/h`);
  }
  return { level, reason: reasons[0] || 'clear' };
}

function bbox(points, marginDeg = 0.2) {
  const lats = points.map((p) => p.lat); const lngs = points.map((p) => p.lng);
  return { w: Math.min(...lngs) - marginDeg, s: Math.min(...lats) - marginDeg, e: Math.max(...lngs) + marginDeg, n: Math.max(...lats) + marginDeg };
}

function fireAgeMin(row) {
  const d = row.acq_date; const t = (row.acq_time || '0000').padStart(4, '0');
  const ms = Date.parse(`${d}T${t.slice(0, 2)}:${t.slice(2)}:00Z`);
  return Number.isFinite(ms) ? Math.max(0, (Date.now() - ms) / 60000) : null;
}

// Build segments with FORWARD-PROJECTED fire danger. traverseMin = whole-route walk time
// (a conservative horizon: a fire can keep advancing the entire time you are exposed).
function buildSegments(waypoints, fires, weather, elevations, traverseMin) {
  const elevs = Array.isArray(elevations) ? elevations : [];
  const sorted = elevs.filter(Number.isFinite).slice().sort((a, b) => a - b);
  const medianElev = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;

  const pointEval = waypoints.map((w, i) => {
    const wx = weather[i] || {};
    const dry = Number.isFinite(wx.rh) ? Math.max(0, Math.min(1, (100 - wx.rh) / 100)) : 0.6;
    // local slope from neighbouring elevations
    let slopeDeg = 0;
    if (Number.isFinite(elevs[i])) {
      const j = i + 1 < elevs.length ? i + 1 : i - 1;
      if (j >= 0 && Number.isFinite(elevs[j])) {
        const dz = Math.abs(elevs[i] - elevs[j]);
        const dx = Math.max(1, haversineKm(w, waypoints[j]) * 1000);
        slopeDeg = (Math.atan(dz / dx) * 180) / Math.PI;
      }
    }
    const ros = physics.fireRateOfSpread({ drynessP: dry, windKmh: Number(wx.gust) || 0, slopeDeg }).rosMPerMin;
    // nearest PROJECTED fire margin across all fires
    let fireMarginKm = NaN;
    for (const f of fires) {
      const age = Number.isFinite(f.ageMin) ? f.ageMin : 0;
      const projectedReachKm = (ros * (age + traverseMin)) / 1000 + BASE_UNCERTAINTY_KM;
      const margin = haversineKm(w, f) - projectedReachKm;
      if (!(margin >= fireMarginKm)) fireMarginKm = margin; // keep the smallest (worst) margin
    }
    const lowLying = medianElev != null && Number.isFinite(elevs[i]) ? elevs[i] <= medianElev - 15 : false;
    return { point: w, ...classifyPoint({ fireMarginKm, precipMm: wx.precip, gustKmh: wx.gust, lowLying }), fireMarginKm: Number.isFinite(fireMarginKm) ? +fireMarginKm.toFixed(1) : null };
  });

  const segments = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = pointEval[i]; const b = pointEval[i + 1];
    const level = worstOf(a.level, b.level);
    const reason = RANK[b.level] > RANK[a.level] ? b.reason : a.reason;
    segments.push({ axis: 'segment', from: waypoints[i], to: waypoints[i + 1], level, reason });
  }
  return segments.length ? segments : [{ axis: 'segment', from: waypoints[0], to: waypoints[0], level: pointEval[0].level, reason: pointEval[0].reason }];
}

function overallVerdict(segments) { return segments.reduce((acc, s) => worstOf(acc, s.level), 'GO'); }

// Confidence decays with the age of the freshest fire observation; conservative.
function freshnessConfidence(freshestFireAgeMin, sawFires) {
  if (!sawFires) return { confidence: 0.5, note: 'No active fire in the latest satellite pass, but satellite fire data can be hours old; absence is NOT a guarantee.' };
  if (freshestFireAgeMin <= FRESH_MIN) return { confidence: 0.85, note: `Fire data ~${Math.round(freshestFireAgeMin)} min old, forward-projected.` };
  if (freshestFireAgeMin <= STALE_MIN) return { confidence: 0.6, note: `Fire data ~${Math.round(freshestFireAgeMin / 60)} h old; danger zone projected forward, treat with caution.` };
  return { confidence: 0.35, note: `Fire data >${Math.round(STALE_MIN / 60)} h old; cannot be relied on alone — verify visually.` };
}

async function assessRoute(from, to) {
  const waypoints = sampleWaypoints(from, to);
  const distanceKm = haversineKm(from, to);
  const traverseMin = (distanceKm / WALK_KMH) * 60;
  const box = bbox(waypoints);

  // 1) Active fires across the route bbox, WITH age, in one FIRMS call.
  let fires = []; let sawFires = false; let freshestFireAgeMin = Infinity;
  const key = process.env.FIRMS_MAP_KEY;
  if (key) {
    const area = `${box.w.toFixed(3)},${box.s.toFixed(3)},${box.e.toFixed(3)},${box.n.toFixed(3)}`;
    const txt = await getText(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/VIIRS_NOAA20_NRT/${area}/1`, 9000);
    if (txt && !/Invalid/i.test(txt)) {
      const rows = firms.parseCsv(txt);
      sawFires = true; // we got a successful response (even if zero rows)
      fires = rows.map((r) => {
        const age = fireAgeMin(r);
        if (Number.isFinite(age)) freshestFireAgeMin = Math.min(freshestFireAgeMin, age);
        return { lat: parseFloat(r.latitude), lng: parseFloat(r.longitude), ageMin: age };
      }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    }
  }
  if (!Number.isFinite(freshestFireAgeMin)) freshestFireAgeMin = null;

  // 2) Near-real-time weather (precip, wind gust, humidity) — model nowcast, batched.
  const lats = waypoints.map((w) => w.lat).join(',');
  const lngs = waypoints.map((w) => w.lng).join(',');
  const wj = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&current=precipitation,wind_gusts_10m,relative_humidity_2m&timezone=auto`, 9000);
  const wArr = Array.isArray(wj) ? wj : (wj ? [wj] : []);
  const weather = waypoints.map((_, i) => {
    const c = (wArr[i] && wArr[i].current) || {};
    return { precip: Number(c.precipitation), gust: Number(c.wind_gusts_10m), rh: Number(c.relative_humidity_2m) };
  });

  // 3) Elevation (static) for low-lying flood susceptibility + slope, batched.
  const ej = await getJson(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`, 8000);
  const elevations = (ej && Array.isArray(ej.elevation)) ? ej.elevation.map(Number) : [];

  let segments = buildSegments(waypoints, fires, weather, elevations, traverseMin);
  let verdict = overallVerdict(segments);
  const fc = freshnessConfidence(freshestFireAgeMin == null ? Infinity : freshestFireAgeMin, sawFires && fires.length > 0);

  // FAIL-SAFE: stale or absent satellite fire data must not yield a confident clearance.
  // A GO on data that cannot be trusted for a fast hazard is downgraded to CAUTION.
  let downgraded = false;
  const fireLayerUntrustworthy = !key || !sawFires || (fires.length > 0 && freshestFireAgeMin != null && freshestFireAgeMin > STALE_MIN);
  if (verdict === 'GO' && fireLayerUntrustworthy) { verdict = 'CAUTION'; downgraded = true; }

  const worst = segments.reduce((acc, s) => (RANK[s.level] > RANK[acc.level] ? s : acc), segments[0]);
  const basis = (downgraded ? 'Downgraded GO→CAUTION: ' : '') + fc.note;
  return {
    verdict,
    confidence: +fc.confidence.toFixed(2),
    dataAgeMin: freshestFireAgeMin == null ? null : Math.round(freshestFireAgeMin),
    traverseMin: Math.round(traverseMin),
    basis,
    distanceKm: +distanceKm.toFixed(1),
    from, to,
    segments,
    worst: { level: worst.level, reason: worst.reason, from: worst.from, to: worst.to },
    sensorsUsed: ['NASA FIRMS (VIIRS, age-projected)', 'Open-Meteo nowcast', 'Open-Meteo Elevation'],
    activeFires: fires.length,
    generatedAt: Date.now(),
    disclaimer: 'Decision-support from latency-aware projection of the latest available data — not a guarantee. Conditions can change faster than satellites observe; verify with your own eyes and official local orders.',
  };
}

module.exports = { sampleWaypoints, classifyPoint, buildSegments, overallVerdict, bbox, assessRoute, freshnessConfidence, fireAgeMin };
