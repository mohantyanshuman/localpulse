# Global Satellite Fusion: Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (Agent Teams). Steps use checkbox (`- [ ]`) syntax.

**Goal:** (Track A) Add Sentinel-5P, Sentinel-2, and Sentinel-1 SAR adapters via the Copernicus Data Space Statistical API to push the fused engine past 15 satellite platforms; (Track B) make the main DSS risk engine and `/api/sync` reflect the satellite assessment for the user's detected location, worldwide.

**Architecture:** Track A reuses the proven Phase 1 adapter contract (`{ id, axes, requires, ttlMs, query(lat,lng) }` returning `Signal[]` via `mkSignal`). A shared `sentinelhub.js` handles Copernicus OAuth (token cached) and the Statistical API POST; three thin adapters supply evalscripts + stat→magnitude mapping and register in `fusion.js`. They `require` `COPERNICUS_CLIENT_ID`/`COPERNICUS_CLIENT_SECRET` and skip gracefully when unset. Track B threads the EO assessment into `services/dss.js` and the `/api/dss` + `/api/sync` handlers, resolving location via the existing `services/geolocate.js`.

**Tech Stack:** Node 20 (global `fetch`, CommonJS), `node --test`, existing `services/eo/*` contract.

**Reference templates (already in repo, read before implementing):** `services/eo/adapters/openmeteo-air.js` (simple GET adapter + `toSignal`), `services/eo/adapters/firms.js` (multi-source + parsing), `services/eo/fusion.js` (ADAPTERS registry), `services/eo/signal.js` (`mkSignal`, axes).

---

## Track A: Sentinel adapters

### Task A1: Copernicus Sentinel Hub client (OAuth + Statistical API)

**Files:**
- Create: `services/eo/sentinelhub.js`
- Create: `test/eo/sentinelhub.test.js`

CDSE endpoints (free tier):
- Token: `POST https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token` (form body `grant_type=client_credentials&client_id=..&client_secret=..`) → `{ access_token, expires_in }`.
- Statistics: `POST https://sh.dataspace.copernicus.eu/api/v1/statistics` (Bearer token, JSON body) → `{ data: [{ interval, outputs: { data: { bands: { B0: { stats: { mean, ... } } } } } }] }`.

- [ ] **Step 1: Write the failing test:** `test/eo/sentinelhub.test.js`

```js
const test = require('node:test');
const assert = require('node:assert');
const { hasCreds, latestMean, bboxAround } = require('../../services/eo/sentinelhub');

test('hasCreds reflects env presence', () => {
  const prev = process.env.COPERNICUS_CLIENT_ID;
  delete process.env.COPERNICUS_CLIENT_ID;
  assert.strictEqual(hasCreds(), false);
  process.env.COPERNICUS_CLIENT_ID = 'x';
  process.env.COPERNICUS_CLIENT_SECRET = 'y';
  assert.strictEqual(hasCreds(), true);
  if (prev === undefined) { delete process.env.COPERNICUS_CLIENT_ID; delete process.env.COPERNICUS_CLIENT_SECRET; }
});

test('bboxAround builds a [w,s,e,n] box around a point', () => {
  const b = bboxAround(30.9, 77.1, 0.05);
  assert.deepStrictEqual(b, [77.05, 30.85, 77.15, 30.95]);
});

test('latestMean extracts the most recent interval mean from a stats response', () => {
  const resp = { data: [
    { interval: { from: '2026-05-20T00:00:00Z' }, outputs: { data: { bands: { B0: { stats: { mean: 1.1 } } } } } },
    { interval: { from: '2026-05-23T00:00:00Z' }, outputs: { data: { bands: { B0: { stats: { mean: 2.4 } } } } } },
  ] };
  assert.strictEqual(latestMean(resp), 2.4);
});

test('latestMean returns null on empty/garbage', () => {
  assert.strictEqual(latestMean({ data: [] }), null);
  assert.strictEqual(latestMean(null), null);
});
```

- [ ] **Step 2: Run `npm test`:** expect FAIL (module not found).

- [ ] **Step 3: Implement `services/eo/sentinelhub.js`**

