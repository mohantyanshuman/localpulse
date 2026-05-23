# LocalPulse

> AI crisis management for small communities. Verified status for your town. Built for slow phones, bad internet, small towns.

[![cloud-run](https://img.shields.io/badge/Cloud%20Run-asia--east1-4285F4)](https://localpulse.dmj.one)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![node](https://img.shields.io/badge/node-20%2B-339933)](https://nodejs.org)

**Live:** https://localpulse.dmj.one  ·  **Pitch:** https://localpulse.dmj.one/pitch  ·  **Report:** https://localpulse.dmj.one/report

Capstone project — **Anshuman Mohanty** (GF202217744), B.Tech CSE Cloud Computing, Yogananda School of AI, Computers and Data Sciences, Shoolini University. Mentor: Mr. Ashish.

---

## What it is

During local emergencies — floods, fires, power outages — information on social media is scattered, full of rumours, and hard to act on. Small towns can't afford smart-city software. **LocalPulse** is a lightweight, mobile-first dashboard for residents and emergency responders, with two AI features:

1. **AI social-media summary** — an NLP agent ingests local Twitter / X and Reddit threads, filters noise, classifies posts (roads, shelters, power, water, medical), clusters duplicates, scores trust, and returns a one-glance "Status Summary".
2. **Multilingual voice helpline** — a Twilio + Whisper phone line so elderly residents without smartphones can call in their own language (Hindi, Punjabi, Tamil, Bengali, English) to report issues or get updates.

**Live ingestion is real.** Every 20 minutes (Cloud Scheduler → token-guarded `/tasks/ingest`) the server pulls public Google News items for the town, classifies them into categories + severity, and serves them at `/api/incidents` and `/api/summary`. It runs **free with no API key** (keyword heuristic); set `GEMINI_API_KEY` to upgrade triage to Gemini Flash, and add Reddit credentials for a second source. If a fetch fails or no key is set, it transparently falls back to the curated seed data so the app is never blank. Still no persistence (in-memory, scale-to-zero); Firestore is the durability upgrade. Voice still runs as a browser Web Speech demo (production: Twilio + Whisper).

### Live data & keys (all optional, all free-tier)

| Env var | Effect |
|---|---|
| _(none)_ | Real Google News ingestion + keyword classifier. ₹0. |
| `GEMINI_API_KEY` | Smart triage/summaries via Gemini Flash. Key: [aistudio.google.com](https://aistudio.google.com/apikey). |
| `GEMINI_MODEL` | Override model (default `gemini-flash-lite-latest` — auto-tracks the newest cheapest/fastest Flash-Lite). |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | Adds Reddit as a source (app-only OAuth). Register at [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps). |
| `REDDIT_SUBS` | Subreddits to scan (default `himachal,india`). |
| `LOCATION_QUERY` | Town/region to search (default `Solan Himachal Pradesh`). |
| `INGEST_TOKEN` | Shared secret required to call `/tasks/ingest`. Ingestion is disabled until set. |
| `INGEST_MIN_INTERVAL_MS` | Cooldown between ingests (default 5 min) — protects the Gemini quota. |

To enable Gemini on the live service:

```bash
gcloud run services update localpulse --region=asia-east1 \
  --update-env-vars="GEMINI_API_KEY=YOUR_KEY"
```

## Routes

| Path | What |
|---|---|
| `/` | Resident dashboard — map, AI summary, incidents, shelters, report-an-issue form |
| `/responder` | Emergency-responder console — operational map, feed, SSE pulse stream |
| `/voice` | Voice helpline demo — browser Web Speech API; production runs on Twilio + Whisper |
| `/pitch` | Web slide deck. Arrow keys / space / PgUp-PgDn / F (fullscreen) / ? (help) |
| `/report` | Full capstone project report (HTML, print-friendly) |
| `/api/incidents` | JSON, accepts `?lang=` and `?category=` |
| `/api/shelters` | JSON |
| `/api/summary` | AI summary, accepts `?lang=` |
| `/api/voice/intent` | POST `{text, lang}` → `{intent, response}` |
| `/api/pulse` | Server-Sent Events stream |
| `/healthz` `/readyz` `/version` | Ops |

## Stack

- **Runtime** — Node.js 20 + Express 4, single container, ~80 KB JS deps after compression
- **Frontend** — vanilla JS, Tailwind via CDN, Leaflet for maps, Web Speech API for voice, Inter + Space Grotesk + JetBrains Mono
- **Hosting** — Google Cloud Run, region `asia-east1`, min 0 / max 2 instances, 512 MiB / 1 vCPU, public unauth
- **Data** — hardcoded JSON in `data/*.js` (MLP). Production target: Firestore + Pub/Sub + BigQuery
- **i18n** — five Indian languages out of the box (en, hi, pa, ta, bn) with native script
- **Security** — strict CSP, HSTS, X-Frame-Options DENY, no PII in logs, AES-256-GCM and TLS 1.3 in production
- **Observability** — structured JSON logs to stdout (Cloud Logging picks up automatically), correlation ID per request, p95 latency target < 200 ms, cold-start < 2 s
- **Accessibility** — WCAG 2.2 AAA targets: skip link, focus rings, semantic landmarks, keyboard nav, prefers-reduced-motion, screen-reader labels

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

MIT — see `LICENSE`.
