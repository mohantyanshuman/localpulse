# Global Satellite Fusion Engine — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a worldwide, location-triggered Earth-observation inference: open the app anywhere, auto-locate, fuse the no-OAuth satellite/event sources (FIRMS multi-satellite fire, Open-Meteo CAMS air quality, NASA POWER precipitation, USGS seismic), cross-validate them, and render a plain-language per-hazard assessment.

**Architecture:** A new `services/eo/` module with a uniform adapter contract (`query(lat,lng) -> Signal[]`), a per-cell TTL cache shielding free quotas, and a `fusion.js` that runs adapters in parallel, degrades gracefully, cross-validates overlapping signals, and emits an `EOAssessment`. Exposed at `GET /api/eo?lat&lng`. Location resolved coarse-first from the Cloudflare edge header, sharpened on demand by the browser. Phase 2 adds the Copernicus/Sentinel token-gated adapters against this same contract.

**Tech Stack:** Node 20 (global `fetch`, CommonJS), Express 4 (existing), `node --test` built-in test runner (no new dependency), existing PWA frontend (`public/js/app.js`).

---

## File Structure

| File | Responsibility |
|---|---|
| `services/eo/http.js` | Shared timeout-bounded `getJson`/`getText` + `haversineKm` (mirrors `hazards.js` convention) |
| `services/eo/cache.js` | Per-cell key + TTL memoization, bounded size |
| `services/eo/signal.js` | `Signal`/`EOAssessment` JSDoc typedefs + small builders (`mkSignal`, axis constants) |
| `services/eo/adapters/firms.js` | NASA FIRMS active fire across VIIRS S-NPP/NOAA-20/NOAA-21 + MODIS |
| `services/eo/adapters/openmeteo-air.js` | Open-Meteo CAMS air quality (Sentinel-5P assimilated) |
| `services/eo/adapters/power.js` | NASA POWER multi-day precipitation (flood-axis gap filler) |
| `services/eo/adapters/seismic.js` | USGS earthquakes (real-world event layer) |
| `services/eo/fusion.js` | Adapter registry, parallel run, cross-validation, `EOAssessment` |
| `services/geolocate.js` | Edge-header coarse location + reverse geocode to place name |
| `server.js` | New `GET /api/eo` route (modify) |
| `public/js/app.js` | Satellite Intelligence panel + sharpen control (modify) |
| `public/index.html` | Panel markup (modify) |
| `test/eo/*.test.js` | Unit + integration tests |
| `.env.example` | New keys documented (create if absent) |
| `package.json` | Add `"test": "node --test"` script (modify) |

Adapter contract every adapter file exports:

```js
module.exports = {
  id: 'firms',                 // unique id, used as cache namespace
  axes: ['fire'],              // which hazard axes it can emit
  requires: ['FIRMS_MAP_KEY'], // env vars that must be set, else adapter is skipped
  ttlMs: 10 * 60 * 1000,       // cache TTL for this source
  async query(lat, lng) { /* returns Signal[] */ }
};
```

---

### Task 1: Test scaffolding and shared HTTP util

**Files:**
- Modify: `package.json` (add test script)
- Create: `services/eo/http.js`
- Create: `test/eo/http.test.js`

- [ ] **Step 1: Add the test script**

In `package.json`, change the `scripts` block to:

```json
  "scripts": {
    "start": "node server.js",
    "dev": "node server.js",
    "test": "node --test"
  },
```

- [ ] **Step 2: Write the failing test**

Create `test/eo/http.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { haversineKm } = require('../../services/eo/http');

test('haversineKm is ~0 for identical points', () => {
  assert.ok(haversineKm({ lat: 30.9, lng: 77.1 }, { lat: 30.9, lng: 77.1 }) < 0.001);
});

test('haversineKm matches a known distance (Delhi->Solan ~260km)', () => {
  const d = haversineKm({ lat: 28.61, lng: 77.21 }, { lat: 30.91, lng: 77.10 });
  assert.ok(d > 250 && d < 270, `expected ~260, got ${d}`);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module '../../services/eo/http'`.

- [ ] **Step 4: Implement `services/eo/http.js`**

```js
// Shared HTTP helpers for Earth-observation adapters. Timeout-bounded and
// degrade to null so one bad feed never breaks fusion. Mirrors services/hazards.js.
const UA = 'LocalPulse/1.0 (+https://localpulse.dmj.one)';

async function getText(url, ms = 8000, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      ...opts,
      headers: { 'User-Agent': UA, ...(opts.headers || {}) },
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url, ms = 8000, opts = {}) {
  const t = await getText(url, ms, opts);
  if (t == null) return null;
  try { return JSON.parse(t); } catch { return null; }
}

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

module.exports = { getText, getJson, haversineKm };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json services/eo/http.js test/eo/http.test.js
git commit -m "feat(eo): shared HTTP util + test scaffolding"
```

---

### Task 2: Signal typedefs and builders

