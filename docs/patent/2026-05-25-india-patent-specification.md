# Patent Specification (Draft for India) — LocalPulse Earth-Observation Fusion

> **Status:** Filing-ready draft for review by a registered Indian Patent Agent before submission to the Indian Patent Office (IPO). Prepared 2026-05-25. Not legal advice. Anchored to the Patents Act, 1970 (as amended), the Patents Rules, and the Draft CRI Guidelines, 2025 (technical-effect test per *Ferid Allani v. Union of India*, 2019; *Microsoft v. Asst. Controller*, 2023).
>
> **Inventor / Applicant:** Anshuman Mohanty (GF202217744), B.Tech CSE (Cloud Computing), Shoolini University. **Reduced to practice:** https://localpulse.dmj.one · source github.com/divyamohan1993/localpulse.
> **Recommended track:** Provisional first (₹1,750 e-filing for a natural person/startup; Form 1 + Form 2 + Form 3 + Form 5; Form 28 for startup/small-entity fee), then complete within 12 months. Request **expedited examination (Rule 24C)** as an eligible startup/natural person.

---

## 1. Title of the Invention
**A connectivity-resilient system and method for generating cryptographically-verifiable, calibration-bounded multi-hazard nowcasts from divergence-gated fusion of heterogeneous Earth-observation feeds.**

## 2. Field of the Invention
The invention relates to disaster early-warning and decision-support systems, and more particularly to a computer-implemented system that fuses heterogeneous public Earth-observation data streams to produce, for an arbitrary geographic location, a trustworthy and forward-looking multi-hazard assessment whose integrity is verifiable on the recipient device without network connectivity.

## 3. Background and Prior Art

Multi-source hazard monitoring is established. The following are the closest references; each lacks the specific technical mechanisms claimed herein.

| Reference | Discloses | Does NOT disclose (distinction) |
|---|---|---|
| **US 11,200,788 B1** (forecasting/assessing hazard-resultant effects: flood, wildfire) | Property-resolution hazard layers + statistical interpolation of depth-vs-probability; loss estimates | No cross-sensor divergence gating; no cryptographically-verifiable, offline-checkable provenance of the output; no on-device recomputation under no connectivity; no distribution-free conformal interval; no physics-constrained propagation |
| **WO 2014/078079 A2** (wildfire risk from satellite imagery + foliage density) | Grid-overlay foliage density risk per property | Single-modality optical; no multi-sensor fusion, divergence, verifiable provenance, calibration, or offline operation |
| **US 11,128,473** (assuring authenticity of electronic sensor data; cryptoprocessor signs at the sensor) | Signing raw sensor data near the sensor for integrity | Signs a single raw sensor stream, not a fused multi-hazard inference; no client-side offline verification of a derived decision; no divergence/calibration |
| **US 10,007,811 B2 / US 9,576,133 B2** (anti-tamper / tamper detection of encrypted data) | Generic tamper detection / hash chains | Not applied to a portable, offline-verifiable provenance receipt bound to a fused hazard prediction |
| **PDC DisasterAWARE** (product) | Near-real-time AI multi-hazard early warning across ~28 hazard types | Proprietary/enterprise; no published cross-sensor divergence anti-spoof gating, no offline-verifiable provenance receipt, no on-device recompute, no distribution-free calibrated interval |
| **Google FloodHub** (product) | Free global AI riverine flood forecast + API | Single hazard family; no integrity provenance, divergence gating, on-device verification, or physics-bounded multi-hazard nowcast |
| **ESA EO4Multihazards** (research) | Cascading/compound multi-hazard science from Sentinel EO | Research, not a connectivity-resilient verifiable decision system; lacks the claimed integrity/offline/calibration mechanisms |
| **IN 202141037092** (Indian application; hierarchical landslide early-warning) | Multi-level warnings from an in-ground "deep earth probe" sensor column measuring rainfall, soil moisture, ground movement | A physical in-situ sensor network for one hazard (landslide); no satellite/heterogeneous EO fusion, no cross-sensor divergence gating, no offline-verifiable provenance receipt, no on-device recompute, no conformal interval |
| **US 2016/0275461 A1 / WO2016154001A1** (device-integrity attestation via blockchain) | Attesting a device's boot/execution integrity | Attests the *device*, not the integrity/authenticity of a *derived hazard decision* carried to and verified by an arbitrary recipient offline |
| **US 11,930,061 B2 / US 2023/0385164 A1** (edge-device disaster-recovery mode) | Edge device falls back to locally stored broadcast data when offline | Serves cached *content*; does not recompute a fused hazard assessment on-device nor cryptographically verify a prediction's provenance offline |

