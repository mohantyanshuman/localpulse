// World Engine: a PER-REGION ensemble of self-learning forecast engines trained
// SIMULTANEOUSLY on real-time outcomes. Calibration is partitioned by geographic region
// (coarse climate-zone buckets) because a given raw signal means different things in
// different parts of the world (a "0.7 flood" in a monsoon delta vs a desert). Within
// each region+hazard, several engines (a no-calibration baseline + logistic recalibrators
// at different learning rates) compete; the best-verified engine leads. Outcomes are
// confirmed by multiple mechanisms (services/eo/confirm), scored as binary skill (Brier,
// hit/false-alarm) AND continuous closeness, and the compact state is persisted so every
// region keeps learning across stateless restarts.
const skill = require('./skill');
const confirm = require('./confirm');

const HAZARDS = ['flood', 'storm', 'air', 'heat', 'fire'];
const ENGINES = [
  { name: 'identity', lr: 0 },
  { name: 'platt-slow', lr: 0.02 },
  { name: 'platt-mid', lr: 0.05 },
  { name: 'platt-fast', lr: 0.12 },
];
const MIN_LEAD = 20;
const REGION_DEG = 15; // ~1600 km climate-zone buckets

const state = {}; // region -> hazard -> { members, pending }
let store = null;

// Coarse region key from coordinates (a climate-zone proxy without external data).
function regionOf(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'GLOBAL';
  const la = Math.floor(lat / REGION_DEG) * REGION_DEG;
  const lo = Math.floor(lng / REGION_DEG) * REGION_DEG;
  return `${la >= 0 ? 'N' : 'S'}${Math.abs(la)}${lo >= 0 ? 'E' : 'W'}${Math.abs(lo)}`;
}

function freshMember(e) { return { name: e.name, lr: e.lr, params: { a: 1, b: 0 }, n: 0, sumBrier: 0, sumMAE: 0 }; }
function bucket(region, hazard) {
  if (!state[region]) state[region] = {};
  if (!state[region][hazard]) state[region][hazard] = { members: ENGINES.map(freshMember), pending: {} };
  return state[region][hazard];
}
function usePersistence(s) { store = s; }

function leader(st) {
  let best = st.members.find((m) => m.name === 'identity') || st.members[0];
  let bestB = Infinity;
  for (const m of st.members) {
    if (m.n >= MIN_LEAD) { const b = m.sumBrier / m.n; if (b < bestB) { bestB = b; best = m; } }
  }
  return best;
}

// Record a forecast for a cell; the region's leading engine supplies the calibrated prob.
function recordForecast(hazard, cell, rawProb, lat, lng) {
  const st = bucket(regionOf(lat, lng), hazard);
  const ld = leader(st);
  const p = skill.calibrate(rawProb, ld.params);
  st.pending[cell] = { raw: rawProb, ts: Date.now() };
  return p;
}

// Observe a confirmed outcome; train every engine in that region+hazard simultaneously.
function observe(hazard, cell, ctx, lat, lng) {
  const st = bucket(regionOf(lat, lng), hazard);
  const pend = st.pending[cell];
  if (!pend) return false;
  delete st.pending[cell];
  const c = confirm.confirm(ctx || {});
  const o = c.occurred ? 1 : 0;
  for (const m of st.members) {
    const pc = skill.calibrate(pend.raw, m.params);
    m.n += 1;
    m.sumBrier += (pc - o) ** 2;
    m.sumMAE += Math.abs(pc - c.observedMag);
    if (m.lr > 0) m.params = skill.updateParams(m.params, [{ p: pend.raw, outcome: o }], m.lr * c.confidence);
  }
  save();
  return true;
}

function observeFromMagnitude(hazard, cell, observedMag, sensorCount = 2, divergenceFlag = 'consensus', lat, lng) {
  return observe(hazard, cell, { observedMag, sensorCount, divergenceFlag }, lat, lng);
}

// Aggregate skill per hazard across all regions, and report regional coverage.
function report() {
  const hazards = {};
  for (const hazard of HAZARDS) {
    let n = 0, sumB = 0, sumMAE = 0, regions = 0;
    let bestEngine = 'identity', bestB = Infinity;
    for (const region in state) {
      const st = state[region][hazard];
      if (!st) continue;
      const ld = leader(st);
      if (ld.n > 0) {
        regions += 1; n += ld.n; sumB += ld.sumBrier; sumMAE += ld.sumMAE;
        const b = ld.sumBrier / ld.n; if (b < bestB) { bestB = b; bestEngine = ld.name; }
      }
    }
    hazards[hazard] = n
      ? { n, regions, engines: ENGINES.length, brier: +(sumB / n).toFixed(4), closeness: +(1 - sumMAE / n).toFixed(4), bestEngine, learning: n < MIN_LEAD }
      : { n: 0, regions: 0, engines: ENGINES.length, learning: true };
  }
  return { hazards, eventMag: confirm.EVENT_MAG, ensemble: ENGINES.map((e) => e.name), regionGranularityDeg: REGION_DEG, regionsTracked: Object.keys(state).length, generatedAt: Date.now() };
}

// --- durable persistence (compact: region -> hazard -> member aggregates) ---
function serialize() {
  const o = {};
  for (const region in state) {
    o[region] = {};
    for (const hazard in state[region]) {
      o[region][hazard] = state[region][hazard].members.map((m) => ({ name: m.name, params: m.params, n: m.n, sumBrier: +m.sumBrier.toFixed(4), sumMAE: +m.sumMAE.toFixed(4) }));
    }
  }
  return o;
}
function load(d) {
  if (!d) return;
  for (const region in d) {
    for (const hazard in d[region]) {
      const arr = d[region][hazard]; if (!Array.isArray(arr)) continue;
      const st = bucket(region, hazard);
      st.members = ENGINES.map((e) => {
        const s = arr.find((m) => m.name === e.name);
        return s ? { name: e.name, lr: e.lr, params: s.params && Number.isFinite(s.params.a) ? s.params : { a: 1, b: 0 }, n: Number(s.n) || 0, sumBrier: Number(s.sumBrier) || 0, sumMAE: Number(s.sumMAE) || 0 } : freshMember(e);
      });
    }
  }
}
function save() { if (store && store.save) { try { Promise.resolve(store.save(serialize())).catch(() => {}); } catch (e) {} } }
async function hydrate() { if (store && store.load) { try { load(await store.load()); } catch (e) {} } }
function _reset() { for (const k in state) delete state[k]; }

module.exports = { recordForecast, observe, observeFromMagnitude, report, leader, regionOf, usePersistence, hydrate, serialize, load, _reset, EVENT_MAG: confirm.EVENT_MAG, HAZARDS, ENGINES, REGION_DEG };
