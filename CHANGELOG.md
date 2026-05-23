# Changelog

All notable changes to LocalPulse are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); grouped by date.

## 2026-05-23

### Added
- CI/CD: GitHub Actions workflow (`.github/workflows/deploy.yml`) that auto-deploys
  to Cloud Run (`localpulse`, `asia-east1`) on every push to `main`. Authenticates
  to GCP via keyless Workload Identity Federation (no service-account key stored).
- `requirements.txt` pinning `python-docx` for the build-time report generation step.

### Fixed
- Corrected the candidate's roll number and program in `user.md`
  (`GF202217744`, B.Tech CSE Cloud Computing).