**Technical problems left unsolved by the art:**
1. A fused automated hazard decision can be silently corrupted (compromised store, spoofed/degraded feed, man-in-the-middle) and the recipient has no way to detect it, especially offline.
2. A single blind or spoofed sensor can dominate or suppress a fused result; the art weights agreement but does not treat sensor *disagreement* as an actionable integrity and early-warning signal.
3. Forecast outputs lack a statistically guaranteed error bound and lack physical bounding, reducing trust and accuracy.
4. In low-connectivity disaster conditions the device cannot recompute or trust the last assessment without the server.

## 4. Object and Summary
The invention solves the above **technical problems through technical means**, achieving specific **technical effects** (data-integrity, security, improved device operation under network loss, measurable statistical calibration, and physically-bounded accuracy) that are beyond mere incidental effects, and therefore constitutes patentable subject matter under the CRI Guidelines, 2025.

Core technical means (all reduced to practice in the cited source):
- **(M1) Divergence-gated fusion:** for each hazard axis, a Jensen–Shannon divergence between independent sensors classifies the axis as consensus / blindspot / suspect; a suspect outlier feed's contribution is attenuated and a blindspot raises an early-warning.
- **(M2) Asymmetrically-signed, offline-verifiable provenance:** the fused assessment and forecasts are bound by a deterministic canonical encoding and signed with an ECDSA P-256 private key; a receipt (algorithm, model id, timestamp, signature in IEEE-P1363 form) travels with the output; any recipient device verifies it with only the public key, using the device's native cryptographic API, **without network and without any shared secret**, and rejects altered or stale outputs.
- **(M3) On-device, connectivity-independent recomputation:** the recipient device recomputes the confidence-weighted headline assessment from the last cached per-sensor signals and re-verifies the provenance receipt locally, remaining functional and trustworthy with zero connectivity.
- **(M4) Split-conformal calibration:** a rolling, durably-persisted log of (prediction, later-observed-outcome) nonconformity scores yields a distribution-free interval with guaranteed marginal coverage attached to each forecast, and explicitly signals an uncalibrated state until sufficient data accrues.
- **(M5) Physics-constrained propagation:** interpretable physical models (a Rothermel-type fire rate-of-spread parameterised by satellite-derived dryness, wind and terrain slope; a rainfall-runoff onset factor on terrain) bound the reach and time-to-onset of the forecast.

## 4A. Brief Description of the Drawings
(Figures to be rendered by the agent from these specifications; flowcharts are accepted for CRIs.)
- **FIG. 1** — System architecture: recipient device, network interface, the plurality of EO source adapters, the fusion engine (with divergence module), the prediction engine (with physics + conformal modules), the provenance signer, and the public-key distribution path.
- **FIG. 2** — Signal data structure and the uniform adapter contract (axis, magnitude, confidence, freshness, sensor, proximity).
- **FIG. 3** — Divergence-gating flowchart: per-axis pairwise divergence → threshold test → consensus / blindspot (early-warning) / suspect (attenuate outlier) branches.
- **FIG. 4** — Provenance sequence diagram: canonical encoding → ECDSA-P256 sign (IEEE-P1363) → receipt {alg, model, ts, sig} transmitted with output → recipient imports public key (JWK) → WebCrypto verify → valid/stale decision, all offline.
- **FIG. 5** — On-device offline recomputation flowchart: connectivity loss → load cached signals → confidence-weighted level recompute → re-verify receipt with cached public key → render with data-age + verification state.
- **FIG. 6** — Conformal calibration loop: log prediction for cell/hazard → later observe outcome → nonconformity score → durable store → split-conformal (1−α) quantile → coverage interval (or uncalibrated indication).
- **FIG. 7** — Physics-constrained propagation: satellite-derived dryness/wind + terrain slope from elevation ring → fire rate-of-spread / rainfall-runoff onset → bounded reach + ETA.

## 5. Detailed Description (mapping to the working implementation)
- Heterogeneous feeds are ingested by adapters exposing a uniform `query(lat,lng) → Signal[]` contract (`services/eo/adapters/*`), each `Signal` carrying axis, normalised magnitude, confidence, freshness, sensor identity and proximity (`services/eo/signal.js`); failures degrade independently.
- A fusion engine (`services/eo/fusion.js`) groups signals per axis, applies a confidence-weighted roll-up, and invokes M1 (`services/eo/divergence.js`).
- A prediction engine (`services/eo/predict.js`) computes near-term forecasts from forecast feeds, applies M5 (`services/eo/physics.js`, terrain from a keyless elevation service) and M4 (`services/eo/conformal.js` + durable `services/eo/predlog.js`).
- An endpoint assembles the assessment + predictions and applies M2 (`services/eo/provenance.js`), exposing the verification public key at `/api/eo/pubkey`.
- The recipient web client (`public/js/eo-offline.js`) performs M3 and M2-verification using the device WebCrypto API; the canonical encoding is byte-identical to the server (validated by a cross-stack test).
- A per-cell, time-to-live cache shields free data quotas and bounds latency.

