// Real-time near-term hazard forecasts. Fuses Open-Meteo forecast feeds (weather,
// flood discharge, air quality) with the current fused EOAssessment into explainable
// predictions: hazard, likelihood, ETA, confidence, reasoning, drivers.
const { getJson } = require('./http');
const cache = require('./cache');
const physics = require('./physics');
const conformal = require('./conformal');
const predlog = require('./predlog');
const world = require('./world');

const LK_MAG = { low: 0.35, moderate: 0.6, high: 0.85 };

const sum = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n).map(Number).filter(Number.isFinite).reduce((a, b) => a + b, 0) : 0);
const finite = (arr) => (Array.isArray(arr) ? arr.map(Number).filter(Number.isFinite) : []);

// --- pure predictors (unit-tested, no network) ---

function predictFlood(flood, weather) {
  const disc = finite(flood && flood.daily && flood.daily.river_discharge);
  if (disc.length < 2) return null;
  const today = disc[0];
  const peak = Math.max(...disc);
  const peakDay = disc.indexOf(peak);
  const rise = today > 0 ? (peak - today) / today : (peak > 0 ? 1 : 0);
  const rain48 = sum(weather && weather.hourly && weather.hourly.precipitation, 48);
  let likelihood = 'low';
  if (rise > 1.0 || rain48 > 80) likelihood = 'high';
  else if (rise > 0.4 || rain48 > 40) likelihood = 'moderate';
  if (likelihood === 'low') return null;
  return {
    hazard: 'flood', likelihood,
    windowHours: (peakDay + 1) * 24, etaHours: peakDay * 24,
    confidence: 0.7,
    headline: `Flood risk ${likelihood} within ${peakDay + 1} day(s)`,
    reasoning: `River discharge ${rise >= 0 ? '+' : ''}${Math.round(rise * 100)}% to a peak around day ${peakDay}; ${Math.round(rain48)} mm rain forecast in the next 48 h.`,
    drivers: { todayDischarge: today, peakDischarge: peak, peakDay, rain48mm: Math.round(rain48) },
  };
}

function predictStorm(weather) {
  const h = (weather && weather.hourly) || {};
  const gusts = finite(h.wind_gusts_10m);
  if (!gusts.length) return null;
  const cape = finite(h.cape);
  const peakGust = Math.max(...gusts);
  const eta = gusts.indexOf(peakGust);
  const peakCape = cape.length ? Math.max(...cape) : 0;
  let likelihood = 'low';
  if (peakGust >= 90 || peakCape >= 2500) likelihood = 'high';
  else if (peakGust >= 60 || peakCape >= 1000) likelihood = 'moderate';
  if (likelihood === 'low') return null;
  return {
    hazard: 'storm', likelihood,
    windowHours: 48, etaHours: eta,
    confidence: 0.7,
    headline: `Storm risk ${likelihood} in ~${eta} h`,
    reasoning: `Peak wind gusts ~${Math.round(peakGust)} km/h with CAPE ~${Math.round(peakCape)} J/kg forecast around hour ${eta}.`,
    drivers: { peakGustKmh: Math.round(peakGust), peakCape: Math.round(peakCape), etaHours: eta },
  };
}

function predictAir(aq) {
  const aqi = finite(aq && aq.hourly && aq.hourly.us_aqi);
  if (aqi.length < 2) return null;
  const now = aqi[0];
  const peak = Math.max(...aqi);
  const eta = aqi.indexOf(peak);
  let likelihood = 'low';
  if (peak >= 150 && peak > now + 20) likelihood = 'high';
  else if (peak >= 100 && peak > now + 10) likelihood = 'moderate';
  if (likelihood === 'low') return null;
  return {
    hazard: 'air', likelihood,
    windowHours: aqi.length, etaHours: eta,
    confidence: 0.75,
    headline: `Air quality worsening (${likelihood})`,
    reasoning: `US AQI forecast to rise from ${Math.round(now)} to ~${Math.round(peak)} around hour ${eta}.`,
    drivers: { nowAqi: Math.round(now), peakAqi: Math.round(peak), etaHours: eta },
  };
}

function predictHeat(weather) {
  const tmax = finite(weather && weather.daily && weather.daily.temperature_2m_max);
  if (!tmax.length) return null;
  const peak = Math.max(...tmax);
  const day = tmax.indexOf(peak);
  let likelihood = 'low';
  if (peak >= 42) likelihood = 'high';
  else if (peak >= 38) likelihood = 'moderate';
  if (likelihood === 'low') return null;
  return {
    hazard: 'heat', likelihood,
    windowHours: (day + 1) * 24, etaHours: day * 24,
    confidence: 0.7,
    headline: `Extreme heat ${likelihood} in ${day} day(s)`,
    reasoning: `Forecast daily max reaches ~${Math.round(peak)} C around day ${day}.`,
    drivers: { peakTempC: Math.round(peak), day },
  };
}

