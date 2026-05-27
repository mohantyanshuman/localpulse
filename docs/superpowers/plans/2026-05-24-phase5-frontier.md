# Phase 5: Frontier Differentiators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (Agent Teams). Steps use checkbox (`- [ ]`).

**Goal:** Build five disjoint modules (physics-constrained propagation, conformal calibration, cross-sensor divergence, verifiable provenance, on-device offline inference), then the controller wires them into predict.js / fusion.js / server.js / app.js.

**Conventions:** CommonJS, Node 20, `node --test`. Reuse `services/eo/http.js` (`getJson`, `haversineKm`), `services/eo/signal.js`, `services/eo/cache.js`. Each module is a NEW file with pure, unit-tested functions; **implementers do NOT touch predict.js, fusion.js, server.js, or app.js** (controller integrates to avoid conflicts) and run NO git.

---

### Module A: Physics-constrained propagation (`services/eo/physics.js`)
**Files:** Create `services/eo/physics.js` + `test/eo/physics.test.js`.

- [ ] **Test** (`test/eo/physics.test.js`):
```js
const test = require('node:test');
const assert = require('node:assert');
const P = require('../../services/eo/physics');

test('fireRateOfSpread rises with wind, dryness, and upslope', () => {
  const calm = P.fireRateOfSpread({ drynessP: 0.3, windKmh: 5, slopeDeg: 0 });
  const extreme = P.fireRateOfSpread({ drynessP: 0.9, windKmh: 45, slopeDeg: 20 });
  assert.ok(extreme.rosMPerMin > calm.rosMPerMin);
  assert.ok(extreme.reachKm1h > 0);
});

test('floodOnsetFactor is higher for steep terrain + intense rain', () => {
  const flat = P.floodOnsetFactor({ rainMmPerH: 5, slopeDeg: 1 });
  const steep = P.floodOnsetFactor({ rainMmPerH: 30, slopeDeg: 15 });
  assert.ok(steep > flat && steep <= 1);
});

test('slopeFromRing computes a non-negative slope from elevation samples', () => {
  const s = P.slopeFromRing(1000, [1000, 1100, 1000, 900], 1.0);
  assert.ok(s.slopeDeg >= 0 && Number.isFinite(s.aspectDeg));
});
```

- [ ] **Implement `services/eo/physics.js`:**
```js
// Physics-constrained hazard propagation. Interpretable formulas (Rothermel-style
// fire ROS; rainfall-runoff slope proxy) constrained by satellite-derived inputs.
// Elevation/slope from the keyless Open-Meteo Elevation API.
const { getJson } = require('./http');

// Simplified Rothermel: ROS = R0 * (1 + windFactor + slopeFactor), scaled by fuel dryness.
function fireRateOfSpread({ drynessP, windKmh, slopeDeg }) {
  const dry = Math.max(0, Math.min(1, drynessP));
  const R0 = 1.5;                                  // base m/min in cured fuel
  const windFactor = Math.pow(Math.max(0, windKmh) / 10, 1.5) * 0.4;
  const slopeFactor = Math.pow(Math.tan((Math.max(0, slopeDeg) * Math.PI) / 180), 2) * 3;
  const ros = R0 * dry * (1 + windFactor + slopeFactor);
  return { rosMPerMin: +ros.toFixed(2), reachKm1h: +((ros * 60) / 1000).toFixed(2) };
}

// Flood onset proxy: intense rain on steep ground concentrates runoff faster.
function floodOnsetFactor({ rainMmPerH, slopeDeg }) {
  const rain = Math.max(0, Math.min(1, rainMmPerH / 40));
  const slope = Math.max(0, Math.min(1, slopeDeg / 20));
  return +Math.max(0, Math.min(1, 0.6 * rain + 0.4 * rain * slope)).toFixed(3);
}

// Estimate slope+aspect from a center elevation and a 4-point ring (N,E,S,W) at ~ringKm.
function slopeFromRing(center, ring, ringKm) {
  const [n, e, s, w] = ring.map(Number);
  const dz_ns = (n - s); const dz_ew = (e - w);
  const dist = Math.max(0.001, ringKm * 1000 * 2);
  const grad = Math.sqrt(dz_ns * dz_ns + dz_ew * dz_ew) / dist;
  const slopeDeg = (Math.atan(grad) * 180) / Math.PI;
  const aspectDeg = ((Math.atan2(dz_ew, dz_ns) * 180) / Math.PI + 360) % 360;
  return { slopeDeg: +slopeDeg.toFixed(2), aspectDeg: +aspectDeg.toFixed(1) };
}

async function terrain(lat, lng, ringKm = 1) {
  const d = ringKm / 111;
  const pts = [[lat + d, lng], [lat, lng + d], [lat - d, lng], [lat, lng - d]];
  const lats = [lat, ...pts.map((p) => p[0])].join(',');
  const lngs = [lng, ...pts.map((p) => p[1])].join(',');
  const j = await getJson(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`, 7000);
  const el = j && Array.isArray(j.elevation) ? j.elevation : null;
  if (!el || el.length < 5) return null;
  return { elevationM: el[0], ...slopeFromRing(el[0], el.slice(1), ringKm) };
}

