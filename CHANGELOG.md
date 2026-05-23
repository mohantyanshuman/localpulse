# Changelog

All notable changes to LocalPulse are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); grouped by date.

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