function predictFireSpread(assessment, weather) {
  const fire = (assessment && assessment.perHazard || []).find((h) => h.axis === 'fire');
  if (!fire || fire.magnitude < 0.2) return null; // no active fire nearby
  const h = (weather && weather.hourly) || {};
  const wind = finite(h.wind_speed_10m);
  const rh = finite(h.relative_humidity_2m);
  const peakWind = wind.length ? Math.max(...wind) : 0;
  const minRh = rh.length ? Math.min(...rh) : 100;
  let likelihood = 'low';
  if (peakWind >= 30 && minRh <= 30) likelihood = 'high';
  else if (peakWind >= 20 && minRh <= 45) likelihood = 'moderate';
  if (likelihood === 'low') return null;
  return {
    hazard: 'fire', likelihood,
    windowHours: 24, etaHours: 0,
    confidence: Math.min(0.9, fire.confidence || 0.7),
    headline: `Fire-spread risk ${likelihood}`,
    reasoning: `Active fire detected nearby (sensors agree) with forecast winds up to ${Math.round(peakWind)} km/h and humidity down to ${Math.round(minRh)}%.`,
    drivers: { fireMagnitude: fire.magnitude, peakWindKmh: Math.round(peakWind), minHumidity: Math.round(minRh) },
  };
}

const RANK = { low: 0, moderate: 1, high: 2 };

// --- orchestration ---
async function forecast(lat, lng, assessment) {
  const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&hourly=wind_gusts_10m,wind_speed_10m,relative_humidity_2m,cape,precipitation` +
    `&daily=temperature_2m_max&forecast_days=3&timezone=auto`;
  const fUrl = `https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lng}&daily=river_discharge&forecast_days=7`;
  const aUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&hourly=us_aqi&forecast_days=2`;
  const key = cache.cellKey(lat, lng);
  const [weather, flood, aq] = await Promise.all([
    cache.memo(`fc-w:${key}`, 30 * 60 * 1000, () => getJson(wUrl, 8000).catch(() => null)),
    cache.memo(`fc-f:${key}`, 60 * 60 * 1000, () => getJson(fUrl, 8000).catch(() => null)),
    cache.memo(`fc-a:${key}`, 30 * 60 * 1000, () => getJson(aUrl, 8000).catch(() => null)),
  ]);
  const preds = [
    predictFlood(flood, weather),
    predictStorm(weather),
    predictAir(aq),
    predictHeat(weather),
    predictFireSpread(assessment, weather),
  ].filter(Boolean);

  // Physics constraint: enrich fire (Rothermel reach) and flood (terrain runoff) with
  // satellite-derived terrain. Best-effort; never blocks the forecast.
  let terr = null;
  try { terr = await physics.terrain(lat, lng); } catch { terr = null; }
  if (terr) {
    const h = (weather && weather.hourly) || {};
    const peakWind = Math.max(0, ...finite(h.wind_speed_10m));
    const minRh = finite(h.relative_humidity_2m).length ? Math.min(...finite(h.relative_humidity_2m)) : 100;
    const fire = preds.find((p) => p.hazard === 'fire');
    if (fire) {
      const ros = physics.fireRateOfSpread({ drynessP: Math.max(0, Math.min(1, (100 - minRh) / 100)), windKmh: peakWind, slopeDeg: terr.slopeDeg });
      fire.drivers = { ...fire.drivers, rosMPerMin: ros.rosMPerMin, reachKm1h: ros.reachKm1h, slopeDeg: terr.slopeDeg };
      fire.reasoning += ` Physics: ~${ros.reachKm1h} km/h spread reach on ${terr.slopeDeg} deg slope.`;
    }
    const fl = preds.find((p) => p.hazard === 'flood');
    if (fl) {
      const rainMmPerH = sum(h.precipitation, 6) / 6;
      const onset = physics.floodOnsetFactor({ rainMmPerH, slopeDeg: terr.slopeDeg });
      fl.drivers = { ...fl.drivers, terrainOnsetFactor: onset, slopeDeg: terr.slopeDeg };
      fl.reasoning += ` Physics: terrain runoff factor ${onset} on ${terr.slopeDeg} deg slope.`;
    }
  }

  // Conformal calibration loop: the current observed per-axis magnitude is the realized
  // outcome for predictions made earlier for this cell/hazard. Attach it (closes the
  // loop so intervals actually mature), then log the new predictions and attach a
  // distribution-free interval from accrued nonconformity scores.
  const cell = cache.cellKey(lat, lng);
  for (const h of (assessment && assessment.perHazard) || []) {
    if (['flood', 'storm', 'air', 'heat', 'fire'].includes(h.axis)) {
      const observedMag = Math.max(0, Math.min(1, h.magnitude || 0));
      predlog.attachOutcome(cell, h.axis, observedMag);
      // World Engine: resolve whether a previously-forecast event actually occurred,
      // scoring skill and recalibrating the predictor from reality.
      world.observeFromMagnitude(h.axis, cell, observedMag);
    }
  }
  for (const p of preds) {
    const mag = LK_MAG[p.likelihood] || 0.5;
    predlog.record({ cell, hazard: p.hazard, pred: mag });
    p.interval = conformal.interval(mag, predlog.scores(p.hazard), 0.1);
    // Attach the self-learned, calibrated probability and remember it pending an outcome.
    p.probability = world.recordForecast(p.hazard, cell, mag);
  }

  preds.sort((a, b) => RANK[b.likelihood] - RANK[a.likelihood]);
  return preds;
}

module.exports = { forecast, predictFlood, predictStorm, predictAir, predictHeat, predictFireSpread };
