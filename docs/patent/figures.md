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

## FIG. 8 — Non-repudiable warning-certificate chain
```mermaid
flowchart LR
  G[Genesis hash] --> R1
  subgraph R1[Warning #1]
    C1[canonical: level, sensors, predictions, location] --> S1[ECDSA sign over canon-model-ts-prevHash]
    S1 --> H1[receiptHash = sha256 prevHash + sig]
  end
  R1 --> R2
  subgraph R2[Warning #2]
    C2[canonical #2] --> S2[sign, prevHash = receiptHash #1]
    S2 --> H2[receiptHash #2]
  end
  R2 --> R3[Warning #3 ...]
  H1 -. embedded public key .-> V[Third party verifies any certificate OFFLINE: signature + chain link]
  H2 -. no server, no blockchain .-> V
```

## FIG. 9 — Verifiable evacuation-route clearance (hyper-specialisation)
```mermaid
flowchart TD
  O[Origin / user location] --> D[Pick nearest shelter as destination]
  D --> WP[Sample waypoints along path]
  WP --> FB[One FIRMS bbox query: active fires]
  WP --> WX[Batched multi-point: precipitation + wind]
  WP --> EL[Batched multi-point: elevation]
  FB --> SEG[Classify each segment: fire-proximity, low-lying rain, wind]
  WX --> SEG
  EL --> SEG
  SEG --> V{Worst segment}
  V -->|all clear| GO[GO: safe to proceed]
  V -->|elevated| CA[CAUTION]
  V -->|high/severe| NG[NO-GO: do not take this route]
  GO --> C[Sign + chain -> offline-verifiable Route Clearance Certificate]
  CA --> C
  NG --> C
```
