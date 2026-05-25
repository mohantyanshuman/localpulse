// Earth-observation fusion engine. Runs adapters in parallel through the cache,
// degrades gracefully, cross-validates overlapping signals, and emits one
// EOAssessment. Adding a satellite = adding an adapter to ADAPTERS.
const cache = require('./cache');
const divergence = require('./divergence');

const ADAPTERS = [
  require('./adapters/firms'),
  require('./adapters/openmeteo-air'),
  require('./adapters/power'),
  require('./adapters/seismic'),
  require('./adapters/sentinel5p'),
  require('./adapters/sentinel2'),
  require('./adapters/sentinel1'),
  require('./adapters/sentinel5p-no2'),
  require('./adapters/sentinel5p-so2'),
  require('./adapters/sentinel5p-co'),
  require('./adapters/sentinel3'),
  require('./adapters/storm'),
  require('./adapters/glofas'),
];

function hasReqs(a) {
  return (a.requires || []).every((k) => !!process.env[k]);
}

function levelFromMagnitude(m) {
  if (m >= 0.8) return 'severe';
  if (m >= 0.55) return 'high';
  if (m >= 0.3) return 'elevated';
  return 'ok';
}

const RANK = { ok: 0, elevated: 1, high: 2, severe: 3 };

// Confidence-weighted overall level. A hazard's effective magnitude is
// magnitude x confidence, so a low-confidence single-sensor proxy cannot drive
// the headline level on its own; but any axis that is both extreme (>=0.8) and
// trustworthy (confidence >=0.7) still forces at least 'high'. Per-axis levels
// stay raw for honesty; only this roll-up is weighted.
function overallLevel(perHazard) {
  let topEff = 0;
  let forced = 'ok';
  for (const h of perHazard) {
    const eff = h.magnitude * h.confidence;
    if (eff > topEff) topEff = eff;
    if (h.magnitude >= 0.8 && h.confidence >= 0.7 && RANK.high > RANK[forced]) forced = 'high';
  }
  const weighted = levelFromMagnitude(topEff);
  return RANK[weighted] >= RANK[forced] ? weighted : forced;
}

// Combine all signals on one axis into a per-hazard summary, raising confidence
// when independent sensors corroborate.
function summarizeAxis(axis, signals) {
  const sensors = [...new Set(signals.map((s) => s.sensor))];
  const top = signals.reduce((a, b) => (b.magnitude > a.magnitude ? b : a));
  const agreement = sensors.length >= 2 ? Math.min(0.2, 0.1 * (sensors.length - 1)) : 0;
  const div = divergence.analyzeAxis(axis, signals);

  // Anti-spoof attenuation: when divergence flags an implausible 'suspect' outlier,
  // exclude that outlier from the representative magnitude so a single rogue/degraded
  // feed cannot drive the hazard level, and reduce confidence. (Reduces to practice
  // Claim 1(b): "attenuate the contribution of an outlier source".)
  let repMag = top.magnitude;
  let confidence = Math.min(1, top.confidence + agreement);
  let attenuated = false;
  let gapNote;
  if (div.flag === 'suspect' && div.outlier) {
    // Lone LOW outlier = likely degraded feed; drop it so it cannot hide a real
    // consensus hazard. Level set from the corroborating sensors.
    const others = signals.filter((s) => s.sensor !== div.outlier);
    if (others.length) {
      repMag = others.reduce((m, s) => Math.max(m, s.magnitude), 0);
      confidence = Math.min(1, confidence * 0.85);
      attenuated = true;
      gapNote = `Attenuated a suspect feed (${div.outlier}); level from ${others.length} corroborating sensor(s).`;
    }
  } else if (div.flag === 'blindspot' && div.outlier && sensors.length >= 2) {
    // Lone HIGH uncorroborated outlier = possible emerging hazard OR spoof. Cap its
    // solo influence so one unverified feed cannot force the maximum alarm, while
    // still surfacing it as an early-warning (anti-false-alarm + no-suppression).
    repMag = Math.min(top.magnitude, 0.6);
    confidence = Math.min(1, confidence * 0.7);
    attenuated = true;
    gapNote = `Early-warning: only ${div.outlier} reports this; solo influence capped pending corroboration.`;
  }
  if (!gapNote) {
    gapNote = sensors.length >= 2
      ? `Corroborated by ${sensors.length} sensors (${sensors.join(', ')}).`
      : `Single-sensor read (${sensors[0]}); no corroborating sensor this cycle.`;
  }
  return {
    axis,
    level: levelFromMagnitude(repMag),
    magnitude: repMag,
    rawMagnitude: top.magnitude,
    attenuated,
    confidence,
    sensorsUsed: sensors,
    gapNote,
    divergence: div.divergence,
    divergenceFlag: div.flag,
    divergenceOutlier: div.outlier,
  };
}

function fuseSignals(signals, skipped) {
  const byAxis = new Map();
  for (const s of signals) {
    if (!byAxis.has(s.axis)) byAxis.set(s.axis, []);
    byAxis.get(s.axis).push(s);
  }
  const perHazard = [...byAxis.entries()]
    .map(([axis, sigs]) => summarizeAxis(axis, sigs))
    .sort((a, b) => b.magnitude - a.magnitude);

  const level = overallLevel(perHazard);
  const sensorsUsed = [...new Set(signals.map((s) => s.sensor))];
  const gapsCovered = perHazard.filter((h) => h.sensorsUsed.length >= 2).map((h) => `${h.axis}: ${h.gapNote}`);

  return { level, perHazard, sensorsUsed, gapsCovered, skipped, generatedAt: Date.now() };
}

async function fuse(lat, lng) {
  const active = ADAPTERS.filter(hasReqs);
  const skipped = ADAPTERS.filter((a) => !hasReqs(a)).map((a) => a.id);
  const results = await Promise.all(
    active.map((a) =>
      cache.memo(`${a.id}:${cache.cellKey(lat, lng)}`, a.ttlMs, () =>
        Promise.resolve()
          .then(() => a.query(lat, lng))
          .catch(() => [])
      )
    )
  );
  return fuseSignals(results.flat().filter(Boolean), skipped);
}

module.exports = { fuse, fuseSignals, levelFromMagnitude, ADAPTERS };
