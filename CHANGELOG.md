# Changelog

All notable changes to LocalPulse are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); grouped by date.

## 2026-05-24 (humanity differentiators)

### Added
- **Vulnerable-person priority registry** (no-one-left-behind): privacy-coarsened,
  anonymous opt-in registry of residents needing assisted evacuation (mobility,
  elderly, infant, medical, oxygen, hearing, vision, pregnant); public API exposes
  only aggregate counts + ~1 km clusters. `/api/vulnerable`.
- **Post-disaster syndromic early-warning** (`services/health.js`): detects
  clusters of symptom mentions (water-borne, vector-borne, respiratory) across the
  fused community + news stream and raises a hedged public-health/water-safety
  signal in the DSS.
- **Missing-persons reunification**: post a missing person; matched against
  community "I'm safe" check-ins to reunite families. `/api/missing`.
- **Inclusive accessibility**: one-tap spoken status (TTS) in five languages and a
  large-text mode for low-literacy, elderly and low-vision residents.
- **PATENT.md** extended with prior art (US7629891, People Locator, Priority
  Service Registers, syndromic-surveillance research) and dependent claims for the
  new differentiators.

## 2026-05-24 (differentiators + patent)

### Added
- **Ask LocalPulse** — conversational RAG assistant (`services/assistant.js`):
  free-form multilingual Q&A answered strictly from the live fused situational
  data (incidents + hazards + forecast + facilities + personalized risk).
- **Mutual-aid board** (`services/aid.js`): residents post a need / offer / "I'm
  safe"; an engine **auto-matches needs to the nearest offer** by resource
  category and proximity. Persisted in Firestore.
- **Cross-source early-warning**: a fresh event corroborated by multiple
  independent feeds is flagged *emerging* before any single official confirmation.
- **Predictive nowcast**: forward 24–48h hazard guidance from forecast rain on
  terrain + river-discharge trend (advisory; not added to current risk).
- **Locality-scoped push**: verified localized emergencies notify only
  subscribers within a radius; whole-community push reserved for area-wide events.
- **PATENT.md**: prior-art review (US10629053, US20160371968, US9438619,
  US20230091292) and draft independent/method claims distinguishing LocalPulse.

## 2026-05-24 (breadth + freshness + quality)

### Added
- **40+ free data sources** (`services/sources.js`): Google News geo/topic
  queries across all Himachal districts + direct RSS from ~20 national/regional
  outlets (English + Hindi), all free/no-key. Breadth powers corroboration: an
  event reported by many independent feeds gets a large cluster and high trust;
  lone-source noise stays low. Authoritative outlets flagged as "verified".
- **More hazard feeds** (`services/hazards.js`, all free/no-key): air quality
  (Open-Meteo, AQI shown on the dashboard), river-discharge/flood forecast
  (Open-Meteo GloFAS, conservative warnings), GDACS major-disaster alerts
  (strictly region-filtered to avoid false positives), NASA EONET nearby natural
  events. No extra Gemini cost — structured facts processed by rules.

### Changed
- **Time-decay (no fear-mongering)**: a one-time event (e.g. a fire that
  happened) now fades from the risk score — contribution halves every 12h and
  events older than 36h drop out of "act now" advice. The dashboard counts only
  *current* incidents; older ones remain as dated history in the feed. When
  nothing current is happening it honestly says so.

## 2026-05-24 (agentic + push + spatial)

### Added
- **Agentic verification** (`services/verify.js`): every citizen report is
  cross-checked by a Gemini model using the **Google Search tool** (real web
  search) and assigned a verdict (corroborated / unverified / contradicted),
  severity and confidence. Debunked reports are flagged "disputed" and excluded
  from risk — stops misinformation from scaring anyone. Daily-capped.
