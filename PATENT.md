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

## 6. Advantages
Trustworthy (agentic verification + corroboration), genuine (spatiotemporal honesty, no over-alerting), proactive (nowcast, early-warning, scoped push), participatory (mutual aid), and economically deployable in low-resource regions (free feeds, capped AI, offline).