**Files:**
- Create: `services/eo/signal.js`
- Create: `test/eo/signal.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/eo/signal.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { mkSignal, AXES } = require('../../services/eo/signal');

test('AXES contains the seven hazard axes', () => {
  assert.deepStrictEqual(
    [...AXES].sort(),
    ['air', 'fire', 'flood', 'power', 'seismic', 'storm', 'vegetation']
  );
});

test('mkSignal clamps magnitude and confidence to 0..1', () => {
  const s = mkSignal({ axis: 'fire', magnitude: 5, confidence: -2, sensor: 'X', distanceKm: 3 });
  assert.strictEqual(s.magnitude, 1);
  assert.strictEqual(s.confidence, 0);
  assert.strictEqual(s.axis, 'fire');
  assert.ok(typeof s.freshness === 'number');
});

test('mkSignal rejects an unknown axis', () => {
  assert.throws(() => mkSignal({ axis: 'nope', magnitude: 0.5, sensor: 'X', distanceKm: 1 }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module '../../services/eo/signal'`.

- [ ] **Step 3: Implement `services/eo/signal.js`**

```js
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

const AXES = new Set(['fire', 'air', 'flood', 'vegetation', 'storm', 'power', 'seismic']);

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/eo/signal.js test/eo/signal.test.js
git commit -m "feat(eo): Signal/EOAssessment typedefs and builders"
```

---

### Task 3: Per-cell TTL cache

**Files:**
- Create: `services/eo/cache.js`
- Create: `test/eo/cache.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/eo/cache.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { cellKey, memo, _reset } = require('../../services/eo/cache');

test('cellKey rounds to ~0.1 degree so nearby points share a cell', () => {
  assert.strictEqual(cellKey(30.912, 77.061), cellKey(30.949, 77.099));
  assert.notStrictEqual(cellKey(30.91, 77.06), cellKey(31.21, 77.06));
});

test('memo caches within ttl and recomputes after expiry', async () => {
  _reset();
  let calls = 0;
  const fn = async () => { calls += 1; return calls; };
  const a = await memo('k', 1000, fn);
  const b = await memo('k', 1000, fn);
  assert.strictEqual(a, 1);
  assert.strictEqual(b, 1); // served from cache
  const c = await memo('k', 0, fn); // ttl 0 forces recompute
  assert.strictEqual(c, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module '../../services/eo/cache'`.

- [ ] **Step 3: Implement `services/eo/cache.js`**

```js
// Per-cell, per-source TTL cache. The rate-limit and latency shield: nearby
// users hitting the same ~0.1 deg cell reuse one upstream fetch per source.
const store = new Map(); // key -> { ts, val }
const MAX = 2000;

function cellKey(lat, lng, prec = 1) {
  const f = Math.pow(10, prec);
  return `${Math.round(lat * f) / f},${Math.round(lng * f) / f}`;
}

async function memo(key, ttlMs, fn) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.ts < ttlMs) return hit.val;
  const val = await fn();
  store.set(key, { ts: now, val });
  if (store.size > MAX) {
    const oldest = [...store.entries()].sort((a, b) => a[1].ts - b[1].ts).slice(0, Math.floor(MAX / 4));
    for (const [k] of oldest) store.delete(k);
  }
  return val;
}

function _reset() { store.clear(); }

module.exports = { cellKey, memo, _reset };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/eo/cache.js test/eo/cache.test.js
git commit -m "feat(eo): per-cell TTL cache"
```

---

### Task 4: FIRMS multi-satellite fire adapter

**Files:**
- Create: `services/eo/adapters/firms.js`
- Create: `test/eo/firms.test.js`

NASA FIRMS area API returns CSV: `https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{west},{south},{east},{north}/{dayRange}`. We query four sources and parse rows. Columns include `latitude,longitude,bright_ti4|brightness,acq_date,acq_time,confidence,frp,daynight`.

- [ ] **Step 1: Write the failing test (pure CSV parsing + mapping, no network)**

Create `test/eo/firms.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { parseCsv, rowsToSignals } = require('../../services/eo/adapters/firms');

const CSV = `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight
30.9100,77.1000,330.5,0.4,0.4,2026-05-24,0812,N,nominal,2.0NRT,295.1,12.4,D
31.5000,78.0000,360.0,0.4,0.4,2026-05-24,0813,N,high,2.0NRT,300.0,88.0,D`;

test('parseCsv returns row objects keyed by header', () => {
  const rows = parseCsv(CSV);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].latitude, '30.9100');
  assert.strictEqual(rows[1].confidence, 'high');
});

test('rowsToSignals keeps fires within radius and scales magnitude by FRP', () => {
  const rows = parseCsv(CSV);
  const sigs = rowsToSignals(rows, { lat: 30.91, lng: 77.10 }, 'VIIRS NOAA-20', 60);
  // first row is ~0km away (kept), second is >60km away (dropped)
  assert.strictEqual(sigs.length, 1);
  assert.strictEqual(sigs[0].axis, 'fire');
  assert.strictEqual(sigs[0].sensor, 'VIIRS NOAA-20');
  assert.ok(sigs[0].magnitude > 0 && sigs[0].magnitude <= 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module '.../adapters/firms'`.

- [ ] **Step 3: Implement `services/eo/adapters/firms.js`**

