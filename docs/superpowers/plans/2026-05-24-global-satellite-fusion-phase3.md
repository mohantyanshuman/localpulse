# Global Satellite Fusion — Phase 3 (Coverage + Calibration) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (Agent Teams). Steps use checkbox (`- [ ]`).

**Goal:** Close coverage gaps and calibrate the verdict: add a **storm** axis (Open-Meteo) and a **heat** axis (Sentinel-3 SLSTR LST), deepen flood (Open-Meteo GloFAS) and air (Sentinel-5P NO₂), and make the overall level **confidence-weighted** so a lone low-confidence proxy no longer over-alarms.

**Architecture:** Same proven adapter contract (`{id,axes,requires,ttlMs,query}` → `Signal[]` via `mkSignal`). New adapters reuse `services/eo/http.js` (keyless) or `services/eo/sentinelhub.js` (Copernicus). A new `heat` axis is added to `services/eo/signal.js`. Fusion's overall-level computation becomes confidence-weighted.

**Reference templates (read first):** `services/eo/adapters/openmeteo-air.js`, `services/eo/adapters/power.js` (keyless GET + toSignal), `services/eo/adapters/sentinel5p.js` (Copernicus + dataMask evalscript), `services/eo/fusion.js`, `services/eo/signal.js`.

**CRITICAL lesson baked in:** every CDSE Statistical API evalscript MUST declare a `dataMask` output (`output:[{id:"data",bands:1},{id:"dataMask",bands:1}]` and return `dataMask:[s.dataMask]`), or the request is rejected and the adapter returns empty.

---

## Track A (keyless) — storm + flood

### Task A1: Add `heat` axis to signal.js
**Files:** Modify `services/eo/signal.js`; modify `test/eo/signal.test.js`.

- [ ] **Step 1:** In `services/eo/signal.js`, add `'heat'` to the AXES set:
```js
const AXES = new Set(['fire', 'air', 'flood', 'vegetation', 'storm', 'power', 'seismic', 'heat']);
```
- [ ] **Step 2:** Update the axes test in `test/eo/signal.test.js` to expect the new sorted list:
```js
  assert.deepStrictEqual(
    [...AXES].sort(),
    ['air', 'fire', 'flood', 'heat', 'power', 'seismic', 'storm', 'vegetation']
  );
```
- [ ] **Step 3:** `npm test` → PASS. Report DONE (no commit).

### Task A2: Open-Meteo storm adapter (storm axis)
**Files:** Create `services/eo/adapters/storm.js` + `test/eo/storm.test.js`.

Open-Meteo forecast (keyless): `https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&current=wind_speed_10m,wind_gusts_10m,precipitation&hourly=cape&forecast_days=1&timezone=auto`. Map wind gusts + CAPE to a storm magnitude.

- [ ] **Step 1: Failing test** — `test/eo/storm.test.js`
```js
const test = require('node:test');
const assert = require('node:assert');
const { toSignal } = require('../../services/eo/adapters/storm');

test('high gusts and CAPE produce a high storm magnitude', () => {
  const s = toSignal({ current: { wind_gusts_10m: 90, precipitation: 5, time: '2026-05-24T08:00' }, hourly: { cape: [2500] } }, { lat: 1, lng: 1 });
  assert.strictEqual(s.axis, 'storm');
  assert.ok(s.magnitude > 0.6, `severe gusts should score high, got ${s.magnitude}`);
});

test('calm conditions produce low magnitude', () => {
  const s = toSignal({ current: { wind_gusts_10m: 10, precipitation: 0, time: '2026-05-24T08:00' }, hourly: { cape: [100] } }, { lat: 1, lng: 1 });
  assert.ok(s.magnitude < 0.2);
});

test('toSignal returns null when no current block', () => {
  assert.strictEqual(toSignal({}, { lat: 1, lng: 1 }), null);
});
```
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implement `services/eo/adapters/storm.js`**
```js
// Open-Meteo storm proxy: wind gusts + convective available potential energy (CAPE)
// + precipitation. Keyless. Fills the previously-uncovered storm axis.
const { getJson } = require('../http');
const { mkSignal } = require('../signal');

// Gusts: 60 km/h notable, 90 damaging, 120+ severe. CAPE: 1000 thunderstorm, 2500 severe.
function toSignal(j, center) {
  const c = j && j.current;
  if (!c) return null;
  const gust = Number(c.wind_gusts_10m) || 0;
  const cape = (j.hourly && Array.isArray(j.hourly.cape) && Math.max(...j.hourly.cape.map(Number).filter(Number.isFinite))) || 0;
  const precip = Number(c.precipitation) || 0;
  const gustMag = Math.max(0, Math.min(1, (gust - 30) / 90));
  const capeMag = Math.max(0, Math.min(1, cape / 2500));
  const precipMag = Math.max(0, Math.min(1, precip / 20));
  const magnitude = Math.max(0, Math.min(1, 0.5 * gustMag + 0.35 * capeMag + 0.15 * precipMag));
  return mkSignal({
    axis: 'storm',
    magnitude,
    confidence: 0.7,
    freshness: Date.parse(c.time) || Date.now(),
    sensor: 'Open-Meteo (GFS/ECMWF)',
    distanceKm: 0,
    detail: { gustKmh: gust, cape, precipMm: precip },
  });
}

async function query(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=wind_speed_10m,wind_gusts_10m,precipitation&hourly=cape&forecast_days=1&timezone=auto`;
  const j = await getJson(url, 8000);
  const s = toSignal(j, { lat, lng });
  return s ? [s] : [];
}

