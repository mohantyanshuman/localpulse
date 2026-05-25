// Automatic confirmation of whether a forecast event materialized, using MULTIPLE
// independent mechanisms rather than a single yes/no:
//   1. Consensus magnitude — the fused multi-sensor estimate of what actually happened.
//   2. Corroboration — how many INDEPENDENT sensors saw it (a lone-sensor blip is not a
//      confirmed event); raises/lowers confirmation confidence.
//   3. Divergence flag — a 'suspect' axis (an implausible outlier feed) lowers confidence.
// It returns both a binary occurrence AND a continuous "closeness" so the engine can
// learn from HOW CLOSE a forecast was, not only whether it was right.
const EVENT_MAG = 0.55;

function confirm({ observedMag, sensorCount = 1, divergenceFlag = 'consensus' } = {}) {
  const mag = Math.max(0, Math.min(1, Number(observedMag) || 0));
  let confidence = sensorCount >= 3 ? 1 : sensorCount === 2 ? 0.8 : 0.5;
  if (divergenceFlag === 'suspect') confidence *= 0.5;
  // Require corroboration (>=2 independent sensors) for a magnitude to count as a
  // confirmed event; a single-sensor high reading is treated as unconfirmed.
  const occurred = mag >= EVENT_MAG && sensorCount >= 2;
  return { observedMag: mag, occurred, confidence: +confidence.toFixed(2), sensorCount };
}

// Continuous accuracy of a probabilistic forecast vs the realized magnitude (1 = exact).
function closeness(predProb, observedMag) {
  return +(1 - Math.abs(Number(predProb) - Number(observedMag))).toFixed(4);
}

module.exports = { confirm, closeness, EVENT_MAG };