```js
// NASA FIRMS active fire across multiple satellites. One free MAP_KEY queries
// all sources; each source is a different platform so overpass gaps are covered.
const { getText, haversineKm } = require('../http');
const { mkSignal } = require('../signal');

const SOURCES = [
  { src: 'VIIRS_SNPP_NRT', sensor: 'VIIRS S-NPP' },
  { src: 'VIIRS_NOAA20_NRT', sensor: 'VIIRS NOAA-20' },
  { src: 'VIIRS_NOAA21_NRT', sensor: 'VIIRS NOAA-21' },
  { src: 'MODIS_NRT', sensor: 'MODIS' },
];
const RADIUS_KM = 60;

function parseCsv(text) {
  const lines = String(text).trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    const row = {};
    header.forEach((h, i) => { row[h.trim()] = (cols[i] || '').trim(); });
    return row;
  });
}

function confToScore(c) {
  if (c === 'high' || c === 'h') return 1;
  if (c === 'nominal' || c === 'n') return 0.7;
  if (c === 'low' || c === 'l') return 0.4;
  const n = parseFloat(c);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n / 100)) : 0.5;
}

function freshnessOf(row) {
  const d = row.acq_date; // YYYY-MM-DD
  const t = (row.acq_time || '0000').padStart(4, '0');
  const iso = `${d}T${t.slice(0, 2)}:${t.slice(2)}:00Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Date.now();
}

