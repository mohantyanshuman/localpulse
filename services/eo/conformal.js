// Split-conformal distribution-free intervals. Given past nonconformity scores
// (|predicted - observed|), the (1-alpha) empirical quantile bounds the error with
// guaranteed marginal coverage once enough samples exist.
const MIN_CAL = 30;

function conformalQuantile(scores, alpha) {
  const s = (scores || []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const n = s.length;
  const rank = Math.ceil((1 - alpha) * (n + 1));
  const idx = Math.min(n - 1, Math.max(0, rank - 1));
  return s[idx];
}

function interval(pred, scores, alpha = 0.1) {
  const q = conformalQuantile(scores || [], alpha);
  const calibrated = (scores || []).length >= MIN_CAL && q != null;
  const half = calibrated ? q : 0.25; // honest wide default before calibration
  return {
    calibrated,
    coverage: calibrated ? 1 - alpha : null,
    low: +Math.max(0, pred - half).toFixed(3),
    high: +Math.min(1, pred + half).toFixed(3),
    n: (scores || []).length,
  };
}

module.exports = { conformalQuantile, interval, MIN_CAL };