- **Web Push alerts** (`services/push.js`, VAPID): residents subscribe ("Get
  alerts") and are notified on a genuine district-wide escalation or a
  corroborated high-severity report. Subscriptions in Firestore; dead ones pruned.

### Changed
- **Spatially honest DSS**: a town is large, so a single localized incident no
  longer reads as town-wide risk. Area-wide hazards (weather, official alerts,
  big quakes) drive the shared level; point incidents are shown with distance and
  only raise *your* risk when near *you*. New `?lat&lng` on `/api/dss` gives a
  personalized "near me" view; default is an honest district overview. Push fires
  only for genuine area-wide escalations, never for one far-off incident.

## 2026-05-24 (offline + responder)

### Added
- **Offline PWA** (`public/sw.js`): cache-first shell + network-first API with
  cache fallback, so the dashboard still shows last-known status on bad/no
  internet. Registered on dashboard, responder and voice pages.
- **Responder console** now shows the same DSS risk banner (level + headline +
  official alerts + recommendations) and community reports merge into its feed.

## 2026-05-24 (community + persistence)

### Added
- **Two-way community reporting** (`services/persist.js`, Firestore over REST):
  resident submissions are persisted and immediately appear on the map/feed for
  everyone (flagged "community", low trust until verified). New `GET /api/reports`.
- **Cold-start persistence**: the last good (LLM) ingest is snapshotted to
  Firestore and reloaded on boot, so restarts show real multilingual data
  instantly without spending the Gemini budget. Heuristic warm-up only when no
  snapshot exists.

## 2026-05-24 (DSS)

### Added
- **Real-world hazard awareness** (`services/hazards.js`, all free/no-key):
  Open-Meteo live weather + 2-day forecast → derived warnings (rain, snow,
  storm, heat, cold, wind); USGS earthquakes within 350 km; **official NDMA
  Sachet CAP alerts** (IMD/SDMA) filtered to Himachal. New `GET /api/hazards`.
- **Decision Support brain** (`services/dss.js`): computes a town RISK LEVEL
  (ok/elevated/high/severe) and ranked **actionable recommendations** from
  incidents + hazards + facilities. Robust to duplicate-headline noise (scores
  by distinct category-severity signals). Rule-based and explainable.
  New `GET /api/dss`. Surfaced as a colour-coded banner on the dashboard with
  localized risk level + headline.

## 2026-05-24 (later)

### Added
- **Real relief points** from OpenStreetMap (Overpass, free, no key): live
  hospitals, clinics, police, community centres and schools near the town, with
  directions links. Replaces the mock shelters (`services/facilities.js`).
- **Voice bot grounded in live data**: keyword intent → generic localized
  lead-in → real incidents/facilities appended (5 languages, no per-call LLM
  cost). Honors the caller's language from the request body.

### Removed / Fixed
- Mock shelter capacity/occupancy; mock canned voice specifics (NH-5 Kandaghat,
  capacity 220, etc.) replaced with generic localized templates + live data.
- Fake "Voice calls / hr" KPI replaced with a real "Languages" counter; the
  "Sources scanned" KPI now reflects the real fetched-item count.

## 2026-05-24

### Changed
- Live incidents now carry **real coordinates** (Gemini geocodes the place named
  in each item) and **content in all five languages** (en/hi/pa/ta/bn), plus a
  multilingual status summary. The map and language switcher are now real for
  live data, not English-only with jittered coordinates.
- **Cost control:** Gemini is called only by the scheduled `/tasks/ingest`
  (cron = the daily cap). Cold-start warm-ups use the free keyword heuristic and
  never spend the Gemini budget. Ingestion cadence reduced to a few times/day.

### Fixed
- `geminiJson` raises the output-token budget and salvages truncated JSON, so the
  multilingual batch no longer silently falls back to the heuristic.

## 2026-05-23

### Added
- Real social/news ingestion pipeline (replaces simulated incidents):
  - `services/sources.js` — Google News RSS (no key) + optional Reddit app-only OAuth.
  - `services/brain.js` — Gemini Flash triage when `GEMINI_API_KEY` is set, free
    keyword heuristic otherwise. Classifies category + severity, writes summary.
  - `services/ingest.js` — fetch → dedupe/cluster → classify → normalize → store,
    with a cooldown guard to protect the Gemini quota.
  - `data/store.js` — in-memory live store; transparently falls back to seed data.
  - `server.js` — `/api/incidents` + `/api/summary` now read live data; new
    `GET /api/status` and token-guarded `ALL /tasks/ingest` (Cloud Scheduler);
    boot warm-up; pulse ticker uses real counts.
  - Env: `GEMINI_API_KEY`, `GEMINI_MODEL`, `REDDIT_CLIENT_ID/SECRET/SUBS`,
    `INGEST_TOKEN`, `INGEST_MIN_INTERVAL_MS`, `LOCATION_QUERY`, `INGEST_ON_BOOT`.
- CI/CD: GitHub Actions workflow (`.github/workflows/deploy.yml`) that auto-deploys
  to Cloud Run (`localpulse`, `asia-east1`) on every push to `main`. Authenticates
  to GCP via keyless Workload Identity Federation (no service-account key stored).
- `requirements.txt` pinning `python-docx` for the build-time report generation step.

### Fixed
- Corrected the candidate's roll number and program in `user.md`
  (`GF202217744`, B.Tech CSE Cloud Computing).
