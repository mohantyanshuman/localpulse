#!/usr/bin/env bash
# Put LocalPulse secrets into Google Secret Manager and wire them into the Cloud Run
# service the LEAK-RESISTANT way: encrypted at rest, IAM-gated, injected at runtime, and
# NEVER stored as plaintext in the service / revision config. Idempotent: re-run to add
# new secret versions (rotation).
#
# Run this yourself (it needs YOUR gcloud auth; Claude has no access to your project):
#   chmod +x scripts/setup-secrets.sh && ./scripts/setup-secrets.sh [path-to-.env]
#
# It reads values from your local .env (gitignored). The script contains NO secret values.
set -euo pipefail

PROJECT="${PROJECT:-dmjone}"
REGION="${REGION:-asia-east1}"
SERVICE="${SERVICE:-localpulse}"
ENV_FILE="${1:-.env}"
MODE="${MODE:-env}"   # env = inject as env vars from Secret Manager; file = mount as files (most hardened)

# Keys treated as SECRETS (go to Secret Manager). Non-secret config is set as plain env.
SECRET_KEYS="FIRMS_MAP_KEY COPERNICUS_CLIENT_ID COPERNICUS_CLIENT_SECRET CDSAPI_KEY EARTHDATA_TOKEN EO_SIGNING_KEY GEMINI_API_KEY INGEST_TOKEN SYNC_SECRET VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY REDDIT_CLIENT_ID REDDIT_CLIENT_SECRET"
PLAIN_KEYS="DEFAULT_LAT DEFAULT_LNG CDSAPI_URL REGION_KEYWORDS"

[ -f "$ENV_FILE" ] || { echo "No env file at $ENV_FILE"; exit 1; }
declare -A ENV
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|\#*) continue;; esac
  k="${line%%=*}"; v="${line#*=}"; k="$(echo "$k" | tr -d ' ')"
  [ -n "$k" ] && ENV["$k"]="$v"
done < "$ENV_FILE"

echo "Enabling Secret Manager..."
gcloud services enable secretmanager.googleapis.com --project="$PROJECT" >/dev/null

SA="$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null || true)"
if [ -z "$SA" ]; then
  PN="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
  SA="${PN}-compute@developer.gserviceaccount.com"
fi
echo "Cloud Run runtime service account: $SA"

UPDATE_SECRETS=""
for K in $SECRET_KEYS; do
  V="${ENV[$K]:-}"; [ -n "$V" ] || continue
  if gcloud secrets describe "$K" --project="$PROJECT" >/dev/null 2>&1; then
    printf '%s' "$V" | gcloud secrets versions add "$K" --project="$PROJECT" --data-file=- >/dev/null
    echo "  + new version: $K"
  else
    printf '%s' "$V" | gcloud secrets create "$K" --project="$PROJECT" --replication-policy="automatic" --data-file=- >/dev/null
    echo "  + created: $K"
  fi
  gcloud secrets add-iam-policy-binding "$K" --project="$PROJECT" \
    --member="serviceAccount:${SA}" --role="roles/secretmanager.secretAccessor" >/dev/null 2>&1 || true
  if [ "$MODE" = "file" ]; then
    # Mount each secret as a file in its OWN directory (/secrets/<KEY>/value); Cloud Run
    # cannot mount multiple secrets into the same directory, so each needs a distinct path.
    UPDATE_SECRETS="${UPDATE_SECRETS:+$UPDATE_SECRETS,}/secrets/${K}/value=${K}:latest"
  else
    # Inject as an env var sourced from Secret Manager (value not stored in the config)
    UPDATE_SECRETS="${UPDATE_SECRETS:+$UPDATE_SECRETS,}${K}=${K}:latest"
  fi
done

SET_ENV=""
for K in $PLAIN_KEYS; do
  V="${ENV[$K]:-}"; [ -n "$V" ] || continue
  SET_ENV="${SET_ENV:+$SET_ENV,}${K}=${V}"
done
if [ "$MODE" = "file" ]; then
  for K in $SECRET_KEYS; do [ -n "${ENV[$K]:-}" ] && SET_ENV="${SET_ENV:+$SET_ENV,}${K}_FILE=/secrets/${K}/value"; done
fi

ARGS=()
[ -n "$UPDATE_SECRETS" ] && ARGS+=(--update-secrets "$UPDATE_SECRETS")
[ -n "$SET_ENV" ] && ARGS+=(--update-env-vars "$SET_ENV")
[ ${#ARGS[@]} -gt 0 ] || { echo "Nothing to set (no matching keys in $ENV_FILE)."; exit 0; }

echo "Wiring Cloud Run ($SERVICE) [MODE=$MODE]..."
gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" "${ARGS[@]}"

echo
echo "Done. Secrets live in Secret Manager (encrypted, IAM-gated, audit-logged), not in the"
echo "service config. Verify nothing is exposed in plaintext:"
echo "  gcloud run services describe $SERVICE --project=$PROJECT --region=$REGION --format=yaml | grep -iE 'secret|env' "
