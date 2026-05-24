# LocalPulse — Patentability Brief & Draft Claims

> Working document for a provisional patent filing. Prepared 2026-05-24. Not legal advice; for attorney review.

**Title (working):** *Method and system for a spatially-scoped, temporally-decayed community decision-support platform that fuses heterogeneous free data feeds with agentic web-search verification of citizen reports.*

**Inventor:** Anshuman Mohanty (GF202217744), B.Tech CSE (Cloud Computing), Shoolini University.
**Live reduction to practice:** https://localpulse.dmj.one (source: github.com/divyamohan1993/localpulse).

---

## 1. Field
Community-scale crisis/civic decision support for resource-constrained towns: ingesting heterogeneous public data, verifying citizen reports, computing location- and time-aware risk, and dispatching scoped alerts — on free infrastructure, multilingual, offline-capable.

## 2. Prior art reviewed (and why it differs)
| Prior art | What it does | Key limitation vs. LocalPulse |
|---|---|---|
| **US10629053** — Automatic detection & alert from social media | Monitors social posts, sentiment/panic analysis, groups by location, fires alert on threshold | Single-modality (social text); sentiment-threshold alerting is **prone to over-alerting**; no agentic verification, no multi-feed fusion, no temporal decay |
| **US20160371968** — Incident reporting w/ trustworthiness | Severity + **reporter-reputation** score; requests **peer corroboration** when trust low; false-report detection | Trust derives from *reporter profile + other users*, **not** an autonomous agent doing **live external web search** against authoritative sources |
| **US9438619 / US9747640** — Crowdsourced trustworthiness indicators | Entity trust scores from crowdsourced attributes | Generic reputation; not crisis-specific, no hazard fusion, no spatial risk |
| **US20230091292** — Validating crowdsourced field reports | User-credibility model with **age-decay of submissions** | Decay applied to *user credibility*; LocalPulse decays the **risk contribution of events themselves** (spatiotemporal), a different mechanism and purpose |
| Research (BERT/LLM disaster tweet classifiers) | Classify disaster text | Academic classifiers; no end-to-end DSS, verification loop, scoped alerting, or mutual-aid |
| **US7629891** — Personal safety check-in & follow-up | Check-in timer; auto-generates a missing-person report after ~30h of no check-in | A *timer* on one user; LocalPulse **matches missing-person posts against community "I'm safe" beacons** for reunification |
| NLM **People Locator** / face-matching research | Photo + metadata missing-person registry | Standalone registry; not integrated with a live DSS, safe-beacon matching, or multilingual community feed |
| Utility **Priority Service Registers**; ArcGIS evacuation-priority studies | Opt-in lists of vulnerable people for utilities/GIS planning | Static utility/planning lists; LocalPulse keeps a **privacy-coarsened, live registry surfaced to responders during an event, scoped to the active hazard** |
| Social-media **syndromic surveillance** research (CLI clusters) | Detect symptom spikes from social posts | Academic, single-signal; LocalPulse fuses it into the DSS as a **post-disaster outbreak early-warning** alongside verified incidents |

**Conclusion:** No reviewed art combines (a) agentic LLM **web-search** verification of citizen reports, (b) heterogeneous **40+ free-feed fusion** (news + weather + air + flood + seismic + satellite + official CAP), (c) **spatially-scoped + temporally-decayed** risk that is explicitly *anti-over-alerting*, and (d) **locality-scoped** notification + **demand–supply mutual-aid matching** + **RAG situational assistant**.

