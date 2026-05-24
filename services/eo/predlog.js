// Prediction log feeding conformal calibration. In-memory ring (capped); a persist
// hook can later durably store + attach observed outcomes. Nonconformity score =
// |predictedMagnitude - observedMagnitude| once an outcome is attached.
const MAX = 5000;
const log = []; // { ts, cell, hazard, pred, observed? }

function record(entry) {
  log.push({ ts: Date.now(), ...entry });
  if (log.length > MAX) log.splice(0, log.length - MAX);
}

function attachOutcome(cell, hazard, observed, withinMs = 48 * 3600 * 1000) {
  const now = Date.now();
  for (const e of log) {
    if (e.cell === cell && e.hazard === hazard && e.observed == null && now - e.ts <= withinMs) {
      e.observed = observed;
    }
  }
}

function scores(hazard) {
  return log
    .filter((e) => e.hazard === hazard && e.observed != null)
    .map((e) => Math.abs(e.pred - e.observed));
}

function _reset() { log.length = 0; }

module.exports = { record, attachOutcome, scores, _reset };