module.exports = { fireRateOfSpread, floodOnsetFactor, slopeFromRing, terrain };
```
- [ ] `npm test` → PASS. SendMessage team-lead DONE (no git).

---

### Module B: Conformal calibration (`services/eo/conformal.js`, `services/eo/predlog.js`)
**Files:** Create `services/eo/conformal.js` + `services/eo/predlog.js` + `test/eo/conformal.test.js`.

- [ ] **Test** (`test/eo/conformal.test.js`):
```js
const test = require('node:test');
const assert = require('node:assert');
const C = require('../../services/eo/conformal');

test('quantile returns the split-conformal (1-alpha) nonconformity threshold', () => {
  const scores = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  const q = C.conformalQuantile(scores, 0.1); // 90% coverage
  assert.ok(q >= 0.9 && q <= 1.0);
});

test('interval is honest: calibrated:false when below min calibration size', () => {
  const r = C.interval(0.6, [0.1, 0.2], 0.1); // only 2 samples
  assert.strictEqual(r.calibrated, false);
  assert.ok(r.low <= 0.6 && r.high >= 0.6);
});

test('interval is calibrated with enough samples', () => {
  const scores = Array.from({ length: 60 }, (_, i) => (i + 1) / 60 * 0.5);
  const r = C.interval(0.6, scores, 0.1);
  assert.strictEqual(r.calibrated, true);
  assert.ok(r.high - r.low > 0);
});
```

- [ ] **Implement `services/eo/conformal.js`:**
```js
// Split-conformal distribution-free intervals. Given past nonconformity scores
// (|predicted - observed|), the (1-alpha) empirical quantile bounds the error with
// guaranteed marginal coverage once enough samples exist.
const MIN_CAL = 30;

