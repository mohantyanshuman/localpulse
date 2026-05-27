# Global Satellite Fusion Engine: Design

**Date:** 2026-05-24
**Project:** LocalPulse
**Status:** Approved (design), pending implementation plan

## Problem

LocalPulse today is a Solan-seeded community crisis app. We want to add a worldwide,
location-triggered Earth-observation intelligence layer: open the portal anywhere on
Earth, it auto-locates the user, pulls 15+ satellite datasets that cover each other's
blind spots, decodes and cross-validates them, and produces a specialized,
plain-language crisis inference that an ordinary person would otherwise never assemble.

This stays in the crisis-management domain. It is satellite-grounded and global, not
hyper-local.

## Who uses this, when, why

A person anywhere in the world, the moment a hazard might affect them (fire season,
monsoon, after a quake, smoke in the air), opens the portal and instantly sees a
trustworthy, cross-validated read of their actual situation: is there active fire near
me, is the air dangerous, is flooding likely, is the ground shaking nearby. They get an
expert-grade fused answer for free, with no jargon and no account.

## Honesty principle

We are not inventing secret or proprietary data. Every source is open. The value, and
the part "not available to the general public" in practice, is that this data is
fragmented across dozens of portals, encoded in raster/scientific formats, and
effectively unusable by a normal person. We fuse it, cross-validate it across sensors,
and translate it into a single decision. We democratize access; we do not overclaim
novelty.

## Decisions locked during brainstorming

1. **Domain:** specialized crisis management, satellite-grounded, worldwide (not hyper-local).
2. **Satellite access:** full 15+ satellites from day one. User registers free NASA
   Earthdata + Copernicus Data Space accounts and supplies tokens via `.env`. We use
   each provider's point/area **statistical APIs and pre-rendered products**, not raw
   granule decoding (infeasible on 512Mi scale-to-zero Cloud Run at zero budget).
3. **Location capture:** instant coarse on load (IP / Cloudflare edge header, no prompt,
   inference shown immediately), then an opt-in "Sharpen to my exact location" control
   that triggers the browser geolocation prompt to refine.
4. **Scope vs existing app:** globalize the intelligence layer (drop Solan hardcoding so
   satellite/hazard/DSS work anywhere). Community features (reports, aid, missing,
   vulnerable, push) stay but become scoped to the user's detected location instead of
   fixed to Solan. One app, now worldwide. Maximum reuse.

## Architecture

**Chosen approach:** Adapter + Fusion layer extending the existing service pipeline,
fronted by a Cloudflare cache on the new endpoint.

Rejected alternatives:
- **Edge-first fusion in a Cloudflare Worker:** free Worker CPU budget cannot run 15
  OAuth'd feeds, and placing Earthdata/Copernicus secrets at the edge weakens the token
  model. We still capture the edge win by caching `/api/eo` responses at Cloudflare by
  coarse cell, without moving the logic.
- **Precompute global tiles via scheduled job:** global precompute storage and compute
  are nowhere near zero budget, and it contradicts the "fetch for that location when the
  user opens it" intent.

### The 15+ satellite spread (organized for gap coverage)

The headline is cross-sensor corroboration: when one sensor is blind, another sees.

| Hazard axis | Satellites / instruments | Gap it fills |
|---|---|---|
| Active fire / thermal | FIRMS: VIIRS S-NPP, VIIRS NOAA-20, VIIRS NOAA-21, MODIS Terra, MODIS Aqua | 5 platforms, staggered overpasses minimise temporal gap; VIIRS 375m detail + MODIS long record |
| Smoke / air / atmosphere | Sentinel-5P TROPOMI (NO2, CO, SO2, aerosol), Open-Meteo CAMS (assimilates S5P) | CAMS covers hours when S5P has not passed over |
| Flood / surface water | Sentinel-1 SAR, Open-Meteo GloFAS discharge, GPM IMERG precipitation | SAR sees through cloud and at night where optical is blind |
| Burn scar / vegetation / drought | Sentinel-2 (NBR, NDVI), MODIS NDVI/LST (GIBS), NASA POWER soil/solar | Optical detail + MODIS daily cadence + reanalysis when both cloud-blocked |
| Storms / clouds (geostationary) | GOES / Himawari / Meteosat imagery via NASA GIBS | High temporal cadence where polar-orbiters give spatial detail |
| Night lights / power outage | VIIRS Day-Night Band (Black Marble, GIBS) | Detects post-disaster blackouts nothing else sees |

Real-world event layer (existing, made global): USGS earthquakes, GDACS, NASA EONET.
NDMA Sachet retained but conditional on India region.

This exceeds 15 distinct satellite platforms, with each hazard axis having a fallback
sensor.

### Data flow