```js
// Copernicus Data Space (CDSE) Sentinel Hub client: OAuth client-credentials
// token (cached) + Statistical API helper. Free tier. Degrades to null on any
// failure so a Sentinel outage never breaks fusion.
const { getText } = require('./http');

const TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const STATS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/statistics';

let cached = { token: null, exp: 0 };

function hasCreds() {
  return !!(process.env.COPERNICUS_CLIENT_ID && process.env.COPERNICUS_CLIENT_SECRET);
}

function bboxAround(lat, lng, d = 0.05) {
  return [
    +(lng - d).toFixed(6), +(lat - d).toFixed(6),
    +(lng + d).toFixed(6), +(lat + d).toFixed(6),
  ];
}

async function token() {
  if (!hasCreds()) return null;
  const now = Date.now();
  if (cached.token && now < cached.exp) return cached.token;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.COPERNICUS_CLIENT_ID,
    client_secret: process.env.COPERNICUS_CLIENT_SECRET,
  }).toString();
  const txt = await getText(TOKEN_URL, 9000, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!txt) return null;
  let j; try { j = JSON.parse(txt); } catch { return null; }
  if (!j.access_token) return null;
  cached = { token: j.access_token, exp: now + Math.max(0, (j.expires_in || 600) - 60) * 1000 };
  return cached.token;
}

// Run a Statistical API request for one collection over the last `days`.
async function statistics({ collection, evalscript, lat, lng, days = 7, resm = 50 }) {
  const tok = await token();
  if (!tok) return null;
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
  const bbox = bboxAround(lat, lng);
  const payload = {
    input: {
      bounds: { bbox, properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' } },
      data: [{ type: collection }],
    },
    aggregation: {
      timeRange: { from: from.toISOString(), to: to.toISOString() },
      aggregationInterval: { of: 'P1D' },
      evalscript,
      resx: 0.0005, resy: 0.0005,
    },
    calculations: { default: {} },
  };
  const txt = await getText(STATS_URL, 12000, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!txt) return null;
  try { return JSON.parse(txt); } catch { return null; }
}

// Most recent interval's mean for output id "data", band "B0".
function latestMean(resp) {
  const data = resp && Array.isArray(resp.data) ? resp.data : null;
  if (!data || !data.length) return null;
  const withMean = data
    .map((d) => ({
      from: d.interval && d.interval.from,
      mean: d.outputs && d.outputs.data && d.outputs.data.bands && d.outputs.data.bands.B0
        && d.outputs.data.bands.B0.stats && d.outputs.data.bands.B0.stats.mean,
    }))
    .filter((x) => Number.isFinite(x.mean));
  if (!withMean.length) return null;
  withMean.sort((a, b) => String(b.from).localeCompare(String(a.from)));
  return withMean[0].mean;
}

module.exports = { hasCreds, bboxAround, token, statistics, latestMean };
```

- [ ] **Step 4: Run `npm test`:** expect PASS.
- [ ] **Step 5: (no commit; controller commits)** Report DONE to team-lead.

---

### Task A2: Sentinel-5P aerosol adapter (air)

**Files:** Create `services/eo/adapters/sentinel5p.js` + `test/eo/sentinel5p.test.js`.

Evalscript band: `AER_AI_354_388` (UV aerosol index; higher = more absorbing aerosol / smoke / dust). Collection `sentinel-5p-l2`.

- [ ] **Step 1: Failing test:** `test/eo/sentinel5p.test.js`

```js
const test = require('node:test');
const assert = require('node:assert');
const { toSignal } = require('../../services/eo/adapters/sentinel5p');

test('toSignal maps aerosol index to an air signal', () => {
  const s = toSignal(2.0, { lat: 1, lng: 1 });
  assert.strictEqual(s.axis, 'air');
  assert.ok(s.magnitude > 0.6, `AI 2.0 should be high, got ${s.magnitude}`);
  assert.strictEqual(s.sensor, 'Sentinel-5P TROPOMI');
});

test('toSignal returns null when no value', () => {
  assert.strictEqual(toSignal(null, { lat: 1, lng: 1 }), null);
});
```

- [ ] **Step 2: `npm test`:** expect FAIL.
- [ ] **Step 3: Implement `services/eo/adapters/sentinel5p.js`**

