// Cross-sensor divergence: treat each sensor's magnitude as Bernoulli(p) and measure
// Jensen-Shannon divergence between sensors on the same axis. High divergence means
// the sensors disagree -> either a blindspot (one sees a hazard others miss) or a
// suspect feed (an implausible outlier to down-weight).
function kl(p, q) {
  const e = 1e-9;
  p = Math.min(1 - e, Math.max(e, p));
  q = Math.min(1 - e, Math.max(e, q));
  return p * Math.log2(p / q) + (1 - p) * Math.log2((1 - p) / (1 - q));
}

function jsDivergence(p1, p2) {
  const m = (p1 + p2) / 2;
  return Math.max(0, Math.min(1, 0.5 * kl(p1, m) + 0.5 * kl(p2, m)));
}

function analyzeAxis(axis, signals) {
  const mags = signals.map((s) => Math.max(0, Math.min(1, s.magnitude)));
  if (mags.length < 2) return { axis, divergence: 0, flag: 'single', outlier: null };
  let sum = 0, cnt = 0;
  for (let i = 0; i < mags.length; i++) {
    for (let j = i + 1; j < mags.length; j++) { sum += jsDivergence(mags[i], mags[j]); cnt++; }
  }
  const divergence = +(sum / cnt).toFixed(3);
  const max = Math.max(...mags), min = Math.min(...mags);
  const mean = mags.reduce((a, b) => a + b, 0) / mags.length;
  if (divergence >= 0.3) {
    // A lone HIGH outlier (above-mean deviation dominates) is a possible emerging
    // hazard others miss -> 'blindspot'. A lone LOW outlier among higher sensors is a
    // likely degraded/failed feed -> 'suspect'. The outlier is the deviating sensor.
    const aboveDominates = (max - mean) > (mean - min);
    const flag = aboveDominates ? 'blindspot' : 'suspect';
    const outlierMag = aboveDominates ? max : min;
    const sig = signals[mags.indexOf(outlierMag)];
    return { axis, divergence, flag, outlier: sig ? sig.sensor : null };
  }
  return { axis, divergence, flag: 'consensus', outlier: null };
}

module.exports = { jsDivergence, analyzeAxis };
