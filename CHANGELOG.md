# Changelog

All notable changes to LocalPulse are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); grouped by date.

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