```
Browser opens
  -> edge geolocation (Cloudflare header, instant, coarse, no prompt)
  -> GET /api/eo?lat&lng&precise=0
  -> [Cloudflare cache by ~0.1 deg cell] on miss -> origin
  -> fusion.js: run 15+ adapters in parallel (per-adapter timeout 6-10s, degrade to null)
  -> normalize each result to Signal{axis, magnitude, confidence, freshness, sensor, distanceKm}
  -> cross-validate: agreement boosts confidence; a blind sensor is flagged "covered by <other>"
  -> dss.assess() consumes satellite signals alongside existing incidents/hazards
  -> EOAssessment{ level, headline, perHazard[], sensorsUsed, gapsCovered, generatedAt }
  -> render immediately
User taps "Sharpen to exact location"
  -> browser geolocation prompt -> re-query with precise=1
```

### Components (each small, single-purpose, independently testable)

- `services/eo/adapters/*.js`: one file per source, uniform `query(lat, lng)` returning
  `Signal[]`. Adding a satellite means adding one file.
- `services/eo/fusion.js`: parallel orchestration, cross-validation, gap-coverage logic.
- `services/eo/cache.js`: per-cell, per-source TTL cache (in-memory plus optional
  Firestore). The rate-limit and latency shield.
- `services/geolocate.js`: edge-header coarse resolve plus reverse geocode (free
  Nominatim or BigDataCloud) for worldwide place names.
- `data/incidents.js`: `BASE` becomes a per-request parameter, not a constant. Region
  keyword filters (currently Himachal) become derived from the resolved location.
- `GET /api/eo`: new route. DSS and `/api/sync` extended to include the satellite layer.
- Frontend: first-load coarse inference plus a "sharpen" control, and a new "Satellite
  Intelligence" panel with per-hazard cards showing sensor provenance and confidence.

### Signal and assessment shapes

```
Signal {
  axis: 'fire'|'air'|'flood'|'vegetation'|'storm'|'power'|'seismic',
  magnitude: number,        // normalized 0..1 severity contribution
  confidence: 0..1,         // raised when multiple sensors agree
  freshness: epoch ms,      // when the underlying observation was made
  sensor: string,           // e.g. 'VIIRS NOAA-20'
  distanceKm: number,       // proximity of the observation to the point
  detail: object            // raw normalized values for responder view
}

EOAssessment {
  level: 'ok'|'elevated'|'high'|'severe',
  headline: { [lang]: string },
  perHazard: [{ axis, level, confidence, sensorsUsed[], gapNote, text }],
  sensorsUsed: string[],
  gapsCovered: string[],    // human-readable coverage notes
  generatedAt: epoch ms
}
```

### Caching and rate-limit strategy

Per-cell caching: round location to roughly 0.1 degree and cache per source with a
per-source TTL (active fire ~10 min, weather/air ~1 h, NDVI/burn-scar ~1 day). This keeps
latency low and stays inside every free quota. Cloudflare caches the assembled `/api/eo`
response by the same coarse cell for edge acceleration without moving logic to the edge.

### Error handling and resilience

Any adapter can fail (rate limit, token expiry, no overpass, cloud cover) and the engine
must still produce an answer. Each adapter degrades to `null`. Fusion reports on what it
did receive plus an explicit coverage line (for example, "4 of 6 fire sensors reporting;
optical cloud-blocked, SAR confirms"). Token-gated adapters (Sentinel) silently skip when
no token is present, so the app works before registration and gets richer after. Per-cell
caching protects every free quota. If even the cached path is slow on cold start, the
fallback is to render the existing DSS instantly and stream satellite cards in as adapters
return, over the existing SSE channel.

### Security

Earthdata and Copernicus tokens live server-side in `.env`, never at the edge or in the
client. Existing security posture (headers, validation, structured logging) applies to
the new route. Reverse-geocode and coarse location follow the existing ~1 km coarsening
convention for any stored coordinates. New external calls are timeout-bounded and degrade
gracefully, matching `hazards.js`.

## Testing

Test pyramid, filling the "no tests" gap the codebase exploration flagged:
- Adapters tested against recorded fixture responses (no live network in unit tests).
- Fusion tested with synthetic Signal sets for the agreement and gap-coverage logic.
- One integration test for the `/api/eo` response shape.

## Out of scope

- Raw granule (GeoTIFF/NetCDF) pixel decoding.
- Global precompute / tiling.
- Moving fusion logic into Cloudflare Workers.
- Replacing or retiring existing community features.

## Dependencies the user must provide

- Free NASA Earthdata account + token.
- Free Copernicus Data Space (Sentinel Hub) account + OAuth client credentials.
- Tokens added to `.env`; `.env.example` updated with dummy values.
Claude cannot create these accounts; the app must run (with the keyless ~10-12 satellite
core) before they are provided and unlock the full spread once they are.

## Risks

- **Cold-start latency** with many OAuth'd feeds. Mitigated by per-cell cache, CF edge
  cache, instant-coarse-then-sharpen flow, and SSE streaming fallback.
- **Free quota exhaustion** under traffic. Mitigated by per-cell caching and coarse-cell
  edge caching.
- **Token expiry / provider downtime.** Mitigated by graceful per-adapter degradation and
  explicit coverage reporting.