## 3. Novel elements (the differentiators, all reduced to practice)
1. **Agentic citizen-report verification** — on submission, an autonomous LLM agent performs a live web search and returns *corroborated / unverified / contradicted* with confidence; contradicted/low-trust reports are excluded from risk so misinformation cannot drive alerts.
2. **Heterogeneous multi-feed fusion with corroboration-weighted trust** — 40+ independent free feeds; an event's trust rises with the number of *independent* feeds reporting it (corroboration velocity); authoritative outlets weighted.
3. **Spatially-scoped risk separation** — area-wide hazards (weather, official CAP, large quakes) are distinguished from point incidents; per-user radius computation; a localized event never reads as town-wide risk.
4. **Temporal decay of event influence** — a one-time event's contribution to *current* risk halves on a configurable half-life and drops out of "act-now" guidance when stale, eliminating residual fear-mongering.
5. **Cross-source burst early-warning** — a fresh event corroborated by multiple independent feeds is surfaced as *emerging* before any single official confirmation.
6. **Locality-scoped push** — alerts dispatched only to subscribers within a radius of a localized verified event; whole-community push reserved for genuine area-wide escalation.
7. **Predictive nowcast** — forward 24–48h hazard guidance from forecast precipitation on terrain + river-discharge trend, presented as advisory and **not** added to current risk.
8. **Mutual-aid demand–supply matching** — auto-matches resident *needs* to nearest *offers* by resource category and proximity; plus an "I'm safe" beacon.
9. **RAG situational assistant** — free-form multilingual Q&A answered strictly from the live fused situational context.
10. **Resource-constrained operability** — multilingual (5 languages), offline PWA, free data + capped LLM, scale-to-zero — designed for low-end devices and poor connectivity.
11. **Vulnerable-person priority registry (no-one-left-behind)** — privacy-coarsened, opt-in registry of residents needing assisted evacuation, surfaced to responders **as live aggregate clusters during an active hazard**, integrated with the spatiotemporal risk — not a static utility list.
12. **Post-disaster syndromic early-warning** — detects clusters of symptom mentions across the fused community + news stream and raises a hedged public-health/water-safety signal, integrated into the same DSS and corroboration loop.
13. **Missing-persons reunification by safe-beacon matching** — missing-person posts are matched against community "I'm safe" check-ins (and reports) to reunite families, rather than a check-in timer or standalone photo registry.
14. **Inclusive accessibility** — one-tap spoken status (TTS) in five languages and a large-text mode, so low-literacy, elderly and low-vision residents are served first-class.

15. **Bandwidth-efficient versioned delta-sync** — a monotonic state version drives a conditional protocol that returns a ~25-byte "unchanged" response (or HTTP 304) when state has not changed, collapses five requests into one, and emits smaller payloads on slow links. *Measured technical effect: tens-of-KB → 23 bytes when unchanged.*
16. **Connection-adaptive degradation** — the client measures the effective connection (and data-saver) and requests a reduced payload, so low-end devices on 2G remain usable.
17. **Tamper-evident state integrity** — the persisted situational snapshot is HMAC-signed and rejected on load if altered, so a compromised store cannot feed false crisis data (security technical effect).

**Combined-system novelty:** the patent rests on the *integration* — a single platform that fuses 40+ heterogeneous free feeds, verifies citizen input with an autonomous web-searching agent, computes spatiotemporally-honest risk, and closes the loop with locality-scoped alerting, mutual-aid matching, a vulnerable-person registry, outbreak early-warning and missing-person reunification, operable offline and multilingually on free infrastructure. No single prior reference teaches this combination.

## 4. Draft independent claim (apparatus)
> A system for community decision support comprising one or more processors configured to:
> (a) ingest, from a plurality of independent public data feeds of heterogeneous modality including news, meteorological, air-quality, hydrological, seismic, satellite-event, and official common-alerting-protocol feeds, a plurality of data items;
> (b) apply a language model to classify each item into a hazard category and severity, derive a geolocation, and produce multilingual representations;
> (c) cluster items reported by multiple independent feeds and assign a trust score that increases with the number of independent corroborating feeds;
> (d) receive a citizen report and invoke an autonomous agent that performs a live external web search and returns a verification verdict, excluding non-corroborated reports from a risk computation;
> (e) compute a risk assessment that (i) separates area-wide hazards from localized incidents using a per-recipient geographic radius and (ii) applies a temporal-decay function to the contribution of each event such that the influence of a one-time event diminishes over time; and
> (f) dispatch a notification to a subscriber conditioned on the subscriber's location being within a radius of a localized verified event, or on an area-wide escalation.

