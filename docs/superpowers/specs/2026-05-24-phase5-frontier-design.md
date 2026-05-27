# Phase 5: Frontier Differentiators Design

**Date:** 2026-05-24
**Status:** Approved (build authorized). Builds on the Phase 1-4 satellite fusion + prediction engine.

## Goal
Add the frontier, technical-effect-bearing capabilities that differentiate LocalPulse from PDC DisasterAWARE / Google FloodHub and form a defensible patent stack: physics-constrained propagation, distribution-free calibrated uncertainty, cross-sensor divergence (anti-spoof + blindspot), cryptographically verifiable provenance, and on-device offline inference.

## Components (each a disjoint module; controller wires them)

1. **Physics-constrained propagation** (`services/eo/physics.js`)
   - Rothermel-style fire rate-of-spread: inputs fuel dryness (1 - NDVI proxy / humidity), wind speed, terrain slope (from elevation). Output: spread rate (m/min), direction (downwind), 1-3 h reach radius.
   - Rainfall-runoff flood proxy: rainfall intensity x a terrain factor from local slope/elevation (steep upslope catchment => faster onset). Output: onset-likelihood modifier + ETA shift.
   - Elevation/slope from Open-Meteo Elevation API (keyless) sampled at the point and a small ring to estimate slope + aspect.
   - Pure functions unit-tested; `enrich(prediction, ctx)` adjusts fire/flood predictions with physical reach/ETA.

2. **Conformal calibration** (`services/eo/conformal.js` + `services/eo/predlog.js`)
   - `predlog`: append-only log of (timestamp, location-cell, hazard, predicted magnitude/likelihood) to persist (Firestore via existing persist, or in-memory ring fallback), plus later outcome attachment.
   - `conformal`: given a calibration set of (predicted, residual) pairs, compute a distribution-free coverage interval (split-conformal: the (1-alpha) empirical quantile of nonconformity scores) and attach `interval` + `coverage` to predictions. Until enough calibration data accrues, emit `calibrated:false` with a heuristic interval and say so honestly.
   - Pure quantile/interval functions unit-tested.

3. **Cross-sensor divergence** (`services/eo/divergence.js`)
   - Per axis with >=2 sensors, compute Jensen-Shannon divergence between sensors' normalized magnitude distributions (treat each sensor magnitude as a Bernoulli p=magnitude). High JS => sensors disagree.
   - Output per axis: `divergence` 0..1, `flag` ('consensus' | 'blindspot' | 'suspect'). High divergence + one outlier sensor far above the rest => 'blindspot' (possible emerging hazard the others miss); high divergence with an implausible single feed => 'suspect' (down-weight that feed's trust).
   - Pure functions unit-tested; controller folds divergence into fusion's per-hazard output and trust weighting.

4. **Verifiable provenance** (`services/eo/provenance.js`)
   - `sign(payload)`: canonicalize the assessment+predictions, hash each sensor input value, build a receipt `{ inputsHash, sensors:[{sensor,axis,magnitude,freshness}], model:VERSION, ts, sig }` where `sig = HMAC_SHA256(secret, canonical)`. Reuse the SYNC_SECRET/INGEST_TOKEN convention.
   - `verify(payload, receipt)`: recompute and constant-time compare; returns {valid, stale} (stale if ts older than a TTL).
   - Pure functions unit-tested (sign then verify round-trip; tamper detection).
   - Controller attaches `provenance` to /api/eo; a `GET /api/eo/verify` (or client-side) can re-verify. Frontend shows a verified badge.

5. **On-device offline inference** (`public/js/eo-offline.js`)
   - Browser-side port of the pure roll-up: given the last cached per-sensor signals (persisted to localStorage from /api/eo), recompute the confidence-weighted overall level + per-axis divergence client-side, and re-verify the provenance receipt locally. Works with zero connectivity.
   - When offline, the panel recomputes from cache and shows "offline estimate (verified receipt)" with the data age.
   - Plain JS (no WASM dependency); technical effect = device remains functional and trustworthy with no network.

## Patentable synthesis (claim spine)
A connectivity-resilient method producing cryptographically-verifiable, conformally-calibrated, physics-constrained multi-hazard nowcasts from fused heterogeneous free EO feeds, wherein physical propagation models bound the forecast, split-conformal calibration provides distribution-free coverage, cross-sensor divergence gates per-feed trust and raises blindspot/anti-spoof alarms, and each output carries an offline-verifiable provenance receipt. Multiple interacting technical effects: accuracy, calibration guarantee, integrity/security, offline device operability.

## Honesty / scope
- Conformal coverage *guarantee* requires a calibration runway (log now, guarantee matures). MVP ships the machinery + honest `calibrated:false` until data accrues.
- Flood routing is a slope/catchment proxy, not full hydrodynamic routing (documented).
- On-device is a JS recompute of the roll-up + verification, not full client-side multi-feed fetch.
- No paid services; Open-Meteo elevation is keyless.

## Out of scope
- Full zkML proofs (too heavy: ~150s/token); we use HMAC-signed provenance (TEE/zk upgrade path noted).
- Trained PINN weights; we use the interpretable physical formulas directly.