module.exports = { id: 'storm', axes: ['storm'], requires: [], ttlMs: 30 * 60 * 1000, query, toSignal };
```
- [ ] **Step 4:** `npm test` → PASS. Report DONE (no commit).

### Task A3: Open-Meteo GloFAS flood adapter (flood axis, 3rd sensor)
**Files:** Create `services/eo/adapters/glofas.js` + `test/eo/glofas.test.js`.

Open-Meteo Flood API (keyless): `https://flood-api.open-meteo.com/v1/flood?latitude=..&longitude=..&daily=river_discharge&forecast_days=7`. A discharge spike vs recent baseline = flood risk.

- [ ] **Step 1: Failing test** — `test/eo/glofas.test.js`
```js
const test = require('node:test');
const assert = require('node:assert');
const { toSignal } = require('../../services/eo/adapters/glofas');

test('a discharge surge above baseline yields elevated flood magnitude', () => {
  const s = toSignal({ daily: { river_discharge: [10, 11, 12, 40, 55] } }, { lat: 1, lng: 1 });
  assert.strictEqual(s.axis, 'flood');
  assert.ok(s.magnitude > 0.5, `surge should be elevated, got ${s.magnitude}`);
});

test('flat discharge yields low magnitude', () => {
  const s = toSignal({ daily: { river_discharge: [10, 10, 10, 10, 10] } }, { lat: 1, lng: 1 });
  assert.ok(s.magnitude < 0.2);
});

test('returns null without discharge data', () => {
  assert.strictEqual(toSignal({ daily: {} }, { lat: 1, lng: 1 }), null);
});
```
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implement `services/eo/adapters/glofas.js`**
```js
// Open-Meteo GloFAS river discharge (satellite + model reanalysis). Keyless.
// Third, independent flood sensor (alongside NASA POWER and Sentinel-1 SAR):
// a discharge peak well above the recent baseline signals rising water.
const { getJson } = require('../http');
const { mkSignal } = require('../signal');

function toSignal(j, center) {
  const arr = j && j.daily && Array.isArray(j.daily.river_discharge)
    ? j.daily.river_discharge.map(Number).filter(Number.isFinite) : null;
  if (!arr || arr.length < 2) return null;
  const peak = Math.max(...arr);
  const baseline = arr.slice(0, Math.max(1, Math.floor(arr.length / 2)));
  const base = baseline.reduce((a, b) => a + b, 0) / baseline.length || 1e-6;
  const ratio = peak / base; // 1 = flat, >2 = strong surge
  const magnitude = Math.max(0, Math.min(1, (ratio - 1) / 3));
  return mkSignal({
    axis: 'flood',
    magnitude,
    confidence: 0.65,
    freshness: Date.now(),
    sensor: 'GloFAS (Open-Meteo)',
    distanceKm: 0,
    detail: { peak, base: +base.toFixed(2), ratio: +ratio.toFixed(2) },
  });
}

async function query(lat, lng) {
  const url = `https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lng}&daily=river_discharge&forecast_days=7`;
  const j = await getJson(url, 8000);
  const s = toSignal(j, { lat, lng });
  return s ? [s] : [];
}

module.exports = { id: 'glofas', axes: ['flood'], requires: [], ttlMs: 6 * 60 * 60 * 1000, query, toSignal };
```
- [ ] **Step 4:** `npm test` → PASS. Report DONE (no commit).