**Representative dependent claims:** corroboration-velocity "emerging" flag (5); predictive nowcast advisory excluded from current risk (7); demand–supply matching by category and proximity (8); RAG assistant grounded solely in fused context (9); a privacy-coarsened vulnerable-person registry surfaced as live aggregate clusters scoped to an active hazard (11); syndromic-cluster outbreak early-warning over the fused stream (12); missing-person reunification by matching against community safe-beacons (13); spoken multilingual status output and large-text accessibility mode (14); operation on free-tier serverless infrastructure with a capped language-model budget and snapshot-on-coldstart (cost mechanism).

## 5. Method claim (summary)
A computer-implemented method performing steps (a)–(f) above, wherein the temporal-decay function halves an event's risk contribution every configurable interval and removes events older than a staleness threshold from action guidance; and wherein verification (d) is gated by a per-period budget.

## 6. Patentability assessment (the four traits + India §3(k))
- **Utility:** real-world use — keeps a town informed and coordinated in a crisis; reduces misinformation, over-alerting and response time. Reduced to practice and operating live.
- **Novelty:** no single prior reference discloses the integrated system of §3; the specific mechanisms (agentic web-search verification of citizen reports, spatiotemporal anti-over-alerting, corroboration-velocity early-warning, delta-sync over fused situational state) are not found in the art reviewed.
- **Non-obviousness (synergy, per *KSR*):** the elements are not merely aggregated — they **interact**: verification + multi-source corroboration + temporal decay jointly suppress false/stale alarms; the versioned fusion engine is what *makes* the delta-sync tiny; locality-scoping connects the spatial risk model to notification. The combined behaviour (trustworthy, non-alarmist, low-bandwidth crisis DSS) is an unexpected result over a naive mash-up, which would either over-alert or be bandwidth-heavy.
- **Patentable subject matter / India §3(k):** the claims are anchored to **technical effects** beyond "a computer programme per se" — *better network communication* (delta-sync, 304/unchanged, adaptive payloads), *improved device operation on constrained networks* (offline-first, lite mode), and *improved security* (HMAC-tamper-evident state). Per the 2017 CRI Guidelines, a CRI delivering such technical contribution falls outside the §3(k) exclusion. (For US: these are concrete improvements / "significantly more" than an abstract idea under *Alice*.)

**Note on combining prior art:** combining known building blocks is permissible; patentability turns on a non-obvious, synergistic combination producing an unexpected technical result — which is the basis claimed here, not mere collocation.

## 7. Advantages
Trustworthy (agentic verification + corroboration), genuine (spatiotemporal honesty, no over-alerting), proactive (nowcast, early-warning, scoped push), participatory (mutual aid), and economically deployable in low-resource regions (free feeds, capped AI, offline).

---

# Part B — Earth-Observation Fusion & Frontier Differentiators (Phase 5)

> Added 2026-05-24 after building the worldwide satellite-fusion + prediction engine. This part is deliberately more conservative about novelty than Part A: the core idea of multi-source hazard fusion is NOT novel. Patentability here rests only on the specific technical-effect mechanisms of §B3 and their combination.

## B1. Honest prior art (the strong references Part A omitted)
- **PDC DisasterAWARE** (Pacific Disaster Center, NASA-partnered): near-real-time, AI-enhanced multi-hazard early warning + risk analytics across ~28 hazard types, global. This is direct, strong prior art for "fuse many sources, assess per-location hazard, alert." Any claim must distinguish over it.
- **Google FloodHub / Flood Forecasting API**: free, global, AI riverine flood forecasts, public API (CC BY 4.0). Direct prior art for per-location flood prediction.
- **ESA Copernicus EO4Multihazards** (2023–): satellite EO for cascading/compound multi-hazard analysis — prior art for compound-hazard work.
- Extensive academic literature on multi-sensor EO fusion (optical+SAR+lidar, Bayesian/JS-divergence fusion), conformal prediction in EO, and physics-informed NNs for wildfire/flood.

