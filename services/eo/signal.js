// Normalized signal emitted by every adapter, and the fused assessment shape.
/**
 * @typedef {Object} Signal
 * @property {'fire'|'air'|'flood'|'vegetation'|'storm'|'power'|'seismic'} axis
 * @property {number} magnitude   normalized severity contribution, 0..1
 * @property {number} confidence  0..1, raised by fusion when sensors agree
 * @property {number} freshness   epoch ms of the underlying observation
 * @property {string} sensor      e.g. 'VIIRS NOAA-20'
 * @property {number} distanceKm  proximity of the observation to the point
 * @property {Object} [detail]    raw normalized values for the responder view
 */

/**
 * @typedef {Object} EOAssessment
 * @property {'ok'|'elevated'|'high'|'severe'} level
 * @property {Array<{axis:string, level:string, confidence:number, sensorsUsed:string[], gapNote:string, magnitude:number}>} perHazard
 * @property {string[]} sensorsUsed
 * @property {string[]} gapsCovered
 * @property {string[]} skipped   adapter ids skipped for missing tokens
 * @property {number} generatedAt
 */

const AXES = new Set(['fire', 'air', 'flood', 'vegetation', 'storm', 'power', 'seismic', 'heat']);

const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

function mkSignal({ axis, magnitude, confidence = 0.6, freshness = Date.now(), sensor, distanceKm, detail = {} }) {
  if (!AXES.has(axis)) throw new Error(`unknown axis: ${axis}`);
  return {
    axis,
    magnitude: clamp01(magnitude),
    confidence: clamp01(confidence),
    freshness,
    sensor: String(sensor || 'unknown'),
    distanceKm: Number.isFinite(distanceKm) ? distanceKm : null,
    detail,
  };
}

module.exports = { AXES, mkSignal, clamp01 };
