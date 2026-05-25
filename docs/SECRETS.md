# Secrets on Cloud Run — leak-resistant handling

**Goal:** secrets are *on* Cloud Run and used by the app, but cannot be downloaded from the
service config or leaked from the environment, and are not abusable by anyone without
explicit IAM access.

## Why not plaintext env vars
`gcloud run deploy --set-env-vars KEY=value` (or the console) stores the value **in clear
text in the service/revision config**. Anyone with `run.services.get` can read it via
`gcloud run services describe`. That is the leak vector to avoid.

## The model used here: Google Secret Manager
Secrets are stored in **Secret Manager** and referenced by Cloud Run:
- **Encrypted at rest**, versioned, and **rotatable**.
- **IAM-gated**: only the Cloud Run runtime service account, granted
  `roles/secretmanager.secretAccessor`, can read them at runtime.
- **Not in the service config**: `describe` shows only a reference like `KEY -> KEY:latest`,
  never the value, so it cannot be downloaded from the config or the console.
- **Audit-logged**: every access is recorded in Cloud Audit Logs.

Two injection modes (the script supports both):

| Mode | How | Hardening |
|---|---|---|
| `env` (default) | `--update-secrets KEY=KEY:latest` injects the value as an env var sourced from Secret Manager | Value never in the config; standard strong option |
| `file` | `--update-secrets /secrets/KEY/value=KEY:latest` mounts each secret as a **file in its own directory** (Cloud Run cannot mount multiple secrets into one directory); `KEY_FILE=/secrets/KEY/value` is set and `services/secrets-bootstrap.js` loads it into the env at startup | Value also **not in the environment block**, so it can't leak via an env dump, a child process, a crash report, or an accidental log. Most leak-resistant. |

## Current production state (already wired)
All nine secrets — `FIRMS_MAP_KEY`, `COPERNICUS_CLIENT_ID`, `COPERNICUS_CLIENT_SECRET`,
`CDSAPI_KEY`, `EARTHDATA_TOKEN`, `EO_SIGNING_KEY`, `GEMINI_API_KEY`, `INGEST_TOKEN`,
`VAPID_PRIVATE_KEY` — are in Secret Manager and injected into the `localpulse` service as
**references** (env mode). Verified: `gcloud run services describe` shows only references,
no plaintext values, and `/api/eo/pubkey` serves the stable signing key. `VAPID_PUBLIC_KEY`
and other non-secret config remain plain env (public key is not a secret). Future
`gcloud run deploy --source=.` (CI) preserves these references.

## Run it (you, not Claude — it needs your gcloud auth)
```bash
chmod +x scripts/setup-secrets.sh
./scripts/setup-secrets.sh            # env-injection mode
MODE=file ./scripts/setup-secrets.sh  # file-mount mode (most hardened)
```
It reads values from your local `.env` (gitignored) and contains **no secret values** itself.
Re-running adds a new Secret Manager version (rotation) and rewires the service.

## What the app does
- `services/secrets-bootstrap.js` runs first and loads any `KEY_FILE`-mounted secret into
  `process.env.KEY` (file-mount mode). In env mode, Cloud Run already populates `process.env`.
- The app reads `process.env.KEY` as before; only the delivery is hardened.
- **No secret is ever logged or returned.** Audited: the access log records only
  method/path/status/latency/ip/ua; `/api/status` exposes a boolean "is a key configured",
  never a value; `INGEST_TOKEN` is compared with a timing-safe equal.

## Residual risk (honest)
No delivery method prevents a full container compromise (RCE) from reading a mounted file
or env at runtime — that is true of every system. Secret Manager + least-privilege IAM +
file mounts + audit logs + rotation is defense-in-depth, not magic. Mitigations already in
place: scale-to-zero (small attack surface), no `eval`/dynamic code, parameterized inputs,
the global pre-commit secret guard + gitleaks CI so secrets never reach the repo, and a
gitignored `.env` locally.

## Rotation
1. Update the value in your local `.env` (or generate a new one).
2. Re-run the script — it adds a new Secret Manager version and points the service at
   `:latest`. The next request/instance picks it up.
3. Optionally disable/destroy the old version in Secret Manager.
Rotate the FIRMS / Copernicus / Earthdata / signing keys periodically and immediately if
any value was ever exposed (e.g., pasted into a chat).