```js
// Sentinel-5P TROPOMI UV aerosol index via CDSE Statistical API. Cross-checks the
// keyless CAMS air adapter on the air axis. requires Copernicus creds; skips if absent.
const sh = require('../sentinelhub');
const { mkSignal } = require('../signal');

const EVALSCRIPT = `//VERSION=3
function setup(){return {input:["AER_AI_354_388","dataMask"],output:[{id:"data",bands:1}]}}
function evaluatePixel(s){return {data:[s.AER_AI_354_388]}}`;

// Aerosol index: <0 clean, ~1 hazy, >2 heavy smoke/dust. Map to 0..1 over [0,3].
function toSignal(ai, center) {
  if (!Number.isFinite(ai)) return null;
  return mkSignal({
    axis: 'air',
    magnitude: Math.max(0, Math.min(1, ai / 3)),
    confidence: 0.75,
    freshness: Date.now(),
    sensor: 'Sentinel-5P TROPOMI',
    distanceKm: 0,
    detail: { aerosolIndex: ai },
  });
}

async function query(lat, lng) {
  const resp = await sh.statistics({ collection: 'sentinel-5p-l2', evalscript: EVALSCRIPT, lat, lng, days: 7 });
  const s = toSignal(sh.latestMean(resp), { lat, lng });
  return s ? [s] : [];
}

module.exports = {
  id: 'sentinel5p', axes: ['air'],
  requires: ['COPERNICUS_CLIENT_ID', 'COPERNICUS_CLIENT_SECRET'],
  ttlMs: 3 * 60 * 60 * 1000,
  query, toSignal,
};
```

- [ ] **Step 4: `npm test`:** expect PASS. Report DONE (no commit).

---

### Task A3: Sentinel-2 vegetation/dryness adapter (vegetation)

**Files:** Create `services/eo/adapters/sentinel2.js` + `test/eo/sentinel2.test.js`.

NDVI from B08/B04, collection `sentinel-2-l2a`. Low NDVI in normally-vegetated areas signals dryness/burn. Honest caveat: single-date NDVI has no baseline, so confidence is modest and it is a supporting axis.

- [ ] **Step 1: Failing test:** `test/eo/sentinel2.test.js`

```js
const test = require('node:test');
const assert = require('node:assert');
const { toSignal } = require('../../services/eo/adapters/sentinel2');

test('low NDVI yields higher vegetation-stress magnitude', () => {
  const dry = toSignal(0.1, { lat: 1, lng: 1 });
  const lush = toSignal(0.8, { lat: 1, lng: 1 });
  assert.strictEqual(dry.axis, 'vegetation');
  assert.ok(dry.magnitude > lush.magnitude, 'drier should score higher');
  assert.ok(lush.magnitude < 0.3);
});

test('toSignal returns null when no value', () => {
  assert.strictEqual(toSignal(null, { lat: 1, lng: 1 }), null);
});
```

- [ ] **Step 2: `npm test`:** expect FAIL.
- [ ] **Step 3: Implement `services/eo/adapters/sentinel2.js`**

```js
// Sentinel-2 NDVI via CDSE Statistical API as a vegetation-dryness proxy.
// Supporting axis (no baseline in a single-date read), modest confidence.
const sh = require('../sentinelhub');
const { mkSignal } = require('../signal');

const EVALSCRIPT = `//VERSION=3
function setup(){return {input:["B04","B08","dataMask"],output:[{id:"data",bands:1}]}}
function evaluatePixel(s){let d=s.B08+s.B04+1e-6;return {data:[(s.B08-s.B04)/d]}}`;

// NDVI ~ -0.1 bare/water, ~0.2 sparse, ~0.6+ dense vegetation.
// Dryness magnitude = how far below a healthy 0.6 the NDVI sits, scaled to 0..1.
function toSignal(ndvi, center) {
  if (!Number.isFinite(ndvi)) return null;
  const dryness = Math.max(0, Math.min(1, (0.6 - ndvi) / 0.6));
  return mkSignal({
    axis: 'vegetation',
    magnitude: dryness,
    confidence: 0.5,
    freshness: Date.now(),
    sensor: 'Sentinel-2 MSI',
    distanceKm: 0,
    detail: { ndvi },
  });
}

async function query(lat, lng) {
  const resp = await sh.statistics({ collection: 'sentinel-2-l2a', evalscript: EVALSCRIPT, lat, lng, days: 14 });
  const s = toSignal(sh.latestMean(resp), { lat, lng });
  return s ? [s] : [];
}

module.exports = {
  id: 'sentinel2', axes: ['vegetation'],
  requires: ['COPERNICUS_CLIENT_ID', 'COPERNICUS_CLIENT_SECRET'],
  ttlMs: 24 * 60 * 60 * 1000,
  query, toSignal,
};
```

