// Forecast-verification + self-learning math (standard, defensible meteorology + ML):
//  - Brier score, hit rate, false-alarm rate, reliability bins to MEASURE skill.
//  - Platt (logistic) recalibration to LEARN, from observed outcomes, a mapping that
//    makes predicted probabilities match observed event frequencies. Online SGD on
//    log-loss nudges the calibration toward reality as verified events accrue.
// This is honest self-improvement: as outcomes are observed, calibration error and
// Brier score measurably drop. No black box.

const clamp = (p, lo = 1e-6, hi = 1 - 1e-6) => Math.max(lo, Math.min(hi, p));
function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }
function logit(p) { const c = clamp(p); return Math.log(c / (1 - c)); }

// Brier score: mean squared error of probabilistic forecasts vs binary outcomes (0..1, lower better).
function brier(probs, outcomes) {
  if (!probs.length) return null;
  let s = 0;
  for (let i = 0; i < probs.length; i++) s += (probs[i] - outcomes[i]) ** 2;
  return +(s / probs.length).toFixed(4);
}

// Hit rate (sensitivity) and false-alarm rate at a decision threshold.
function rates(probs, outcomes, thresh = 0.5) {
  let tp = 0, fn = 0, fp = 0, tn = 0;
  for (let i = 0; i < probs.length; i++) {
    const pred = probs[i] >= thresh ? 1 : 0; const o = outcomes[i] ? 1 : 0;
    if (pred && o) tp++; else if (!pred && o) fn++; else if (pred && !o) fp++; else tn++;
  }
  return {
    hitRate: tp + fn ? +(tp / (tp + fn)).toFixed(3) : null,
    falseAlarmRate: fp + tn ? +(fp / (fp + tn)).toFixed(3) : null,
    tp, fn, fp, tn,
  };
}

// Apply learned calibration: p_cal = sigmoid(a*logit(p_raw) + b). Identity at a=1,b=0.
function calibrate(pRaw, params) {
  const a = params && Number.isFinite(params.a) ? params.a : 1;
  const b = params && Number.isFinite(params.b) ? params.b : 0;
  return +clamp(sigmoid(a * logit(pRaw) + b)).toFixed(4);
}

// One online (or batch) SGD step of Platt params on log-loss over samples {p, outcome}.
function updateParams(params, samples, lr = 0.05) {
  let a = params && Number.isFinite(params.a) ? params.a : 1;
  let b = params && Number.isFinite(params.b) ? params.b : 0;
  for (const s of samples || []) {
    if (!Number.isFinite(s.p)) continue;
    const x = logit(s.p);
    const pred = sigmoid(a * x + b);
    const err = pred - (s.outcome ? 1 : 0);
    a -= lr * err * x;
    b -= lr * err;
  }
  // keep params bounded for stability
  a = Math.max(0.05, Math.min(5, a));
  b = Math.max(-5, Math.min(5, b));
  return { a: +a.toFixed(4), b: +b.toFixed(4) };
}

// Reliability: observed frequency within probability bins (for a reliability diagram).
function reliability(probs, outcomes, bins = 5) {
  const out = [];
  for (let k = 0; k < bins; k++) {
    const lo = k / bins, hi = (k + 1) / bins;
    const idx = probs.map((p, i) => ({ p, o: outcomes[i] })).filter((d) => d.p >= lo && (k === bins - 1 ? d.p <= hi : d.p < hi));
    out.push({ bin: `${lo.toFixed(1)}-${hi.toFixed(1)}`, n: idx.length, observed: idx.length ? +(idx.reduce((a, d) => a + (d.o ? 1 : 0), 0) / idx.length).toFixed(3) : null });
  }
  return out;
}

module.exports = { sigmoid, logit, brier, rates, calibrate, updateParams, reliability, clamp };
