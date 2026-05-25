// World Engine: the closed self-learning loop. It records each probabilistic forecast,
// later observes whether the event actually occurred, scores skill (Brier, hit /
// false-alarm), and recalibrates the predictor (Platt params) so future probabilities
// match observed reality. State is compact running aggregates + the learned params, so
// it is durably persisted and resumes learning across stateless restarts.
const skill = require('./skill');

const EVENT_MAG = 0.55;     // observed magnitude >= this => the hazard "materialized"
const HAZARDS = ['flood', 'storm', 'air', 'heat', 'fire'];
const RECENT = 200;

const state = {};
let store = null;

function h(hz) {
  if (!state[hz]) state[hz] = { params: { a: 1, b: 0 }, n: 0, sumBrier: 0, sumBrierRaw: 0, tp: 0, fn: 0, fp: 0, tn: 0, recent: [], pending: {} };
  return state[hz];
}
function usePersistence(s) { store = s; }

// Record a forecast for a location-cell; returns the CALIBRATED probability and remembers
// it pending an outcome observation.
function recordForecast(hazard, cell, rawProb) {
  const st = h(hazard);
  const p = skill.calibrate(rawProb, st.params);
  st.pending[cell] = { p, raw: rawProb, ts: Date.now() };
  return p;
}

// Observe the realized outcome (occurred true/false) for a pending forecast.
function observe(hazard, cell, occurred) {
  const st = h(hazard);
  const pend = st.pending[cell];
  if (!pend) return false;
  delete st.pending[cell];
  const o = occurred ? 1 : 0;
  st.n += 1;
  st.sumBrier += (pend.p - o) ** 2;
  st.sumBrierRaw += (pend.raw - o) ** 2;
  const pred = pend.p >= 0.5 ? 1 : 0;
  if (pred && o) st.tp++; else if (!pred && o) st.fn++; else if (pred && !o) st.fp++; else st.tn++;
  st.recent.push({ p: pend.p, o }); if (st.recent.length > RECENT) st.recent.shift();
  // LEARN: nudge calibration so future probabilities track observed frequency.
  st.params = skill.updateParams(st.params, [{ p: pend.raw, outcome: o }]);
  save();
  return true;
}

function observeFromMagnitude(hazard, cell, observedMag) {
  return observe(hazard, cell, Number(observedMag) >= EVENT_MAG);
}

function report() {
  const hazards = {};
  for (const hz of HAZARDS) {
    const st = state[hz];
    if (!st || !st.n) { hazards[hz] = { n: 0, learning: true }; continue; }
    const probs = st.recent.map((s) => s.p); const outs = st.recent.map((s) => s.o);
    hazards[hz] = {
      n: st.n,
      brier: +(st.sumBrier / st.n).toFixed(4),
      brierUncalibrated: +(st.sumBrierRaw / st.n).toFixed(4),
      skillGain: +(((st.sumBrierRaw - st.sumBrier) / st.n)).toFixed(4), // >0 means calibration helps
      hitRate: st.tp + st.fn ? +(st.tp / (st.tp + st.fn)).toFixed(3) : null,
      falseAlarmRate: st.fp + st.tn ? +(st.fp / (st.fp + st.tn)).toFixed(3) : null,
      calibration: st.params,
      reliability: skill.reliability(probs, outs, 5),
      learning: st.n < 30,
    };
  }
  return { hazards, eventMag: EVENT_MAG, generatedAt: Date.now() };
}

// --- durable persistence of the compact learned state ---
function serialize() {
  const o = {};
  for (const hz in state) {
    const s = state[hz];
    o[hz] = { params: s.params, n: s.n, sumBrier: +s.sumBrier.toFixed(4), sumBrierRaw: +s.sumBrierRaw.toFixed(4), tp: s.tp, fn: s.fn, fp: s.fp, tn: s.tn };
  }
  return o;
}
function load(d) {
  if (!d) return;
  for (const hz in d) {
    const s = h(hz); const v = d[hz] || {};
    s.params = v.params && Number.isFinite(v.params.a) ? v.params : { a: 1, b: 0 };
    s.n = Number(v.n) || 0; s.sumBrier = Number(v.sumBrier) || 0; s.sumBrierRaw = Number(v.sumBrierRaw) || 0;
    s.tp = Number(v.tp) || 0; s.fn = Number(v.fn) || 0; s.fp = Number(v.fp) || 0; s.tn = Number(v.tn) || 0;
  }
}
function save() { if (store && store.save) { try { Promise.resolve(store.save(serialize())).catch(() => {}); } catch (e) {} } }
async function hydrate() { if (store && store.load) { try { load(await store.load()); } catch (e) {} } }
function _reset() { for (const k in state) delete state[k]; }

module.exports = { recordForecast, observe, observeFromMagnitude, report, usePersistence, hydrate, serialize, load, _reset, EVENT_MAG, HAZARDS };