---

## Track B (Copernicus) — pollution + heat

### Task B1: Sentinel-5P NO₂ adapter (air axis)
**Files:** Create `services/eo/adapters/sentinel5p-no2.js` + `test/eo/sentinel5p-no2.test.js`.

Same CDSE client; band `NO2` (tropospheric column, mol/m²). Typical clean ~5e-5, polluted ~2e-4+. **Evalscript MUST include dataMask output.**

- [ ] **Step 1: Failing test** — `test/eo/sentinel5p-no2.test.js`
```js
const test = require('node:test');
const assert = require('node:assert');
const { toSignal } = require('../../services/eo/adapters/sentinel5p-no2');

test('high NO2 column yields a higher air magnitude', () => {
  const hi = toSignal(0.0002, { lat: 1, lng: 1 });
  const lo = toSignal(0.00002, { lat: 1, lng: 1 });
  assert.strictEqual(hi.axis, 'air');
  assert.ok(hi.magnitude > lo.magnitude);
  assert.strictEqual(hi.sensor, 'Sentinel-5P TROPOMI (NO2)');
});

test('returns null when no value', () => {
  assert.strictEqual(toSignal(null, { lat: 1, lng: 1 }), null);
});
```
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implement `services/eo/adapters/sentinel5p-no2.js`** (model on `sentinel5p.js`)
```js
// Sentinel-5P TROPOMI tropospheric NO2 column via CDSE Statistical API -> air axis
// (pollution). Complements the aerosol-index adapter. requires Copernicus creds.
const sh = require('../sentinelhub');
const { mkSignal } = require('../signal');

// dataMask output is REQUIRED by the Statistical API.
const EVALSCRIPT = `//VERSION=3
function setup(){return {input:["NO2","dataMask"],output:[{id:"data",bands:1},{id:"dataMask",bands:1}]}}
function evaluatePixel(s){return {data:[s.NO2],dataMask:[s.dataMask]}}`;

// NO2 column mol/m2: ~2e-5 clean .. ~2e-4 polluted. Map over [0, 2.5e-4].
function toSignal(no2, center) {
  if (!Number.isFinite(no2)) return null;
  return mkSignal({
    axis: 'air',
    magnitude: Math.max(0, Math.min(1, no2 / 2.5e-4)),
    confidence: 0.7,
    freshness: Date.now(),
    sensor: 'Sentinel-5P TROPOMI (NO2)',
    distanceKm: 0,
    detail: { no2_mol_m2: no2 },
  });
}

async function query(lat, lng) {
  const resp = await sh.statistics({ collection: 'sentinel-5p-l2', evalscript: EVALSCRIPT, lat, lng, days: 7 });
  const s = toSignal(sh.latestMean(resp), { lat, lng });
  return s ? [s] : [];
}

module.exports = {
  id: 'sentinel5p-no2', axes: ['air'],
  requires: ['COPERNICUS_CLIENT_ID', 'COPERNICUS_CLIENT_SECRET'],
  ttlMs: 3 * 60 * 60 * 1000, query, toSignal,
};
```
- [ ] **Step 4:** `npm test` → PASS. Report DONE (no commit).

### Task B2: Sentinel-3 SLSTR land-surface-temperature adapter (heat axis)
**Files:** Create `services/eo/adapters/sentinel3.js` + `test/eo/sentinel3.test.js`. **Depends on Task A1 (heat axis) being done first.**

CDSE collection `sentinel-3-slstr`; thermal band `S8` is brightness temperature in Kelvin. Map hot surfaces to a heat magnitude. **Evalscript MUST include dataMask output.**

