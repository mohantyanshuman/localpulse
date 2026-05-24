// Prediction log feeding conformal calibration. Pending predictions live in-memory
// until an outcome is observed; the resulting nonconformity score (|predicted -
// observed|) is kept in scoreList AND durably persisted (if a store is wired) so the
// calibration survives cold starts. scores(hazard) feeds services/eo/conformal.
const MAX = 5000;
const log = [];        // pending: { ts, cell, hazard, pred, observed? }
const scoreList = [];  // completed nonconformity scores: { hazard, score, ts }
let store = null;      // optional durable adapter: { add(item), list() }

function usePersistence(s) { store = s; }

function record(entry) {
  log.push({ ts: Date.now(), ...entry });
  if (log.length > MAX) log.splice(0, log.length - MAX);
}

function attachOutcome(cell, hazard, observed, withinMs = 48 * 3600 * 1000) {
  const now = Date.now();
  for (const e of log) {
    if (e.cell === cell && e.hazard === hazard && e.observed == null && now - e.ts <= withinMs) {
      e.observed = observed;
      const score = Math.abs(e.pred - observed);
      scoreList.push({ hazard, score, ts: now });
      if (store && store.add) { try { Promise.resolve(store.add({ cell, hazard, score, ts: now })).catch(() => {}); } catch (err) {} }
    }
  }
  if (scoreList.length > MAX) scoreList.splice(0, scoreList.length - MAX);
}

function scores(hazard) {
  return scoreList.filter((s) => s.hazard === hazard).map((s) => s.score);
}

// Load durable scores on boot so calibration is not lost on scale-to-zero restarts.
async function hydrate() {
  if (!store || !store.list) return;
  try {
    const rows = await store.list();
    for (const r of rows || []) {
      if (r && r.hazard && Number.isFinite(r.score)) scoreList.push({ hazard: r.hazard, score: Number(r.score), ts: r.ts || Date.now() });
    }
  } catch (err) { /* durable store optional */ }
}

function _reset() { log.length = 0; scoreList.length = 0; }

module.exports = { record, attachOutcome, scores, hydrate, usePersistence, _reset };