function rowsToSignals(rows, center, sensor, radiusKm = RADIUS_KM) {
  const out = [];
  for (const row of rows) {
    const lat = parseFloat(row.latitude);
    const lng = parseFloat(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const distanceKm = haversineKm(center, { lat, lng });
    if (distanceKm > radiusKm) continue;
    const frp = parseFloat(row.frp) || 0;
    const conf = confToScore(row.confidence);
    // magnitude: closer + hotter (FRP) + higher confidence = stronger.
    const proximity = 1 - distanceKm / radiusKm;
    const heat = Math.min(1, frp / 100);
    const magnitude = Math.max(heat, 0.4) * conf * (0.5 + 0.5 * proximity);
    out.push(mkSignal({
      axis: 'fire',
      magnitude,
      confidence: conf,
      freshness: freshnessOf(row),
      sensor,
      distanceKm,
      detail: { frp, confidence: row.confidence, daynight: row.daynight },
    }));
  }
  return out;
}

async function query(lat, lng) {
  const key = process.env.FIRMS_MAP_KEY;
  if (!key) return [];
  const d = 0.6; // ~66km half-box
  const area = `${(lng - d).toFixed(3)},${(lat - d).toFixed(3)},${(lng + d).toFixed(3)},${(lat + d).toFixed(3)}`;
  const center = { lat, lng };
  const perSource = await Promise.all(
    SOURCES.map(async ({ src, sensor }) => {
      const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${src}/${area}/1`;
      const text = await getText(url, 8000);
      if (!text || /Invalid/i.test(text)) return [];
      return rowsToSignals(parseCsv(text), center, sensor);
    })
  );
  return perSource.flat();
}

module.exports = {
  id: 'firms',
  axes: ['fire'],
  requires: ['FIRMS_MAP_KEY'],
  ttlMs: 10 * 60 * 1000,
  query,
  // exported for unit tests:
  parseCsv,
  rowsToSignals,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/eo/adapters/firms.js test/eo/firms.test.js
git commit -m "feat(eo): FIRMS multi-satellite fire adapter"
```

---

### Task 5: Open-Meteo CAMS air-quality adapter

**Files:**
- Create: `services/eo/adapters/openmeteo-air.js`
- Create: `test/eo/openmeteo-air.test.js`

- [ ] **Step 1: Write the failing test (pure mapping, no network)**

Create `test/eo/openmeteo-air.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { toSignal } = require('../../services/eo/adapters/openmeteo-air');

test('toSignal maps US AQI into an air signal with scaled magnitude', () => {
  const s = toSignal({ current: { us_aqi: 180, pm2_5: 90, time: '2026-05-24T08:00' } }, { lat: 1, lng: 1 });
  assert.strictEqual(s.axis, 'air');
  assert.ok(s.magnitude > 0.5, `expected unhealthy magnitude, got ${s.magnitude}`);
  assert.strictEqual(s.detail.us_aqi, 180);
});

test('toSignal returns null when no current block', () => {
  assert.strictEqual(toSignal({}, { lat: 1, lng: 1 }), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `services/eo/adapters/openmeteo-air.js`**

```js
// Open-Meteo air quality (CAMS global, which assimilates Sentinel-5P TROPOMI).
// Keyless. Point JSON. Fills the hours when the S5P polar overpass is stale.
const { getJson } = require('../http');
const { mkSignal } = require('../signal');

// US AQI -> 0..1 magnitude. 50=good, 100=moderate, 150=USG, 200=unhealthy, 300+=hazardous.
function aqiToMagnitude(aqi) {
  if (!Number.isFinite(aqi)) return 0;
  return Math.max(0, Math.min(1, aqi / 300));
}

function toSignal(j, center) {
  const c = j && j.current;
  if (!c) return null;
  const aqi = Number(c.us_aqi);
  const freshness = Date.parse(c.time) || Date.now();
  return mkSignal({
    axis: 'air',
    magnitude: aqiToMagnitude(aqi),
    confidence: 0.8,
    freshness,
    sensor: 'CAMS (Sentinel-5P assimilated)',
    distanceKm: 0,
    detail: { us_aqi: aqi, pm2_5: c.pm2_5, pm10: c.pm10, aod: c.aerosol_optical_depth, dust: c.dust },
  });
}

async function query(lat, lng) {
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}` +
    `&current=us_aqi,pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,aerosol_optical_depth,dust&timezone=auto`;
  const j = await getJson(url, 8000);
  const s = toSignal(j, { lat, lng });
  return s ? [s] : [];
}

module.exports = {
  id: 'openmeteo-air',
  axes: ['air'],
  requires: [],
  ttlMs: 60 * 60 * 1000,
  query,
  toSignal,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/eo/adapters/openmeteo-air.js test/eo/openmeteo-air.test.js
git commit -m "feat(eo): Open-Meteo CAMS air-quality adapter"
```

---

### Task 6: NASA POWER precipitation adapter

**Files:**
- Create: `services/eo/adapters/power.js`
- Create: `test/eo/power.test.js`

NASA POWER daily point API (keyless): `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR&latitude=&longitude=&start=YYYYMMDD&end=YYYYMMDD&format=JSON&community=AG`. Response: `properties.parameter.PRECTOTCORR = { 'YYYYMMDD': mm }`. POWER lags ~1-2 days, so it is a flood-axis gap filler (accumulated multi-day rainfall), not a real-time signal.

- [ ] **Step 1: Write the failing test (pure mapping, no network)**

Create `test/eo/power.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { toSignal } = require('../../services/eo/adapters/power');

test('toSignal sums recent precipitation into a flood signal', () => {
  const j = { properties: { parameter: { PRECTOTCORR: { '20260522': 40, '20260523': 70, '20260524': 30 } } } };
  const s = toSignal(j, { lat: 1, lng: 1 });
  assert.strictEqual(s.axis, 'flood');
  assert.strictEqual(s.detail.totalMm, 140);
  assert.ok(s.magnitude > 0.5, `heavy multi-day rain should be elevated, got ${s.magnitude}`);
});

test('toSignal ignores POWER fill value -999', () => {
  const j = { properties: { parameter: { PRECTOTCORR: { '20260524': -999 } } } };
  const s = toSignal(j, { lat: 1, lng: 1 });
  assert.strictEqual(s.detail.totalMm, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `services/eo/adapters/power.js`**

```js
// NASA POWER multi-day precipitation (MERRA-2 / satellite-assimilated). Keyless.
// Lags ~1-2 days, so it backstops the flood axis with accumulated rainfall when
// real-time radar is unavailable.
const { getJson } = require('../http');
const { mkSignal } = require('../signal');

function ymd(d) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Sum of 3-day rainfall (mm) -> 0..1. ~150mm over 3 days is a serious flood signal.
function rainToMagnitude(mm) {
  return Math.max(0, Math.min(1, mm / 150));
}

function toSignal(j, center) {
  const series = j && j.properties && j.properties.parameter && j.properties.parameter.PRECTOTCORR;
  if (!series) return null;
  const vals = Object.values(series).map(Number).filter((v) => Number.isFinite(v) && v > -900);
  const totalMm = Math.round(vals.reduce((a, b) => a + b, 0));
  return mkSignal({
    axis: 'flood',
    magnitude: rainToMagnitude(totalMm),
    confidence: 0.6,
    freshness: Date.now(),
    sensor: 'NASA POWER (MERRA-2)',
    distanceKm: 0,
    detail: { totalMm, days: vals.length },
  });
}

async function query(lat, lng) {
  const end = new Date();
  const start = new Date(end.getTime() - 3 * 24 * 3600 * 1000);
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR` +
    `&latitude=${lat}&longitude=${lng}&start=${ymd(start)}&end=${ymd(end)}&format=JSON&community=AG`;
  const j = await getJson(url, 9000);
  const s = toSignal(j, { lat, lng });
  return s ? [s] : [];
}

module.exports = {
  id: 'power',
  axes: ['flood'],
  requires: [],
  ttlMs: 6 * 60 * 60 * 1000,
  query,
  toSignal,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/eo/adapters/power.js test/eo/power.test.js
git commit -m "feat(eo): NASA POWER precipitation adapter"
```

---

### Task 7: USGS seismic adapter

**Files:**
- Create: `services/eo/adapters/seismic.js`
- Create: `test/eo/seismic.test.js`

USGS FDSN (keyless): `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=&longitude=&maxradiuskm=350&minmagnitude=2.5&starttime=YYYY-MM-DD`. GeoJSON `features[].properties.{mag,time,place}`, `geometry.coordinates=[lng,lat,depth]`.

- [ ] **Step 1: Write the failing test (pure mapping, no network)**

Create `test/eo/seismic.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { toSignals } = require('../../services/eo/adapters/seismic');

const GEO = { features: [
  { properties: { mag: 5.4, time: 1748000000000, place: '10km N of X' }, geometry: { coordinates: [77.0, 30.95, 10] } },
  { properties: { mag: 2.6, time: 1748000000000, place: '5km S of Y' }, geometry: { coordinates: [77.1, 31.5, 8] } },
] };

test('toSignals keeps the strongest nearby quake and scales magnitude by Richter', () => {
  const sigs = toSignals(GEO, { lat: 30.91, lng: 77.10 }, 350);
  assert.ok(sigs.length >= 1);
  assert.strictEqual(sigs[0].axis, 'seismic');
  // M5.4 should be high magnitude
  assert.ok(sigs[0].magnitude > 0.6, `M5.4 should be high, got ${sigs[0].magnitude}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `services/eo/adapters/seismic.js`**

```js
// USGS earthquakes (ground sensor network) as a real-world event layer.
// Keyless. Returns one signal per qualifying quake within radius.
const { getJson, haversineKm } = require('../http');
const { mkSignal } = require('../signal');

const RADIUS_KM = 350;

// Richter M -> 0..1. M2.5 felt, M5 damaging, M6.5+ severe.
function magToMagnitude(m) {
  if (!Number.isFinite(m)) return 0;
  return Math.max(0, Math.min(1, (m - 2.5) / 4.5));
}

function toSignals(geo, center, radiusKm = RADIUS_KM) {
  const feats = (geo && geo.features) || [];
  const out = [];
  for (const f of feats) {
    const m = Number(f.properties && f.properties.mag);
    const coords = f.geometry && f.geometry.coordinates;
    if (!Array.isArray(coords)) continue;
    const lat = coords[1];
    const lng = coords[0];
    const distanceKm = haversineKm(center, { lat, lng });
    if (distanceKm > radiusKm) continue;
    out.push(mkSignal({
      axis: 'seismic',
      magnitude: magToMagnitude(m),
      confidence: 0.95,
      freshness: Number(f.properties.time) || Date.now(),
      sensor: 'USGS Seismic Network',
      distanceKm,
      detail: { mag: m, place: f.properties.place, depthKm: coords[2] },
    }));
  }
  // strongest first
  return out.sort((a, b) => b.magnitude - a.magnitude).slice(0, 5);
}

async function query(lat, lng) {
  const start = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson` +
    `&latitude=${lat}&longitude=${lng}&maxradiuskm=${RADIUS_KM}&minmagnitude=2.5&starttime=${start}`;
  const geo = await getJson(url, 9000);
  return toSignals(geo, { lat, lng });
}

module.exports = {
  id: 'seismic',
  axes: ['seismic'],
  requires: [],
  ttlMs: 15 * 60 * 1000,
  query,
  toSignals,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/eo/adapters/seismic.js test/eo/seismic.test.js
git commit -m "feat(eo): USGS seismic adapter"
```

---

### Task 8: Fusion engine

**Files:**
- Create: `services/eo/fusion.js`
- Create: `test/eo/fusion.test.js`

Fusion runs every adapter whose `requires` env vars are all set, through the cache, in parallel; flattens signals; groups by axis; cross-validates (2+ distinct sensors agreeing on an axis raises that axis's confidence); computes a per-axis level and an overall level; and reports `sensorsUsed`, `gapsCovered`, and `skipped`.

- [ ] **Step 1: Write the failing test (inject fake adapters, no network)**

Create `test/eo/fusion.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { _reset } = require('../../services/eo/cache');
const { fuseSignals, levelFromMagnitude } = require('../../services/eo/fusion');
const { mkSignal } = require('../../services/eo/signal');

test('levelFromMagnitude maps thresholds', () => {
  assert.strictEqual(levelFromMagnitude(0.1), 'ok');
  assert.strictEqual(levelFromMagnitude(0.35), 'elevated');
  assert.strictEqual(levelFromMagnitude(0.6), 'high');
  assert.strictEqual(levelFromMagnitude(0.85), 'severe');
});

test('fuseSignals boosts confidence when two sensors agree on an axis', () => {
  const signals = [
    mkSignal({ axis: 'fire', magnitude: 0.7, confidence: 0.7, sensor: 'VIIRS NOAA-20', distanceKm: 3 }),
    mkSignal({ axis: 'fire', magnitude: 0.6, confidence: 0.7, sensor: 'MODIS', distanceKm: 4 }),
  ];
  const out = fuseSignals(signals, []);
  const fire = out.perHazard.find((h) => h.axis === 'fire');
  assert.strictEqual(fire.sensorsUsed.length, 2);
  assert.ok(fire.confidence > 0.7, 'agreement should raise confidence');
  assert.match(fire.gapNote, /VIIRS NOAA-20|MODIS/);
  assert.strictEqual(out.level, 'high');
});

test('fuseSignals reports skipped adapter ids', () => {
  const out = fuseSignals([], ['firms']);
  assert.deepStrictEqual(out.skipped, ['firms']);
  assert.strictEqual(out.level, 'ok');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module '../../services/eo/fusion'`.

- [ ] **Step 3: Implement `services/eo/fusion.js`**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/eo/fusion.js test/eo/fusion.test.js
git commit -m "feat(eo): fusion engine with cross-sensor validation"
```

---

### Task 9: Geolocation service (coarse edge + reverse geocode)

**Files:**
- Create: `services/geolocate.js`
- Create: `test/eo/geolocate.test.js`

Cloudflare adds `cf-iplatitude` / `cf-iplongitude` headers when geolocation is enabled, plus `cf-ipcountry`. We read those for coarse location; if absent we fall back to a configurable default. Precise coordinates come from the client query string.

- [ ] **Step 1: Write the failing test (pure header parsing, no network)**

Create `test/eo/geolocate.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { coarseFromHeaders } = require('../../services/geolocate');

test('coarseFromHeaders reads Cloudflare lat/lng headers', () => {
  const loc = coarseFromHeaders({ 'cf-iplatitude': '48.85', 'cf-iplongitude': '2.35', 'cf-ipcountry': 'FR' });
  assert.ok(Math.abs(loc.lat - 48.85) < 1e-6);
  assert.ok(Math.abs(loc.lng - 2.35) < 1e-6);
  assert.strictEqual(loc.source, 'edge');
});

test('coarseFromHeaders falls back when headers absent', () => {
  const loc = coarseFromHeaders({}, { lat: 20, lng: 0 });
  assert.strictEqual(loc.lat, 20);
  assert.strictEqual(loc.source, 'default');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module '../../services/geolocate'`.

- [ ] **Step 3: Implement `services/geolocate.js`**

```js
// Worldwide location resolution. Coarse: Cloudflare edge headers (no prompt).
// Precise: client-supplied lat/lng. Reverse geocode for a human place name.
const { getJson } = require('./eo/http');

const DEFAULT_LOC = {
  lat: Number(process.env.DEFAULT_LAT) || 20,
  lng: Number(process.env.DEFAULT_LNG) || 0,
};

function coarseFromHeaders(headers = {}, fallback = DEFAULT_LOC) {
  const lat = parseFloat(headers['cf-iplatitude']);
  const lng = parseFloat(headers['cf-iplongitude']);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng, country: headers['cf-ipcountry'] || null, source: 'edge' };
  }
  return { lat: fallback.lat, lng: fallback.lng, country: null, source: 'default' };
}

// Free reverse geocode (BigDataCloud client-free endpoint). Degrades to null.
async function reverseGeocode(lat, lng) {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`;
  const j = await getJson(url, 6000);
  if (!j) return null;
  return {
    place: j.city || j.locality || j.principalSubdivision || j.countryName || null,
    region: j.principalSubdivision || null,
    country: j.countryName || null,
    countryCode: j.countryCode || null,
  };
}

module.exports = { coarseFromHeaders, reverseGeocode, DEFAULT_LOC };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/geolocate.js test/eo/geolocate.test.js
git commit -m "feat: worldwide geolocation (edge coarse + reverse geocode)"
```

---

### Task 10: `GET /api/eo` endpoint

**Files:**
- Modify: `server.js` (add route + require near other service requires around line 19, and the route near the other `/api/*` handlers)
- Create: `test/eo/endpoint.test.js`

- [ ] **Step 1: Write the failing integration test**

Create `test/eo/endpoint.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

// Start the server on an ephemeral port in-process.
process.env.PORT = '0';
const app = require('../../server'); // server.js must export the http.Server

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const addr = app.address();
    const req = http.request({ host: '127.0.0.1', port: addr.port, path, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('GET /api/eo returns an assessment shape', async () => {
  const r = await get('/api/eo?lat=48.85&lng=2.35');
  assert.strictEqual(r.status, 200);
  const j = JSON.parse(r.body);
  assert.ok(['ok', 'elevated', 'high', 'severe'].includes(j.level));
  assert.ok(Array.isArray(j.perHazard));
  assert.ok(Array.isArray(j.sensorsUsed));
  assert.ok(j.location && typeof j.location.lat === 'number');
});

test('GET /api/eo uses Cloudflare headers when lat/lng absent', async () => {
  const r = await get('/api/eo', { 'cf-iplatitude': '35.68', 'cf-iplongitude': '139.69', 'cf-ipcountry': 'JP' });
  const j = JSON.parse(r.body);
  assert.ok(Math.abs(j.location.lat - 35.68) < 1e-6);
  assert.strictEqual(j.location.source, 'edge');
});

test.after(() => app.close());
```

- [ ] **Step 2: Ensure `server.js` exports the server**

Check the end of `server.js`. It currently calls `app.listen(PORT, ...)`. Capture and export it. Find the listen call and change it to assign and export:

```js
const server = app.listen(PORT, () => {
  // ...existing warm-up / startup body unchanged...
});

module.exports = server;
```

If `server.js` already exports something, add `server` to the export. The warm-up code inside the listen callback stays exactly as-is.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `/api/eo` returns 404 (route not yet added), so the first assertion `status === 200` fails.

- [ ] **Step 4: Add the require and route to `server.js`**

Near the other service requires (around line 19, after `const livefeed = require('./services/livefeed');`):

```js
const eoFusion = require('./services/eo/fusion');
const geolocate = require('./services/geolocate');
```

Near the other `/api/*` GET handlers (e.g. just after the `/api/hazards` handler around line 118), add:

```js
// Worldwide satellite fusion. Coarse location from CF edge headers unless the
// client supplies precise lat/lng. Cross-validated multi-sensor assessment.
app.get('/api/eo', async (req, res) => {
  const qLat = parseFloat(req.query.lat);
  const qLng = parseFloat(req.query.lng);
  const precise = Number.isFinite(qLat) && Number.isFinite(qLng);
  const loc = precise
    ? { lat: qLat, lng: qLng, source: 'precise' }
    : geolocate.coarseFromHeaders(req.headers);
  try {
    const [assessment, place] = await Promise.all([
      eoFusion.fuse(loc.lat, loc.lng),
      geolocate.reverseGeocode(loc.lat, loc.lng),
    ]);
    res.set('Cache-Control', precise ? 'no-store' : 'public, max-age=300, stale-while-revalidate=600');
    res.json({ ...assessment, location: { ...loc, ...(place || {}) } });
  } catch (err) {
    res.status(502).json({ error: 'fusion_failed', code: 'EO_FUSION', requestId: req.cid || null });
  }
});
```

(Use `req.cid` only if the existing correlation-id middleware sets it; otherwise drop that field. Check the middleware around server.js:33.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS (3 endpoint tests). Network adapters may return empty in CI; the test only asserts shape, so it passes regardless of live data.

- [ ] **Step 6: Commit**

```bash
git add server.js test/eo/endpoint.test.js
git commit -m "feat(eo): GET /api/eo worldwide fusion endpoint"
```

---

### Task 11: Frontend Satellite Intelligence panel

**Files:**
- Modify: `public/index.html` (add panel container)
- Modify: `public/js/app.js` (fetch + render + sharpen control)

- [ ] **Step 1: Add the panel markup to `public/index.html`**

Inside the main content area (near the DSS panel), add:

```html
<section id="eo-panel" class="card" aria-live="polite">
  <header class="card-head">
    <h2 data-i18n="eo.title">Satellite Intelligence</h2>
    <button id="eo-sharpen" class="btn-ghost" type="button" data-i18n="eo.sharpen">Sharpen to my exact location</button>
  </header>
  <p id="eo-headline" class="eo-headline"></p>
  <div id="eo-cards" class="eo-cards"></div>
  <p id="eo-coverage" class="eo-coverage muted"></p>
</section>
```

- [ ] **Step 2: Add fetch + render to `public/js/app.js`**

Add this module-level code (near the other `fetchJson` API calls). It calls `/api/eo` on load (coarse, no coordinates) and re-calls with precise coordinates when the user clicks Sharpen:

```js
async function loadEO(coords) {
  const qs = coords ? `?lat=${coords.lat}&lng=${coords.lng}` : '';
  let data;
  try {
    data = await fetchJson(`/api/eo${qs}`);
  } catch {
    return; // offline; panel stays with last paint
  }
  renderEO(data);
}

function eoLevelClass(level) {
  return { ok: 'lv-ok', elevated: 'lv-elevated', high: 'lv-high', severe: 'lv-severe' }[level] || 'lv-ok';
}

function renderEO(data) {
  const headline = document.getElementById('eo-headline');
  const cards = document.getElementById('eo-cards');
  const coverage = document.getElementById('eo-coverage');
  if (!headline || !cards) return;
  const place = (data.location && data.location.place) || 'your area';
  headline.textContent = `${place}: ${data.level.toUpperCase()} — ${data.sensorsUsed.length} sensors reporting`;
  headline.className = `eo-headline ${eoLevelClass(data.level)}`;
  cards.innerHTML = '';
  for (const h of data.perHazard) {
    const el = document.createElement('div');
    el.className = `eo-card ${eoLevelClass(h.level)}`;
    el.innerHTML =
      `<div class="eo-axis">${h.axis}</div>` +
      `<div class="eo-level">${h.level}</div>` +
      `<div class="eo-conf">confidence ${Math.round(h.confidence * 100)}%</div>` +
      `<div class="eo-sensors">${h.sensorsUsed.join(', ')}</div>` +
      `<div class="eo-gap muted">${h.gapNote}</div>`;
    cards.appendChild(el);
  }
  if (coverage) {
    coverage.textContent = data.gapsCovered.length
      ? `Cross-validated: ${data.gapsCovered.join(' · ')}`
      : 'Single-sensor reads this cycle; corroboration pending next overpass.';
  }
}

function wireEO() {
  const btn = document.getElementById('eo-sharpen');
  if (btn) {
    btn.addEventListener('click', () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => loadEO({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => loadEO() // denied -> stay coarse
      );
    });
  }
  loadEO(); // coarse on boot
}
```

- [ ] **Step 3: Call `wireEO()` during boot**

In the app's boot/init function (where the service worker is registered and initial data loads, around app.js:577), add a call:

```js
wireEO();
```

- [ ] **Step 4: Add minimal panel styles to `public/css/app.css`**

```css
.eo-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
.eo-card { border-radius: 12px; padding: 12px; background: var(--card, #fff); box-shadow: 0 1px 3px rgba(0,0,0,.12); min-width: 0; }
.eo-axis { text-transform: capitalize; font-weight: 700; }
.eo-headline.lv-high, .eo-card.lv-high { border-left: 4px solid #e67700; }
.eo-headline.lv-severe, .eo-card.lv-severe { border-left: 4px solid #c92a2a; }
.eo-headline.lv-elevated, .eo-card.lv-elevated { border-left: 4px solid #f59f00; }
.eo-headline.lv-ok, .eo-card.lv-ok { border-left: 4px solid #2f9e44; }
.eo-coverage { font-size: 12px; margin-top: 8px; }
```

- [ ] **Step 5: Manual verification**

Run: `npm start`, open `http://localhost:8080/`. Expected: the Satellite Intelligence panel renders with a headline and per-hazard cards (axes present depend on live data and whether `FIRMS_MAP_KEY` is set). Clicking "Sharpen" triggers the browser location prompt and re-renders.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/js/app.js public/css/app.css
git commit -m "feat(eo): Satellite Intelligence panel + sharpen control"
```

---

### Task 12: Environment docs and .env.example

**Files:**
- Create or Modify: `.env.example`
- Modify: `README.md` (add a short "Satellite sources" subsection)

- [ ] **Step 1: Add keys to `.env.example`**

Append:

```bash
# Earth-observation fusion (Phase 1)
# NASA FIRMS active fire — free MAP_KEY: https://firms.modaps.eosdis.nasa.gov/api/area/
FIRMS_MAP_KEY=your_firms_map_key_here
# Default coarse location when no Cloudflare geo headers are present (lat,lng)
DEFAULT_LAT=20
DEFAULT_LNG=0
# Phase 2 (Copernicus/Sentinel) — leave blank until registered
COPERNICUS_CLIENT_ID=
COPERNICUS_CLIENT_SECRET=
```

- [ ] **Step 2: Add a README subsection**

Under the features/architecture section, add:

```markdown
### Satellite sources

The `/api/eo` endpoint fuses multiple Earth-observation sensors per location:
active fire (NASA FIRMS: VIIRS S-NPP / NOAA-20 / NOAA-21, MODIS), air quality
(Open-Meteo CAMS, Sentinel-5P assimilated), multi-day precipitation (NASA POWER),
and seismic events (USGS). Each source degrades gracefully; the fusion engine
cross-validates overlapping sensors and reports coverage. Add `FIRMS_MAP_KEY`
(free) to enable fire detection. Sentinel-1/2/5P adapters arrive in Phase 2.
```

- [ ] **Step 3: Run the full test suite once more**

Run: `npm test`
Expected: PASS (all tasks' tests green).

- [ ] **Step 4: Commit**

```bash
git add .env.example README.md
git commit -m "docs(eo): document satellite sources and env keys"
```

---

## Self-Review

**Spec coverage:**
- 15+ satellite spread → Phase 1 delivers FIRMS (4 platforms) + CAMS (S5P-derived) + POWER + USGS = the no-OAuth core; Sentinel-1/2/5P + GIBS night-lights are explicitly deferred to Phase 2 against the same contract. Covered, with the split called out.
- Auto coarse location then sharpen → Tasks 9, 10, 11. Covered.
- Cross-sensor gap coverage → Task 8 `summarizeAxis` confidence boost + `gapsCovered`. Covered.
- Per-cell caching / quota shield → Task 3 + used in Task 8 `fuse`. Covered.
- Worldwide (drop Solan hardcoding) → Task 9 default location is configurable, endpoint uses resolved location not `BASE`. Note: `data/incidents.js` `BASE` still seeds the legacy Solan community view; Phase 1 leaves it as the community-feature default and does not route `/api/eo` through it. Generalizing the *community* features to the detected location is follow-on work, consistent with the spec's "community features become per-location" being a separate concern from the EO engine.
- Graceful degradation + token-optional → Task 4/8 (`requires` skip), Task 8 catch. Covered.
- Tests filling the no-test gap → every task. Covered.

**Placeholder scan:** No TBD/TODO. Every code step contains full code. The only conditional instruction (Task 10 `req.cid`) gives an explicit check-and-fallback.

**Type consistency:** `mkSignal` fields (`axis,magnitude,confidence,freshness,sensor,distanceKm,detail`) are used identically across firms/openmeteo-air/power/seismic and consumed by `fuseSignals`. `fuse`/`fuseSignals`/`levelFromMagnitude` names match between fusion.js and its test. Endpoint returns `{...assessment, location}` and the frontend reads `level, perHazard[{axis,level,confidence,sensorsUsed,gapNote}], sensorsUsed, gapsCovered, location.place` — all present in the `EOAssessment` typedef and the endpoint payload.

**Scope:** Focused on the EO engine end-to-end. Community-feature globalization and Sentinel adapters are deliberately deferred. Single coherent plan that ships working software.

---

## Open follow-on (not in this plan)
- **Phase 2:** Copernicus/Sentinel adapters (S-1 SAR flood, S-2 NBR/NDVI, S-5P) via Sentinel Hub Statistical API + OAuth token caching; GIBS VIIRS night-lights for power-outage detection.
- **Community globalization:** route the existing reports/aid/missing/vulnerable views through the detected location instead of `data/incidents.js` `BASE`.
- **DSS merge:** feed `EOAssessment` axes into `services/dss.js` so `/api/dss` and `/api/sync` reflect satellite signals (kept separate in Phase 1 to ship the engine first).
