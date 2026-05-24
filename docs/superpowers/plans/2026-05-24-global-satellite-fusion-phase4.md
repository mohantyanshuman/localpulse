# Global Satellite Fusion — Phase 4 (Real-Time Predictions + UI) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (Agent Teams). Steps use checkbox (`- [ ]`).

**Goal:** Turn the fused current-state into **explainable near-term forecasts** (flood onset, storm arrival, air-quality worsening, heat buildup, fire-spread risk) driven by real forecast feeds + the current satellite assessment; add Sentinel-5P SO₂ and CO gas adapters; and surface both the new axes and the forecasts in the frontend Satellite Intelligence panel.

**Architecture:** A new `services/eo/predict.js` fetches three Open-Meteo forecast feeds (weather, flood discharge, air quality), runs five **pure, unit-tested predictor functions** over them plus the current `EOAssessment`, and returns `Prediction[]`. `/api/eo` attaches `predictions` to its response. Two more Sentinel-5P adapters (SO₂, CO) extend the air axis via the existing CDSE client. The frontend renders forecast cards + the new heat/storm axes.

**Reference templates:** `services/eo/adapters/sentinel5p-no2.js` (Copernicus gas adapter, dataMask evalscript), `services/eo/http.js` (`getJson`), `services/eo/cache.js` (`memo`, `cellKey`), `public/js/app.js` (`renderEO`, `el()` text-node helper).

**Bug-prevention note:** every CDSE evalscript MUST include the `dataMask` output (see existing sentinel adapters).

---

### Task 1: Prediction engine (`services/eo/predict.js`)

**Files:** Create `services/eo/predict.js` + `test/eo/predict.test.js`.

The five predictors are **pure functions** (no network) so they are fully unit-tested; `forecast()` orchestrates the cached fetches and calls them.

- [ ] **Step 1: Write the failing test** — `test/eo/predict.test.js`
```js
const test = require('node:test');
const assert = require('node:assert');
const P = require('../../services/eo/predict');

test('predictFlood flags a rising-discharge + heavy-rain onset', () => {
  const flood = { daily: { river_discharge: [10, 14, 22, 38, 60, 55, 40] } };
  const weather = { hourly: { precipitation: Array(48).fill(2) } }; // 96mm/48h
  const p = P.predictFlood(flood, weather);
  assert.strictEqual(p.hazard, 'flood');
  assert.strictEqual(p.likelihood, 'high');
  assert.ok(p.etaHours >= 0 && /discharge/i.test(p.reasoning));
});

test('predictFlood returns null when calm', () => {
  assert.strictEqual(P.predictFlood({ daily: { river_discharge: [10, 10, 10] } }, { hourly: { precipitation: [0, 0] } }), null);
});

test('predictStorm finds the peak-gust ETA', () => {
  const weather = { hourly: { time: ['t0','t1','t2','t3'], wind_gusts_10m: [20, 30, 95, 40], cape: [100, 200, 2600, 300], precipitation: [0,0,5,1] } };
  const p = P.predictStorm(weather);
  assert.strictEqual(p.hazard, 'storm');
  assert.strictEqual(p.etaHours, 2);
  assert.ok(['moderate','high'].includes(p.likelihood));
});

test('predictAir flags worsening AQI', () => {
  const aq = { hourly: { us_aqi: [60, 90, 140, 180, 175] } };
  const p = P.predictAir(aq);
  assert.strictEqual(p.hazard, 'air');
  assert.ok(['moderate','high'].includes(p.likelihood));
});

test('predictHeat flags a hot forecast day', () => {
  const weather = { daily: { time: ['d0','d1','d2'], temperature_2m_max: [33, 41, 44] } };
  const p = P.predictHeat(weather);
  assert.strictEqual(p.hazard, 'heat');
  assert.ok(p.etaHours >= 24);
});

test('predictFireSpread fires only with active fire + dry strong wind', () => {
  const assessment = { perHazard: [{ axis: 'fire', magnitude: 0.5, confidence: 0.9 }] };
  const weather = { hourly: { wind_speed_10m: [35, 38], relative_humidity_2m: [25, 22] } };
  const yes = P.predictFireSpread(assessment, weather);
  assert.strictEqual(yes.hazard, 'fire');
  assert.ok(['moderate','high'].includes(yes.likelihood));
  const noFire = P.predictFireSpread({ perHazard: [] }, weather);
  assert.strictEqual(noFire, null);
});
```

- [ ] **Step 2:** `npm test` → FAIL (module not found).