**Consequence:** generic "satellite fusion + prediction" is unpatentable here. We do NOT claim it.

## B2. What is NOT claimed
The act of fusing free EO feeds, computing a per-location risk, or forecasting a hazard. These are taught by PDC/FloodHub/EO4Multihazards.

## B3. Claimed technical-effect mechanisms (each a concrete, non-abstract effect)
1. **Cross-sensor divergence gating (anti-spoof + blindspot).** Jensen-Shannon divergence between independent sensors on a hazard axis classifies the axis as consensus / blindspot (one sensor sees a hazard the others miss) / suspect (an implausible outlier feed). Suspect feeds are down-weighted; blindspots raise an early-warning. *Technical effect:* robustness and integrity of the fused output against sensor failure and feed spoofing — not mere aggregation.
2. **Cryptographically verifiable, offline-checkable provenance.** Each prediction carries a tamper-evident receipt binding a canonical hash of the exact sensor inputs + model version + timestamp, HMAC-signed; the recipient device re-verifies with constant-time comparison and rejects altered or stale receipts, with no network. *Technical effect:* improved security/integrity and auditability of an automated decision output (squarely eligible under India §3(k) CRI guidelines and US *Alice* "significantly more").
3. **On-device, connectivity-independent recomputation.** The confidence-weighted roll-up and divergence are recomputed in-browser from the last cached per-sensor signals, and the provenance receipt re-verified locally, so the device yields a trustworthy hazard level with zero connectivity. *Technical effect:* improved operation of the device under intermittent/no network.
4. **Physics-constrained propagation bounding the forecast.** Interpretable physical models (Rothermel-style fire rate-of-spread from satellite-derived dryness + wind + terrain slope; rainfall-runoff onset from rain intensity + terrain) constrain the prediction's reach/ETA. *Technical effect:* a specific computational method improving forecast accuracy, not an abstract score.
5. **Distribution-free calibrated uncertainty.** Split-conformal intervals derived from a rolling log of (prediction, observed-outcome) nonconformity scores attach a guaranteed marginal-coverage interval to each forecast once calibrated, and explicitly report `calibrated:false` before sufficient data. *Technical effect:* a measurable statistical calibration property of the output.

## B4. Patentable synthesis (claim spine, Phase 5)
> A connectivity-resilient method for producing hazard nowcasts from a fusion of heterogeneous Earth-observation feeds, comprising: bounding each forecast by an interpretable physical propagation model parameterised by satellite-derived inputs; computing a cross-sensor divergence per hazard axis to gate per-feed trust and to raise a blindspot early-warning; attaching a split-conformal distribution-free coverage interval from accrued nonconformity scores; emitting a tamper-evident provenance receipt that binds the sensor inputs and is verifiable offline by the recipient device; and recomputing the headline assessment on-device from cached signals under loss of connectivity.

The combination yields multiple interacting technical effects (accuracy, calibration guarantee, integrity/security, offline device operability) that none of PDC DisasterAWARE, Google FloodHub, or EO4Multihazards teaches together — the *KSR* synergy basis, mirroring Part A.

## B5. Honest patentability assessment (Phase 5)
- **Subject matter:** mechanisms 2 and 3 (security + device operability) are the safest under India §3(k) and *Alice*; 1, 4, 5 are stronger on novelty but each is individually at obviousness risk given the cited art. The defensible filing is the *combination*, anchored on the security/offline technical effects.
- **Recommendation:** a single provisional covering Parts A+B is reasonable and cheap; expect the examiner to cite PDC/FloodHub; do not rely on the bare fusion/prediction claims. Treat copyright (code), defensive publication (public repo + live site), and the working product as the primary IP value.
- *Not legal advice; for registered patent-agent review.*