## 6. Claims (draft)

**Independent Claim 1 (system).**
A data-processing system for connectivity-resilient multi-hazard assessment, comprising one or more processors, a memory, and a network interface, configured to:
(a) obtain, from a plurality of independent Earth-observation data sources of differing sensing modality, a plurality of signals each associated with a hazard axis and a normalised magnitude for a queried geographic location;
(b) for a said hazard axis having signals from at least two independent sources, compute an information-theoretic divergence between the sources' magnitudes and, responsive to the divergence exceeding a threshold, classify the axis as a suspect-feed condition or a sensor-blindspot condition and, respectively, attenuate the contribution of an outlier source to a fused result or generate an early-warning indication, thereby improving the integrity of the fused result against sensor failure or feed spoofing;
(c) generate a hazard assessment and a near-term forecast for the location, the forecast being bounded by an interpretable physical propagation model parameterised by at least a satellite-derived surface-dryness value, a wind value and a terrain-slope value derived from elevation samples about the location;
(d) attach to the forecast a distribution-free coverage interval computed from a stored set of nonconformity scores, each nonconformity score being a magnitude difference between an earlier prediction for a location-cell and a subsequently-observed magnitude for that location-cell;
(e) compute a deterministic canonical encoding of the assessment and forecast and generate a provenance receipt comprising a digital signature over the canonical encoding produced with a private key of an asymmetric key pair; and
(f) transmit the assessment, the forecast, the coverage interval and the provenance receipt to a recipient device, and make available a public key of the asymmetric key pair,
such that the recipient device is enabled to verify the provenance receipt using the public key alone, without a shared secret and without network connectivity, and to recompute the assessment from cached signals upon loss of connectivity.

**Independent Claim 2 (method).** A computer-implemented method comprising steps (a)–(f) of Claim 1.

**Independent Claim 3 (computer-readable medium).** A non-transitory computer-readable medium storing instructions which, when executed by one or more processors, cause performance of the method of Claim 2.

**Dependent claims.**
4. Wherein the divergence of (b) is a Jensen–Shannon divergence computed by treating each source magnitude as a Bernoulli parameter.
5. Wherein attenuating the outlier (b) comprises reducing its weight in a confidence-weighted overall-level computation in which a hazard axis influences the overall level in proportion to the product of its magnitude and a corroboration-raised confidence.
6. Wherein the physical propagation model of (c) comprises a fire rate-of-spread increasing with surface dryness, wind speed and upslope gradient, yielding a spread-reach distance over a time horizon.
7. Wherein the physical propagation model of (c) comprises a rainfall-runoff onset factor increasing with rainfall intensity and terrain slope.
8. Wherein the coverage interval of (d) is the empirical (1−α) quantile of the nonconformity scores per split-conformal prediction, and an uncalibrated indication is emitted until the number of scores exceeds a threshold.
9. Wherein the nonconformity scores are persisted to a durable store and re-loaded on process restart so that calibration is retained across stateless restarts.
10. Wherein the digital signature of (e) is an ECDSA signature over a P-256 curve emitted in IEEE-P1363 form, and the recipient device verifies it using a browser-native subtle-crypto interface.
11. Wherein the canonical encoding (e) is a recursively key-sorted serialisation rendering the signature independent of property ordering, identical at signer and verifier.
12. Wherein the recipient device, upon loss of connectivity, recomputes the overall hazard level from cached per-sensor signals and re-verifies the provenance receipt with a cached said public key, and displays a verification state and a data-age indication.
13. Wherein the provenance receipt includes a timestamp bound by the signature, and the recipient device treats the assessment as stale when a current time exceeds the timestamp by a time-to-live.
14. Wherein the location is obtained without user interaction from an edge geolocation header and is optionally refined to a device-reported precise location.
15. Wherein each said data source is queried through a per-location-cell time-to-live cache that bounds query rate and latency.