function conformalQuantile(scores, alpha) {
  const s = scores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
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
```

- [ ] **Implement `services/eo/predlog.js`** (append-only log + nonconformity score retrieval; in-memory ring with optional persist hook):
```js
// Prediction log feeding conformal calibration. In-memory ring (capped); a persist
// hook can later durably store + attach observed outcomes. Nonconformity score =
// |predictedMagnitude - observedMagnitude| once an outcome is attached.
const MAX = 5000;
const log = []; // { ts, cell, hazard, pred, observed? }

function record(entry) {
  log.push({ ts: Date.now(), ...entry });
  if (log.length > MAX) log.splice(0, log.length - MAX);
}

function attachOutcome(cell, hazard, observed, withinMs = 48 * 3600 * 1000) {
  const now = Date.now();
  for (const e of log) {
    if (e.cell === cell && e.hazard === hazard && e.observed == null && now - e.ts <= withinMs) {
      e.observed = observed;
    }
  }
}

function scores(hazard) {
  return log.filter((e) => e.hazard === hazard && e.observed != null)
    .map((e) => Math.abs(e.pred - e.observed));
}

function _reset() { log.length = 0; }

module.exports = { record, attachOutcome, scores, _reset };
```
- [ ] Add to `test/eo/conformal.test.js` a predlog test: record 3, attachOutcome, scores returns residuals. `npm test` → PASS. DONE (no git).

---

### Module C: Cross-sensor divergence (`services/eo/divergence.js`)
**Files:** Create `services/eo/divergence.js` + `test/eo/divergence.test.js`.

- [ ] **Test**:
```js
const test = require('node:test');
const assert = require('node:assert');
const D = require('../../services/eo/divergence');

test('jsDivergence is ~0 for identical, higher for opposite', () => {
  assert.ok(D.jsDivergence(0.8, 0.8) < 1e-6);
  assert.ok(D.jsDivergence(0.05, 0.95) > 0.5);
});

test('analyzeAxis flags consensus vs blindspot', () => {
  const consensus = D.analyzeAxis('air', [{ sensor: 'a', magnitude: 0.7 }, { sensor: 'b', magnitude: 0.72 }]);
  assert.strictEqual(consensus.flag, 'consensus');
  const blind = D.analyzeAxis('flood', [{ sensor: 'a', magnitude: 0.05 }, { sensor: 'b', magnitude: 0.9 }]);
  assert.ok(['blindspot', 'suspect'].includes(blind.flag));
  assert.ok(blind.divergence > consensus.divergence);
});
```

- [ ] **Implement `services/eo/divergence.js`:**
```js
// Cross-sensor divergence: treat each sensor's magnitude as Bernoulli(p) and measure
// Jensen-Shannon divergence between sensors on the same axis. High divergence means
// the sensors disagree -> either a blindspot (one sees a hazard others miss) or a
// suspect feed (an implausible outlier to down-weight).
function kl(p, q) {
  const e = 1e-9;
  p = Math.min(1 - e, Math.max(e, p)); q = Math.min(1 - e, Math.max(e, q));
  return p * Math.log2(p / q) + (1 - p) * Math.log2((1 - p) / (1 - q));
}
function jsDivergence(p1, p2) {
  const m = (p1 + p2) / 2;
  return Math.max(0, Math.min(1, 0.5 * kl(p1, m) + 0.5 * kl(p2, m)));
}

function analyzeAxis(axis, signals) {
  const mags = signals.map((s) => Math.max(0, Math.min(1, s.magnitude)));
  if (mags.length < 2) return { axis, divergence: 0, flag: 'single', outlier: null };
  // pairwise mean JS divergence
  let sum = 0, cnt = 0;
  for (let i = 0; i < mags.length; i++) for (let j = i + 1; j < mags.length; j++) { sum += jsDivergence(mags[i], mags[j]); cnt++; }
  const divergence = +(sum / cnt).toFixed(3);
  const max = Math.max(...mags), min = Math.min(...mags);
  const mean = mags.reduce((a, b) => a + b, 0) / mags.length;
  let flag = 'consensus';
  if (divergence >= 0.3) {
    // one sensor far ABOVE the rest -> blindspot (others may be blind); far BELOW or implausible -> suspect
    const top = signals[mags.indexOf(max)];
    flag = (max - mean) > (mean - min) ? 'blindspot' : 'suspect';
    return { axis, divergence, flag, outlier: top ? top.sensor : null };
  }
  return { axis, divergence, flag, outlier: null };
}

module.exports = { jsDivergence, analyzeAxis };
```
- [ ] `npm test` → PASS. DONE (no git).

---

### Module D: Verifiable provenance (`services/eo/provenance.js`)
**Files:** Create `services/eo/provenance.js` + `test/eo/provenance.test.js`.

- [ ] **Test**:
```js
const test = require('node:test');
const assert = require('node:assert');
const PR = require('../../services/eo/provenance');

test('sign then verify round-trips; tamper is detected', () => {
  const payload = { level: 'high', sensorsUsed: ['VIIRS NOAA-20', 'CAMS'], predictions: [{ hazard: 'flood', likelihood: 'high' }] };
  const receipt = PR.sign(payload, 'secret-key');
  assert.ok(receipt.sig && receipt.inputsHash);
  assert.strictEqual(PR.verify(payload, receipt, 'secret-key').valid, true);
  const tampered = { ...payload, level: 'severe' };
  assert.strictEqual(PR.verify(tampered, receipt, 'secret-key').valid, false);
});

test('verify reports stale beyond ttl', () => {
  const receipt = PR.sign({ level: 'ok' }, 'k');
  receipt.ts -= 7200_000; // 2h ago
  const r = PR.verify({ level: 'ok' }, receipt, 'k', 3600_000);
  assert.strictEqual(r.stale, true);
});
```

- [ ] **Implement `services/eo/provenance.js`:**
```js
// Tamper-evident, offline-verifiable provenance for a prediction payload.
// Receipt binds a canonical hash of the payload + sensor inputs, signed with HMAC.
const crypto = require('crypto');

function canonical(payload) {
  // stable stringify (sorted keys) of the fields that matter for integrity
  const pick = { level: payload.level, sensorsUsed: payload.sensorsUsed, predictions: payload.predictions, perHazard: payload.perHazard };
  return JSON.stringify(pick, Object.keys(pick).sort());
}
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function sign(payload, secret = process.env.SYNC_SECRET || process.env.INGEST_TOKEN || 'localpulse-sync', model = 'eo-1') {
  const canon = canonical(payload);
  const inputsHash = sha256(canon);
  const ts = Date.now();
  const sig = crypto.createHmac('sha256', secret).update(`${inputsHash}.${model}.${ts}`).digest('hex');
  return { inputsHash, model, ts, sig };
}

function verify(payload, receipt, secret = process.env.SYNC_SECRET || process.env.INGEST_TOKEN || 'localpulse-sync', ttlMs = 3600_000) {
  if (!receipt || !receipt.sig) return { valid: false, stale: false };
  const inputsHash = sha256(canonical(payload));
  const expected = crypto.createHmac('sha256', secret).update(`${inputsHash}.${receipt.model}.${receipt.ts}`).digest('hex');
  const a = Buffer.from(expected); const b = Buffer.from(String(receipt.sig));
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b) && inputsHash === receipt.inputsHash;
  const stale = Date.now() - receipt.ts > ttlMs;
  return { valid, stale };
}