- [ ] **Step 3: Implement `services/eo/predict.js`**
```js
// Real-time near-term hazard forecasts. Fuses Open-Meteo forecast feeds (weather,
// flood discharge, air quality) with the current fused EOAssessment into explainable
// predictions: hazard, likelihood, ETA, confidence, reasoning, drivers.
const { getJson } = require('./http');
const cache = require('./cache');

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
  preds.sort((a, b) => RANK[b.likelihood] - RANK[a.likelihood]);
  return preds;
}

module.exports = { forecast, predictFlood, predictStorm, predictAir, predictHeat, predictFireSpread };
```

- [ ] **Step 4:** `npm test` → PASS. Report DONE (no commit).

---

### Task 2: Sentinel-5P SO₂ adapter (air)
**Files:** Create `services/eo/adapters/sentinel5p-so2.js` + `test/eo/sentinel5p-so2.test.js`. Model exactly on `sentinel5p-no2.js` (read it first), changing band `NO2`→`SO2`, sensor `Sentinel-5P TROPOMI (SO2)`, id `sentinel5p-so2`, and the magnitude scale (SO₂ column mol/m²: clean ~1e-4, volcanic/industrial spikes much higher; map over `[0, 1e-3]`). Evalscript MUST keep the dataMask output.

- [ ] **Step 1:** Test (mirror `sentinel5p-no2.test.js`): high SO₂ → higher air magnitude, sensor string correct, null when no value.
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** implement. **Step 4:** `npm test` → PASS. Report DONE (no commit).

### Task 3: Sentinel-5P CO adapter (air)
**Files:** Create `services/eo/adapters/sentinel5p-co.js` + `test/eo/sentinel5p-co.test.js`. Same pattern; band `CO` (carbon monoxide total column mol/m²: background ~0.03, combustion/fire plumes higher; map over `[0, 0.1]`), sensor `Sentinel-5P TROPOMI (CO)`, id `sentinel5p-co`. dataMask output required.

- [ ] Test → FAIL → implement → PASS. Report DONE (no commit).

---

### Controller integration (not for implementers)

### Task C1: Register SO₂/CO + attach predictions to `/api/eo`
**Files:** Modify `services/eo/fusion.js`, `server.js`; create `test/eo/forecast-endpoint.test.js`.

- [ ] Add `sentinel5p-so2` and `sentinel5p-co` to `ADAPTERS` in `fusion.js`.
- [ ] In `server.js` `/api/eo`, after building `assessment`, call `predict.forecast(loc.lat, loc.lng, assessment)` (best-effort try/catch, default `[]`) and include `predictions` in the JSON. Add `const predict = require('./services/eo/predict');` with the other eo requires.
- [ ] Integration test: `GET /api/eo?lat&lng` returns a `predictions` array.
- [ ] `npm test` → PASS.

### Task 4 (frontend): render predictions + ensure heat/storm show
**Files:** Modify `public/index.html`, `public/js/app.js`, `public/css/app.css`.

- [ ] In `index.html`, add a `<div id="eo-forecast"></div>` inside `#eo-panel` (after `#eo-cards`).
- [ ] In `app.js` `renderEO(data)`, after rendering cards, render `data.predictions` into `#eo-forecast` using the `el()` text-node helper (NOT innerHTML): for each prediction show `headline`, a `likelihood` chip, `reasoning`, and ETA. The existing card loop already renders every axis, so heat/storm appear automatically — no change needed for them.
- [ ] Add minimal `.eo-forecast` / `.eo-pred` styles in `app.css`.
- [ ] Manual check: `npm start`, `GET /` shows forecast block; `GET /api/eo?lat&lng` returns predictions.

---

## Self-Review
- Predictions: 5 explainable forecasts from real forecast feeds + current assessment; pure predictors unit-tested with fixtures; orchestration cached + degrading.
- Sensors: SO₂ + CO deepen the air axis (volcanic/industrial + combustion), reuse the working CDSE client, dataMask preserved.
- UI: forecasts surfaced; heat/storm already render via the existing per-axis loop; XSS-safe via `el()`.
- Isolation: Track 1 → predict.js; Track 2 → so2/co adapters; Frontend → public/*; Controller → fusion.js + server.js. Disjoint.

## Out of scope
- ML/temporal models beyond the providers' own numerical forecasts (we fuse real forecast feeds, not a trained predictor).
- Fire-spread bearing math (we use active-fire-nearby + wind/humidity, not per-fire vector geometry) — documented simplification.
