# LocalPulse

> AI crisis management for small communities. Verified status for your town. Built for slow phones, bad internet, small towns.

[![cloud-run](https://img.shields.io/badge/Cloud%20Run-asia--east1-4285F4)](https://localpulse.dmj.one)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![node](https://img.shields.io/badge/node-20%2B-339933)](https://nodejs.org)

**Live:** https://localpulse.dmj.one  ·  **Pitch:** https://localpulse.dmj.one/pitch  ·  **Report:** https://localpulse.dmj.one/report

Capstone project by **Anshuman Mohanty** (GF202217744), B.Tech CSE Cloud Computing, Yogananda School of AI, Computers and Data Sciences, Shoolini University. Mentor: Mr. Ashish.

---

## What it is

During local emergencies, whether floods, fires, or power outages, information is scattered, full of rumours, and hard to act on. Small towns can't afford smart-city software. **LocalPulse** is a lightweight, mobile-first **decision support system** for residents and responders that fuses real live data into a single risk picture with clear, actionable advice.

It's all real, all free-tier (you pay only a few cents/day of Gemini if you opt in):

1. **40+ live data sources.** Google News geo/topic queries across every Himachal district, direct RSS from ~20 national/regional/Hindi outlets, plus weather, air-quality, flood, seismic, satellite and official-alert APIs. All free, no key. Breadth drives **corroboration**: an event seen across many independent feeds earns high trust; lone-source noise stays low.
2. **AI processing.** **Gemini Flash-Lite** filters noise, classifies (road/shelter/power/water/medical/rumour) and severity, **geolocates**, and **translates into 5 languages** (en/hi/pa/ta/bn).
3. **Agentic verification.** Every citizen report is cross-checked by a Gemini agent doing **real Google web search**; you get a verdict (corroborated / unverified / contradicted) and confidence. Debunked claims are excluded from risk, so misinformation never scares anyone.
4. **Real hazard awareness.** Weather and warnings (**Open-Meteo**), **air quality / AQI**, **river-discharge/flood** (GloFAS), earthquakes (**USGS**), **NASA EONET** events, and **official NDMA Sachet + GDACS** alerts, strictly region-filtered.
5. **Decision Support brain.** Risk level plus ranked recommendations, **spatially honest** (area-wide hazards vs localized incidents; `?lat&lng` for "near me") and **time-decayed** (one-time events fade; only *current* incidents count, so there is no fear-mongering).
6. **Real relief points.** Hospitals, police, community centres, and schools from **OpenStreetMap**, with directions.
7. **Two-way community reporting.** Residents submit (with live geolocation); reports **persist to Firestore** and appear on the shared map in seconds.
8. **Locality-scoped Web Push.** Verified localized emergencies notify only subscribers *near* the event; whole-community push is reserved for genuine district-wide escalation.
9. **Ask LocalPulse.** A conversational RAG assistant answers free-form questions strictly from the live fused data, in any of the 5 languages.
10. **Mutual-aid board.** Residents post needs, offers, and "I'm safe"; an engine **auto-matches needs to the nearest offer** by resource category and proximity.
11. **Cross-source early-warning.** A fresh event corroborated by many independent feeds is flagged *emerging* before any single official confirmation.
12. **Predictive nowcast.** Forward 24–48h hazard guidance from forecast rain on terrain plus river-discharge trend (advisory, never inflates current risk).
13. **Multilingual voice assistant** plus an **offline PWA** (installable, works on bad connections).

**Anti-fear-mongering by design:** source items older than a few days are dropped at ingest; a one-time event's influence **decays** (half-life 12h) and stale events leave "act-now" advice; risk is **spatially scoped** (a far-off incident doesn't read as town-wide). See **[PATENT.md](PATENT.md)** for prior-art analysis and how these mechanisms set LocalPulse apart.

**Cost discipline:** Gemini runs only on a scheduled ingest (a few calls/day) plus per-report verification (daily-capped); the 40+ feeds and all hazard data are free and processed by rules. Cold starts reload the last good result from **Firestore** instead of spending the model budget. Every feed degrades gracefully, so the app is never blank.

### Live data & keys (all optional, all free-tier)

| Env var | Effect |
|---|---|
| _(none)_ | Real Google News ingestion + keyword classifier. ₹0. |
| `GEMINI_API_KEY` | Smart triage/summaries via Gemini Flash. Key: [aistudio.google.com](https://aistudio.google.com/apikey). |
| `GEMINI_MODEL` | Override model (default `gemini-flash-lite-latest`, which auto-tracks the newest cheapest/fastest Flash-Lite). |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | Adds Reddit as a source (app-only OAuth). Register at [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps). |
| `REDDIT_SUBS` | Subreddits to scan (default `himachal,india`). |
| `LOCATION_QUERY` | Town/region to search (default `Solan Himachal Pradesh`). |
| `INGEST_TOKEN` | Shared secret required to call `/tasks/ingest`. Ingestion is disabled until set. |
| `INGEST_MIN_INTERVAL_MS` | Cooldown between ingests (default 5 min); protects the Gemini quota. |

To enable Gemini on the live service:

```bash
gcloud run services update localpulse --region=asia-east1 \
  --update-env-vars="GEMINI_API_KEY=YOUR_KEY"
```

## Routes

| Path | What |
|---|---|
| `/` | Resident dashboard: map, AI summary, incidents, shelters, report-an-issue form |
| `/responder` | Emergency-responder console: operational map, feed, SSE pulse stream |
| `/voice` | Voice helpline demo: browser Web Speech API; production runs on Twilio + Whisper |
| `/pitch` | Web slide deck. Arrow keys / space / PgUp-PgDn / F (fullscreen) / ? (help) |
| `/report` | Full capstone project report (HTML, print-friendly) |
| `/api/incidents` | JSON, accepts `?lang=` and `?category=` |
| `/api/shelters` | JSON |
| `/api/summary` | AI summary, accepts `?lang=` |
| `/api/hazards` | Live weather, earthquakes, official NDMA alerts |
| `/api/dss` | Decision support: risk level + recommendations |
| `/api/reports` | Community-submitted reports |
| `/api/voice/intent` | POST `{text, lang}` → `{intent, response}` |
| `/api/pulse` | Server-Sent Events stream |
| `/healthz` `/readyz` `/version` | Ops |

## Stack

- **Runtime:** Node.js 20 + Express 4, single container, ~80 KB JS deps after compression
- **Frontend:** vanilla JS, Tailwind via CDN, Leaflet for maps, Web Speech API for voice, Inter + Space Grotesk + JetBrains Mono
- **Hosting:** Google Cloud Run, region `asia-east1`, min 0 / max 2 instances, 512 MiB / 1 vCPU, public unauth
- **Data:** hardcoded JSON in `data/*.js` (MLP). Production target: Firestore + Pub/Sub + BigQuery
- **i18n:** five Indian languages out of the box (en, hi, pa, ta, bn) with native script
- **Security:** strict CSP, HSTS, X-Frame-Options DENY, no PII in logs, AES-256-GCM and TLS 1.3 in production
- **Observability:** structured JSON logs to stdout (Cloud Logging picks up automatically), correlation ID per request, p95 latency target < 200 ms, cold-start < 2 s
- **Accessibility:** WCAG 2.2 AAA targets, skip link, focus rings, semantic landmarks, keyboard nav, prefers-reduced-motion, screen-reader labels

### Satellite sources

The `/api/eo` endpoint fuses multiple Earth-observation sensors per location:
active fire (NASA FIRMS: VIIRS S-NPP / NOAA-20 / NOAA-21, MODIS), air quality
(Open-Meteo CAMS, Sentinel-5P assimilated), multi-day precipitation (NASA POWER),
and seismic events (USGS). Each source degrades gracefully; the fusion engine
cross-validates overlapping sensors and reports coverage. Add `FIRMS_MAP_KEY`
(free) to enable fire detection. Sentinel-1/2/5P adapters arrive in Phase 2.

## Run locally

```bash
npm install
node server.js
# open http://localhost:8080
```

## Deploy to Cloud Run

```bash
gcloud config set project dmjone
gcloud run deploy localpulse \
  --source=. \
  --region=asia-east1 \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=2 \
  --cpu=1 --memory=512Mi \
  --concurrency=80 --timeout=60
```

Map a custom domain:

```bash
gcloud beta run domain-mappings create \
  --service=localpulse \
  --domain=localpulse.dmj.one \
  --region=asia-east1
```

## Project files

```
.
├── server.js           # Express server, all routes, security headers, SSE
├── data/
│   ├── incidents.js    # mock incidents + shelters + summaries (5 languages)
│   ├── i18n.js         # server-side dictionary
│   └── intents.js      # voice bot intent classifier (heuristic, MLP)
├── public/
│   ├── index.html      # resident dashboard
│   ├── responder.html  # responder console
│   ├── voice.html      # voice demo
│   ├── pitch.html      # slide deck (arrow keys)
│   ├── report.html     # full project report
│   ├── css/app.css
│   └── js/{app,voice}.js
├── Dockerfile
├── package.json
└── CAPSTONE PROJECT REPORT.docx
```

## Mission

Built for the slow phone, the bad internet, the small town.
**#AatmanirbharBharat @India2047.**

## License

MIT. See `LICENSE`.