- [ ] **Step 4: `npm test`:** expect PASS. Report DONE (no commit).

---

### Task A4: Sentinel-1 SAR surface-water adapter (flood)

**Files:** Create `services/eo/adapters/sentinel1.js` + `test/eo/sentinel1.test.js`.

VV backscatter (dB), collection `sentinel-1-grd`. Low VV (smooth water) indicates standing water → flood. SAR sees through cloud/night, covering the optical gap. Honest caveat: single-date water extent is approximate.

- [ ] **Step 1: Failing test:** `test/eo/sentinel1.test.js`

```js
const test = require('node:test');
const assert = require('node:assert');
const { toSignal } = require('../../services/eo/adapters/sentinel1');

test('low VV backscatter (water) yields higher flood magnitude', () => {
  const wet = toSignal(-20, { lat: 1, lng: 1 });
  const dry = toSignal(-5, { lat: 1, lng: 1 });
  assert.strictEqual(wet.axis, 'flood');
  assert.ok(wet.magnitude > dry.magnitude, 'smoother (lower dB) = more water');
});

test('toSignal returns null when no value', () => {
  assert.strictEqual(toSignal(null, { lat: 1, lng: 1 }), null);
});
```

- [ ] **Step 2: `npm test`:** expect FAIL.
- [ ] **Step 3: Implement `services/eo/adapters/sentinel1.js`**

```js
// Sentinel-1 SAR VV backscatter via CDSE Statistical API as a surface-water proxy.
// SAR penetrates cloud and works at night, covering the optical sensors' gap on the
// flood axis. Single-date extent is approximate; modest confidence.
const sh = require('../sentinelhub');
const { mkSignal } = require('../signal');

const EVALSCRIPT = `//VERSION=3
function setup(){return {input:["VV","dataMask"],output:[{id:"data",bands:1}]}}
function evaluatePixel(s){return {data:[s.VV]}}`;

// VV linear backscatter from CDSE is ~0..1; water is very low. We accept either a
// dB value (negative) or linear (0..1) and normalize: lower => more water.
// Map dB range [-25,-5] -> [1,0]; if value looks linear (>=0 and <=1), use 1-value.
function toSignal(vv, center) {
  if (!Number.isFinite(vv)) return null;
  let mag;
  if (vv >= 0 && vv <= 1) mag = 1 - vv;            // linear backscatter
  else mag = Math.max(0, Math.min(1, (-5 - vv) / 20)); // dB: -5 dry .. -25 water
  return mkSignal({
    axis: 'flood',
    magnitude: Math.max(0, Math.min(1, mag)),
    confidence: 0.55,
    freshness: Date.now(),
    sensor: 'Sentinel-1 SAR',
    distanceKm: 0,
    detail: { vv },
  });
}

async function query(lat, lng) {
  const resp = await sh.statistics({ collection: 'sentinel-1-grd', evalscript: EVALSCRIPT, lat, lng, days: 12 });
  const s = toSignal(sh.latestMean(resp), { lat, lng });
  return s ? [s] : [];
}

module.exports = {
  id: 'sentinel1', axes: ['flood'],
  requires: ['COPERNICUS_CLIENT_ID', 'COPERNICUS_CLIENT_SECRET'],
  ttlMs: 6 * 60 * 60 * 1000,
  query, toSignal,
};
```

- [ ] **Step 4: `npm test`:** expect PASS. Report DONE (no commit).

---

### Task A5: Register Sentinel adapters in fusion

**Files:** Modify `services/eo/fusion.js`.

- [ ] **Step 1:** In `services/eo/fusion.js`, extend the `ADAPTERS` array to include the three new adapters:

```js
const ADAPTERS = [
  require('./adapters/firms'),
  require('./adapters/openmeteo-air'),
  require('./adapters/power'),
  require('./adapters/seismic'),
  require('./adapters/sentinel5p'),
  require('./adapters/sentinel2'),
  require('./adapters/sentinel1'),
];
```