module.exports = { sign, verify, canonical };
```
- [ ] `npm test` → PASS. DONE (no git).

---

### Module E: On-device offline inference (`public/js/eo-offline.js`)
**Files:** Create `public/js/eo-offline.js` + `test/eo/eo-offline.test.js`.

The module is browser-targeted but written as plain functions exported via `module.exports` (guarded) so Node tests can load it. It re-derives the confidence-weighted overall level and per-axis divergence from cached signals, with zero network.

- [ ] **Test** (`test/eo/eo-offline.test.js`):
```js
const test = require('node:test');
const assert = require('node:assert');
const O = require('../../public/js/eo-offline');

test('recomputeLevel is confidence-weighted (offline parity with server)', () => {
  const lone = O.recomputeLevel([{ axis: 'vegetation', magnitude: 0.85, confidence: 0.5 }]);
  assert.ok(['ok', 'elevated'].includes(lone));
  const strong = O.recomputeLevel([{ axis: 'fire', magnitude: 0.7, confidence: 0.9 }]);
  assert.ok(['high', 'severe'].includes(strong));
});

test('ageLabel describes staleness', () => {
  assert.match(O.ageLabel(Date.now() - 120000), /min/);
});
```

- [ ] **Implement `public/js/eo-offline.js`:**
```js
// On-device offline inference: recompute the headline level from cached per-sensor
// signals with zero network, mirroring the server's confidence-weighted roll-up.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node tests
  if (typeof window !== 'undefined') window.EOOffline = api;                  // browser
})(this, function () {
  const RANK = { ok: 0, elevated: 1, high: 2, severe: 3 };
  function levelFromMagnitude(m) { return m >= 0.8 ? 'severe' : m >= 0.55 ? 'high' : m >= 0.3 ? 'elevated' : 'ok'; }
  function recomputeLevel(perHazard) {
    let topEff = 0, forced = 'ok';
    for (const h of perHazard || []) {
      const eff = (h.magnitude || 0) * (h.confidence || 0);
      if (eff > topEff) topEff = eff;
      if ((h.magnitude || 0) >= 0.8 && (h.confidence || 0) >= 0.7 && RANK.high > RANK[forced]) forced = 'high';
    }
    const w = levelFromMagnitude(topEff);
    return RANK[w] >= RANK[forced] ? w : forced;
  }
  function ageLabel(ts) {
    const min = Math.max(0, Math.round((Date.now() - ts) / 60000));
    return min < 60 ? `${min} min old` : `${Math.round(min / 60)} h old`;
  }
  return { recomputeLevel, levelFromMagnitude, ageLabel };
});
```
- [ ] `npm test` → PASS. DONE (no git).

---

## Controller integration (not for implementers)

1. **predict.js**: import `physics`; in `forecast()`, after building base predictions, `await physics.terrain(lat,lng)` (best-effort) and enrich the fire prediction with `fireRateOfSpread` (reach/ROS in `drivers`/reasoning) and the flood prediction with `floodOnsetFactor`. Import `conformal` + `predlog`; record each prediction and attach `interval` from `predlog.scores(hazard)`.
2. **fusion.js**: import `divergence`; in `summarizeAxis`, attach `divergence` + `flag`; if a feed is flagged `suspect`, reduce its contribution (multiply its magnitude weight by 0.5) and note it. Add `divergence` to each perHazard entry.
3. **server.js** `/api/eo`: after assembling `{...assessment, predictions, location}`, compute `provenance = provenanceSign(payload)` and include it; keep response shape additive.
4. **app.js**: load `eo-offline.js` (script tag in index.html); on fetch failure, recompute level from cached signals + show "offline estimate" with `ageLabel` and a provenance "verified" badge (verify receipt client-side via a tiny WebCrypto HMAC or trust-on-cache with the displayed model/ts). Render conformal intervals + divergence flags on the cards.
5. Run full `npm test`; live-verify `/api/eo` includes `provenance`, predictions carry `interval`, perHazard carry `divergence`; physics enriches fire/flood reasoning. Commit per module + integration; push.

## Self-review checklist
- Every module is pure-function unit-tested with fixtures; no network in tests.
- Honest degradation: conformal `calibrated:false` until MIN_CAL; physics best-effort; provenance verify constant-time.
- Disjoint files for parallel agents; controller owns predict/fusion/server/app edits.
- Technical effects present: accuracy (physics), calibration guarantee (conformal), integrity (provenance), robustness (divergence), offline operability (eo-offline).