- [ ] **Step 1: Failing test** — `test/eo/sentinel3.test.js`
```js
const test = require('node:test');
const assert = require('node:assert');
const { toSignal } = require('../../services/eo/adapters/sentinel3');

test('very hot surface (kelvin) yields high heat magnitude', () => {
  const hot = toSignal(323, { lat: 1, lng: 1 });  // 50 C
  const mild = toSignal(295, { lat: 1, lng: 1 }); // 22 C
  assert.strictEqual(hot.axis, 'heat');
  assert.ok(hot.magnitude > mild.magnitude);
  assert.ok(hot.magnitude > 0.6);
});

test('returns null without a value', () => {
  assert.strictEqual(toSignal(null, { lat: 1, lng: 1 }), null);
});
```
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implement `services/eo/adapters/sentinel3.js`**
```js
// Sentinel-3 SLSTR thermal infrared (S8 brightness temperature, Kelvin) via CDSE
// Statistical API -> heat axis. Independent thermal sensor; corroborates extreme
// surface heat. requires Copernicus creds.
const sh = require('../sentinelhub');
const { mkSignal } = require('../signal');

// dataMask output REQUIRED by the Statistical API.
const EVALSCRIPT = `//VERSION=3
function setup(){return {input:["S8","dataMask"],output:[{id:"data",bands:1},{id:"dataMask",bands:1}]}}
function evaluatePixel(s){return {data:[s.S8],dataMask:[s.dataMask]}}`;

// Brightness temp Kelvin: 300 K = 27 C, 318 K = 45 C (extreme), 330 K = 57 C.
// Map [300, 330] K -> [0, 1].
function toSignal(kelvin, center) {
  if (!Number.isFinite(kelvin)) return null;
  return mkSignal({
    axis: 'heat',
    magnitude: Math.max(0, Math.min(1, (kelvin - 300) / 30)),
    confidence: 0.65,
    freshness: Date.now(),
    sensor: 'Sentinel-3 SLSTR',
    distanceKm: 0,
    detail: { brightnessTempK: kelvin, celsius: +(kelvin - 273.15).toFixed(1) },
  });
}

async function query(lat, lng) {
  const resp = await sh.statistics({ collection: 'sentinel-3-slstr', evalscript: EVALSCRIPT, lat, lng, days: 5 });
  const s = toSignal(sh.latestMean(resp), { lat, lng });
  return s ? [s] : [];
}

module.exports = {
  id: 'sentinel3', axes: ['heat'],
  requires: ['COPERNICUS_CLIENT_ID', 'COPERNICUS_CLIENT_SECRET'],
  ttlMs: 6 * 60 * 60 * 1000, query, toSignal,
};
```
- [ ] **Step 4:** `npm test` → PASS. Report DONE (no commit).

---

## Controller integration (not for implementers)

### Task C1: Confidence-weighted overall level + register adapters
**Files:** Modify `services/eo/fusion.js`; modify `test/eo/fusion.test.js`.

- [ ] Register the 4 new adapters in `ADAPTERS`: `storm`, `glofas`, `sentinel5p-no2`, `sentinel3`.
- [ ] Replace the overall-level computation so it ignores axes whose confidence is below a floor unless their magnitude is extreme. Concretely, in `fuseSignals`, compute the overall level from each per-hazard entry's **effective magnitude = magnitude × confidence**, taking the max, then map via `levelFromMagnitude`; but still allow any axis with `magnitude ≥ 0.8 AND confidence ≥ 0.7` to force at least `high`. Keep `perHazard` levels as-is (per-axis honesty), only the *overall* roll-up changes.
- [ ] Add a fusion test: a single low-confidence (0.5) severe-magnitude vegetation signal must NOT drive overall `severe` (it should land at most `elevated`), while two corroborating high-confidence sensors at high magnitude DO.
- [ ] `npm test` → PASS.

### Task C2: Live verification (after build)
- [ ] With `.env` sourced, boot and query `/api/eo` at several points; confirm `sensorsUsed` now includes Open-Meteo storm, GloFAS, Sentinel-5P TROPOMI (NO2), and Sentinel-3 SLSTR where data exists, `skipped` is empty, and the overall level is calibrated (no single-proxy over-alarm).

---

## Self-Review
- Adds storm + heat axes (previously zero coverage), 3rd flood sensor, NO₂ pollution; all via feasible point/statistical APIs.
- Every Copernicus evalscript includes the required `dataMask` output (the Phase 2 bug).
- Confidence-weighted roll-up fixes the single-proxy over-alarm observed live.
- File isolation: Track A → signal.js + storm/glofas adapters; Track B → sentinel5p-no2/sentinel3 adapters (B2 depends on A1's heat axis); Controller → fusion.js. Disjoint; controller registers + calibrates last.
- Power-outage axis intentionally NOT implemented (no feasible accurate real-time source on this budget) — documented, not faked.

## Out of scope (documented, not faked)
- NASA GPM/MODIS/VIIRS-night-lights point values (cookie-based URS auth + HDF5/sinusoidal granule processing, not viable on 512Mi/60s). Earthdata token retained for future cloud-DAAC/Harmony work.