- [ ] **Step 2: Add a fusion test** asserting the new adapters are skipped (not crash) when creds absent. Append to `test/eo/fusion.test.js`:

```js
test('fuse skips Sentinel adapters when Copernicus creds are absent', async () => {
  const prevId = process.env.COPERNICUS_CLIENT_ID;
  const prevSecret = process.env.COPERNICUS_CLIENT_SECRET;
  delete process.env.COPERNICUS_CLIENT_ID;
  delete process.env.COPERNICUS_CLIENT_SECRET;
  const { fuse } = require('../../services/eo/fusion');
  const out = await fuse(0, 0);
  assert.ok(out.skipped.includes('sentinel5p'));
  assert.ok(out.skipped.includes('sentinel1'));
  assert.ok(out.skipped.includes('sentinel2'));
  if (prevId !== undefined) process.env.COPERNICUS_CLIENT_ID = prevId;
  if (prevSecret !== undefined) process.env.COPERNICUS_CLIENT_SECRET = prevSecret;
});
```

- [ ] **Step 3: `npm test`:** expect PASS. Report DONE (no commit).

---

## Track B: DSS + worldwide integration

### Task B1: DSS consumes satellite EO signals

**Files:** Modify `services/dss.js`; create/extend `test/eo/dss-eo.test.js`.

First **read `services/dss.js`** to learn the exact `assess(...)` signature and its return shape (it currently takes incidents, hazards, facilities, opts and returns `{ level, score, recommendations, headline, ... }`).

- [ ] **Step 1: Write the failing test:** `test/eo/dss-eo.test.js`

```js
const test = require('node:test');
const assert = require('node:assert');
const dss = require('../../services/dss');

test('mergeEo raises DSS level when a severe satellite axis is present', () => {
  const base = { level: 'ok', score: 1, recommendations: [], headline: { en: 'Calm' } };
  const eo = { level: 'severe', perHazard: [{ axis: 'fire', level: 'severe', confidence: 0.9, magnitude: 0.85, sensorsUsed: ['VIIRS NOAA-20'], gapNote: 'x' }], sensorsUsed: ['VIIRS NOAA-20'] };
  const merged = dss.mergeEo(base, eo);
  assert.strictEqual(merged.level, 'severe');
  assert.ok(merged.recommendations.some((r) => /fire/i.test(r.text || r)));
  assert.ok(merged.satellite, 'merged carries a satellite summary');
});

test('mergeEo is a no-op when eo is null', () => {
  const base = { level: 'ok', score: 1, recommendations: [], headline: { en: 'Calm' } };
  assert.deepStrictEqual(dss.mergeEo(base, null), base);
});
```

- [ ] **Step 2: `npm test`:** expect FAIL (`dss.mergeEo` not a function).

- [ ] **Step 3: Implement `mergeEo` in `services/dss.js`** and export it. Add near the existing exports:

```js
const EO_RANK = { ok: 0, elevated: 1, high: 2, severe: 3 };

// Fold a satellite EOAssessment into a DSS result: take the higher level, add a
// recommendation per elevated satellite axis, and attach a compact satellite summary.
function mergeEo(assessment, eo) {
  if (!eo || !Array.isArray(eo.perHazard)) return assessment;
  const out = { ...assessment, recommendations: [...(assessment.recommendations || [])] };
  if (EO_RANK[eo.level] > EO_RANK[out.level || 'ok']) out.level = eo.level;
  for (const h of eo.perHazard) {
    if (EO_RANK[h.level] >= EO_RANK.high) {
      out.recommendations.push({
        kind: 'satellite',
        level: h.level,
        scope: 'area',
        text: `Satellite ${h.axis} signal is ${h.level} (${h.sensorsUsed.join(', ')}).`,
      });
    }
  }
  out.satellite = {
    level: eo.level,
    sensorsUsed: eo.sensorsUsed || [],
    axes: eo.perHazard.map((h) => ({ axis: h.axis, level: h.level, confidence: h.confidence })),
  };
  return out;
}

module.exports.mergeEo = mergeEo;
```