## 7. Statement of Technical Effect (for Section 3(k) / CRI 2025)
The claimed invention is not a computer programme or algorithm per se. It provides a technical solution to technical problems (corruptibility of an automated decision; sensor spoofing/blindness; unbounded uncertainty; unavailability under network loss) through technical means (information-theoretic divergence gating; asymmetric cryptographic signing and on-device public-key verification; on-device recomputation; split-conformal interval computation; physics-parameterised propagation), achieving tangible technical effects beyond mere incidental effects, namely: **(i) verifiable data integrity and tamper-evidence of a derived decision; (ii) improved security against feed spoofing and store compromise; (iii) continued, trustworthy operation of the recipient device under loss of network connectivity; (iv) a measurable, guaranteed statistical-coverage property of the output; and (v) physically-bounded forecast accuracy.** Each effect improves the functioning of the system/device and solves a technical problem, satisfying the technical-contribution test affirmed in *Ferid Allani* and the Draft CRI Guidelines, 2025.

## 7A. Claim chart (Claim 1 elements vs. closest prior art — the no-fightback basis)
| Claim 1 element | US 11,200,788 B1 | PDC DisasterAWARE | Google FloodHub | IN 202141037092 | Sensor-signing / device-attestation art |
|---|---|---|---|---|---|
| (b) cross-sensor divergence gating (anti-spoof + blindspot) | absent | not disclosed | absent | absent | absent |
| (c) physics-constrained propagation from satellite-derived inputs | statistical interpolation only | not disclosed | ML model, not interpretable physics bound | absent | absent |
| (d) split-conformal distribution-free coverage interval | absent | not disclosed | absent | absent | absent |
| (e) asymmetric signature over a canonical encoding of the fused decision | absent | absent | absent | absent | signs raw sensor data / attests device, not a fused decision |
| (f) recipient verifies offline with public key alone + recomputes from cache | absent | absent | absent | absent | device attestation ≠ offline verification of a portable decision receipt |

No single reference discloses any one of (b)–(f) as applied to a fused multi-hazard decision, and none discloses their combination. This is the literal-novelty and non-obviousness basis.

## 8. Industrial Applicability and Societal Benefit
The system is industrially applicable as deployable disaster-resilience software operable on free public data and zero-cost serverless infrastructure, usable worldwide on low-end devices and poor networks. Societal benefit: it democratises trustworthy, forward-looking, tamper-evident hazard intelligence for resource-constrained and disaster-prone communities that cannot access proprietary platforms, and remains usable precisely when connectivity fails during a disaster. This addresses a genuine public-safety need and supports the "no one left behind" objective.

## 9. Abstract
A connectivity-resilient system fuses heterogeneous Earth-observation feeds into a per-location multi-hazard assessment and near-term forecast. Cross-sensor information-theoretic divergence gates per-feed trust and raises blindspot/anti-spoof alarms; an interpretable physical propagation model bounds forecast reach and onset; a split-conformal procedure attaches a distribution-free coverage interval; and the assessment is bound by a deterministic canonical encoding and signed with an asymmetric private key so that any recipient device verifies integrity offline with only the public key and recomputes the assessment from cached signals when connectivity is lost. The combination yields verifiable integrity, spoofing resistance, offline device operability, statistical calibration and physically-bounded accuracy.

## 10. Honest patentability assessment and prosecution strategy
- **Strongest, hardest-to-challenge ground:** M2 + M3 (offline-verifiable provenance and on-device operation under network loss) and M1 (divergence-gated integrity). These are concrete security/data-integrity/device-operability effects — the categories Indian and EPO practice most readily accept under the technical-effect test — and none of the cited art discloses them for a fused hazard decision.
- **Novelty/obviousness:** distinguish each independent-claim element against US 11,200,788 B1 (none of M1–M5), the sensor-signing art (single raw stream, no offline verification of a derived decision, no divergence/calibration), and PDC/FloodHub (no published verifiable-provenance/offline/divergence mechanisms). Argue non-obvious synergy (the *KSR*/economic-significance line): the elements interact to make a single low-bandwidth, trustworthy, offline crisis decision, an unexpected combined result over a naive aggregation.
- **Section 3 hygiene:** keep claims framed as a technical system/method with recited hardware and the §7 effects; avoid "business method", "presentation of information" and bare "algorithm" framing; include the medium claim; foreground the offline/security effects in the first independent claim.
- **Candid limitation:** no draft can *guarantee* grant; an examiner may still cite art and require narrowing. Filing the provisional secures priority cheaply; copyright in the code and the public reduction-to-practice provide immediate, fight-free protection regardless of grant.
- **Forms/fees (natural person/startup):** Form 1 (application), Form 2 (provisional/complete spec), Form 3 (foreign filing statement), Form 5 (inventorship, at complete), Form 9 (early publication, optional), Form 18/18A (examination/expedited), Form 28 (small-entity/startup). e-Filing on the IPO portal.
