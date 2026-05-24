// Earth-observation fusion engine. Runs adapters in parallel through the cache,
// degrades gracefully, cross-validates overlapping signals, and emits one
// EOAssessment. Adding a satellite = adding an adapter to ADAPTERS.
const cache = require('./cache');

const ADAPTERS = [
  require('./adapters/firms'),
  require('./adapters/openmeteo-air'),
  require('./adapters/power'),
  require('./adapters/seismic'),
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

// Combine all signals on one axis into a per-hazard summary, raising confidence
// when independent sensors corroborate.
function summarizeAxis(axis, signals) {
  const sensors = [...new Set(signals.map((s) => s.sensor))];
  const top = signals.reduce((a, b) => (b.magnitude > a.magnitude ? b : a));
  const agreement = sensors.length >= 2 ? Math.min(0.2, 0.1 * (sensors.length - 1)) : 0;
  const confidence = Math.min(1, top.confidence + agreement);
  const gapNote = sensors.length >= 2
    ? `Corroborated by ${sensors.length} sensors (${sensors.join(', ')}).`
    : `Single-sensor read (${sensors[0]}); no corroborating sensor this cycle.`;
  return {
    axis,
    level: levelFromMagnitude(top.magnitude),
    magnitude: top.magnitude,
    confidence,
    sensorsUsed: sensors,
    gapNote,
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

  const level = perHazard.reduce((max, h) => (RANK[h.level] > RANK[max] ? h.level : max), 'ok');
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
