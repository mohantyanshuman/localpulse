// World Engine — an ENSEMBLE of self-learning forecast engines trained SIMULTANEOUSLY
// on real-time outcomes. For each hazard, several calibration engines (a no-calibration
// baseline plus logistic recalibrators at different learning rates) all update as events
// are confirmed; the engine with the best verified skill (lowest Brier) leads and
// supplies the live calibrated probability. Outcomes are confirmed by MULTIPLE
// mechanisms (services/eo/confirm) and scored both as a binary event (Brier, hit/false-
// alarm) and as continuous closeness (mean absolute error). Compact running state is
// persisted, so every engine keeps learning across stateless restarts.
const skill = require('./skill');
const confirm = require('./confirm');

const HAZARDS = ['flood', 'storm', 'air', 'heat', 'fire'];
const ENGINES = [
  { name: 'identity', lr: 0 },     // no-calibration baseline (control)
  { name: 'platt-slow', lr: 0.02 },
  { name: 'platt-mid', lr: 0.05 },
  { name: 'platt-fast', lr: 0.12 },
];
const MIN_LEAD = 20; // verified events before an engine may take the lead

const state = {};
let store = null;

function freshMember(e) { return { name: e.name, lr: e.lr, params: { a: 1, b: 0 }, n: 0, sumBrier: 0, sumMAE: 0 }; }
function h(hz) {
  if (!state[hz]) state[hz] = { members: ENGINES.map(freshMember), pending: {} };
  return state[hz];
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

// Record a forecast: the leading engine supplies the calibrated probability.
function recordForecast(hazard, cell, rawProb) {
  const st = h(hazard);
  const ld = leader(st);
  const p = skill.calibrate(rawProb, ld.params);
  st.pending[cell] = { raw: rawProb, ts: Date.now() };
  return p;
}

// Observe an outcome with multi-mechanism confirmation; train EVERY engine simultaneously.
function observe(hazard, cell, ctx) {
  const st = h(hazard);
  const pend = st.pending[cell];
  if (!pend) return false;
  delete st.pending[cell];
  const c = confirm.confirm(ctx || {});
  const o = c.occurred ? 1 : 0;
  for (const m of st.members) {
    const pc = skill.calibrate(pend.raw, m.params);
    m.n += 1;
    m.sumBrier += (pc - o) ** 2;
    m.sumMAE += Math.abs(pc - c.observedMag);     // continuous closeness error
    if (m.lr > 0) m.params = skill.updateParams(m.params, [{ p: pend.raw, outcome: o }], m.lr * c.confidence);
  }
  save();
  return true;
}

// Backward-compatible helper.
function observeFromMagnitude(hazard, cell, observedMag, sensorCount = 2, divergenceFlag = 'consensus') {
  return observe(hazard, cell, { observedMag, sensorCount, divergenceFlag });
}

function memberView(m) {
  return { name: m.name, n: m.n, brier: m.n ? +(m.sumBrier / m.n).toFixed(4) : null, closeness: m.n ? +(1 - m.sumMAE / m.n).toFixed(4) : null };
}

function report() {
  const hazards = {};
  for (const hz of HAZARDS) {
    const st = state[hz];
    if (!st) { hazards[hz] = { n: 0, learning: true, engines: ENGINES.length }; continue; }
    const ld = leader(st);
    const trained = st.members.reduce((mx, m) => Math.max(mx, m.n), 0);
    hazards[hz] = {
      n: trained,
      engines: st.members.length,
      leader: ld.name,
      leaderBrier: ld.n ? +(ld.sumBrier / ld.n).toFixed(4) : null,
      closeness: ld.n ? +(1 - ld.sumMAE / ld.n).toFixed(4) : null, // 1 = forecasts land exactly on outcomes
      calibration: ld.params,
      members: st.members.map(memberView),
      learning: trained < MIN_LEAD,
    };
  }
  return { hazards, eventMag: confirm.EVENT_MAG, ensemble: ENGINES.map((e) => e.name), generatedAt: Date.now() };
}

// --- durable persistence of compact ensemble state ---
function serialize() {
  const o = {};
  for (const hz in state) {
    o[hz] = state[hz].members.map((m) => ({ name: m.name, lr: m.lr, params: m.params, n: m.n, sumBrier: +m.sumBrier.toFixed(4), sumMAE: +m.sumMAE.toFixed(4) }));
  }
  return o;
}
function load(d) {
  if (!d) return;
  for (const hz in d) {
    const arr = Array.isArray(d[hz]) ? d[hz] : null;
    if (!arr) continue;
    const st = h(hz);
    st.members = ENGINES.map((e) => {
      const saved = arr.find((m) => m.name === e.name);
      return saved
        ? { name: e.name, lr: e.lr, params: saved.params && Number.isFinite(saved.params.a) ? saved.params : { a: 1, b: 0 }, n: Number(saved.n) || 0, sumBrier: Number(saved.sumBrier) || 0, sumMAE: Number(saved.sumMAE) || 0 }
        : freshMember(e);
    });
  }
}
function save() { if (store && store.save) { try { Promise.resolve(store.save(serialize())).catch(() => {}); } catch (e) {} } }
async function hydrate() { if (store && store.load) { try { load(await store.load()); } catch (e) {} } }
function _reset() { for (const k in state) delete state[k]; }

module.exports = { recordForecast, observe, observeFromMagnitude, report, leader, usePersistence, hydrate, serialize, load, _reset, EVENT_MAG: confirm.EVENT_MAG, HAZARDS, ENGINES };
