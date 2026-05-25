# Patent Drawings (renderable Mermaid; convert to formal figures for filing)

These correspond to the "Brief Description of the Drawings" in the specification. Each
renders on GitHub. FIG. 3 syntax validated via Mermaid; all follow the same grammar.

## FIG. 1 — System architecture
```mermaid
flowchart LR
  subgraph Sources[Heterogeneous EO sources]
    F[FIRMS multi-satellite fire]
    A[CAMS / Sentinel-5P aerosol-NO2-SO2-CO]
    S[Sentinel-1 SAR / Sentinel-2 / Sentinel-3]
    W[Open-Meteo / GloFAS / NASA POWER]
    U[USGS seismic]
  end
  Sources --> AD[Adapter layer: query lat,lng -> Signal]
  AD --> FU[Fusion engine + divergence gating]
  FU --> PR[Prediction engine: physics-bound + conformal]
  FU --> PV[Provenance signer ECDSA P-256]
  PR --> PV
  PV --> API[/api/eo response + receipt/]
  PV --> PK[/api/eo/pubkey public key/]
  API --> DEV[Recipient device]
  PK --> DEV
  DEV --> OFF[On-device recompute + offline WebCrypto verify]
```

## FIG. 3 — Divergence-gating (validated)
```mermaid
flowchart TD
  A[Signals for one hazard axis] --> B{>= 2 independent sensors?}
  B -- no --> S[Single-sensor read]
  B -- yes --> C[Compute pairwise Jensen-Shannon divergence]
  C --> D{divergence >= threshold?}
  D -- no --> E[consensus: level from agreed magnitude]
  D -- yes --> F{deviation skewed high or low?}
  F -- lone HIGH --> G[blindspot: cap solo influence to <= 0.6 AND raise early-warning]
  F -- lone LOW --> H[suspect: drop outlier feed, level from corroborating sensors]
  G --> I[per-hazard summary + flag]
  H --> I
  E --> I
```

## FIG. 4 — Offline-verifiable provenance (sequence)
```mermaid
sequenceDiagram
  participant Sv as Server
  participant Dv as Recipient device
  Sv->>Sv: canonical encoding of assessment + forecast
  Sv->>Sv: ECDSA P-256 sign (IEEE-P1363) -> receipt {alg,model,ts,sig}
  Sv-->>Dv: assessment + forecast + receipt
  Sv-->>Dv: public key (JWK) [cached]
  Note over Dv: later / offline
  Dv->>Dv: recompute canonical encoding
  Dv->>Dv: WebCrypto verify(sig, publicKey) + ttl check
  Dv->>Dv: render verified / unverified / stale state
```

## FIG. 5 — On-device offline recomputation
```mermaid
flowchart TD
  A[Network fetch of /api/eo] -->|success| B[cache signals + receipt + public key]
  A -->|failure / offline| C[load cached signals]
  C --> D[confidence-weighted level recompute]
  D --> E[re-verify cached receipt with cached public key]
  E --> F[render headline + data-age + verification state]
  B --> F
```

## FIG. 6 — Conformal calibration loop
```mermaid
flowchart TD
  A[Forecast for cell + hazard] --> B[record predicted magnitude]
  B --> C[(durable score store)]
  D[Later observed magnitude for cell + hazard] --> E[nonconformity score = abs diff]
  E --> C
  C --> F{count >= min calibration?}
  F -- no --> G[emit uncalibrated indication]
  F -- yes --> H[split-conformal 1-alpha quantile -> coverage interval]
  H --> I[attach interval to forecast]
  G --> I
```

## FIG. 7 — Physics-constrained propagation
```mermaid
flowchart LR
  A[Satellite-derived dryness] --> R[Rothermel rate-of-spread]
  W[Wind speed/direction] --> R
  T[Terrain slope from elevation ring] --> R
  R --> O1[fire reach + ETA bound]
  P[Rainfall intensity] --> RR[Rainfall-runoff onset]
  T --> RR
  RR --> O2[flood onset factor + ETA shift]
```