(Adapt to the actual recommendation shape found in dss.js: if recommendations are plain strings rather than objects, push the string `Satellite <axis> signal is <level> (<sensors>).` instead, and make the test's matcher already tolerates both via `r.text || r`.)

- [ ] **Step 4: `npm test`:** expect PASS. Report DONE (no commit).

### Task B2: `/api/dss` and `/api/sync` surface the satellite assessment (location-aware)

**Files:** Modify `server.js`.

First **read the existing `/api/dss` (around server.js:143) and `/api/sync` (around server.js:160)** handlers and the `dss`, `eoFusion`, `geolocate` requires (already present from Phase 1).

- [ ] **Step 1: Write the failing integration test:** `test/eo/dss-endpoint.test.js`

```js
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
process.env.PORT = '0';
const app = require('../../server');

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const addr = app.address();
    const req = http.request({ host: '127.0.0.1', port: addr.port, path, method: 'GET', headers }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject); req.end();
  });
}

test('GET /api/dss?lat&lng includes a satellite summary', async () => {
  const r = await get('/api/dss?lat=34.05&lng=-118.24');
  assert.strictEqual(r.status, 200);
  const j = JSON.parse(r.body);
  assert.ok('satellite' in j, 'dss response carries satellite summary');
});

test.after(() => app.close());
```

- [ ] **Step 2: `npm test`:** expect FAIL (`satellite` not in dss response).

- [ ] **Step 3: Modify the `/api/dss` handler in `server.js`.** After it computes the base assessment, when `lat`/`lng` are present, fuse EO for that point and merge:

```js
// inside app.get('/api/dss', ...), after building the base `assessment`:
const qLat = parseFloat(req.query.lat);
const qLng = parseFloat(req.query.lng);
if (Number.isFinite(qLat) && Number.isFinite(qLng)) {
  try {
    const eo = await eoFusion.fuse(qLat, qLng);
    assessment = dss.mergeEo(assessment, eo);
  } catch { /* satellite layer optional; ignore */ }
}
```

Make the handler `async` if it is not already. Keep the existing caching headers. (If the handler currently builds `assessment` as a `const`, change it to `let` so `mergeEo` can reassign.)

- [ ] **Step 4:** In `/api/sync`, when the request carries `lat`/`lng`, attach the merged satellite summary to the sync payload's DSS section the same way (call `eoFusion.fuse` + `dss.mergeEo`). Keep it best-effort inside a try/catch so sync never fails on a satellite hiccup.

- [ ] **Step 5: `npm test`:** expect PASS (all prior tests + the new one). Report DONE (no commit).

---

## Self-Review

- **Track A satellites:** A1 client + A2/A3/A4 adapters + A5 registration push the platform count past 15 (FIRMS 5 + CAMS + POWER + USGS + S-5P + S-2 + S-1). All `require` Copernicus creds and skip gracefully (verified by A5 test). Fixture tests cover parsing + stat→magnitude mapping; live correctness requires creds + manual verification.
- **Track B integration:** B1 `mergeEo` (unit-tested both branches) + B2 wires it into `/api/dss` and `/api/sync` location-aware. Existing behavior preserved when no lat/lng.
- **Placeholders:** none; full code given for new modules; existing-file edits specify read-first + exact insertion.
- **Type consistency:** Sentinel adapters use the same `{id,axes,requires,ttlMs,query}` + `mkSignal` contract as Phase 1; `fusion.fuse` consumes them unchanged; `mergeEo` consumes the real `EOAssessment` shape (`level`, `perHazard[{axis,level,confidence,sensorsUsed,gapNote,magnitude}]`, `sensorsUsed`).
- **Conflict isolation:** Track A edits `services/eo/*` + `fusion.js`; Track B edits `services/dss.js` + `server.js`. Disjoint. fusion.js is Track A only. Controller commits sequentially.

## Manual verification (after Copernicus creds are added)
- `COPERNICUS_CLIENT_ID/SECRET` in env, boot, `GET /api/eo?lat&lng` at a smoky/flood/fire location → `skipped` no longer lists sentinel*, and `sensorsUsed` includes Sentinel platforms.
- `GET /api/dss?lat&lng` → response includes `satellite` summary.

## Out of scope (future)
- Globalizing the Solan-specific community news ingestion (Google News queries, region keyword filters) to arbitrary worldwide locations is a separate design effort; the live community feed stays Solan-tuned while `/api/eo` + DSS satellite layer are global.
- GIBS imagery-derived adapters (night-lights power-outage), which need raster tile sampling rather than a point/statistical API.
