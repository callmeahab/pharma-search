#!/usr/bin/env bash
#
# Fetch Foursquare Places data into the local dev database.
#
# Common usage:
#   make fetch-places
#   DRY_RUN=1 make fetch-places
#   VENDOR=Benu DRY_RUN=1 make fetch-places
#   MAX_VENDORS=5 CONTINUE_ON_ERROR=1 make fetch-places
#   FIELDS=fsq_place_id,name,latitude,longitude,categories,location make fetch-places
#   CATEGORY_IDS=4bf58dd8d48988d10f951735,5745c2e4498e11e7bccabdbd make fetch-places
#
# This is intentionally local-only. It does not install timers, touch systemd, or
# deploy anything to the production server.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ -z "${FOURSQUARE_API_KEY:-}" ]; then
  echo "ERROR: FOURSQUARE_API_KEY is not set in .env or the environment." >&2
  exit 1
fi

if [ "${SKIP_MIGRATE:-0}" != "1" ]; then
  echo "Applying local database migrations..."
  go run ./cmd/migrate
fi

args=()

if [ -n "${VENDOR:-}" ]; then
  args+=("-vendor" "$VENDOR")
fi

if [ -n "${NEAR:-}" ]; then
  args+=("-near" "$NEAR")
fi

if [ -n "${LIMIT:-}" ]; then
  args+=("-limit" "$LIMIT")
fi

if [ -n "${FIELDS:-}" ]; then
  args+=("-fields" "$FIELDS")
fi

if [ -n "${CATEGORY_IDS:-}" ]; then
  args+=("-category-ids" "$CATEGORY_IDS")
fi

if [ -n "${MAX_VENDORS:-}" ]; then
  args+=("-max-vendors" "$MAX_VENDORS")
fi

if [ -n "${SLEEP:-}" ]; then
  args+=("-sleep" "$SLEEP")
fi

if [ "${DRY_RUN:-0}" = "1" ]; then
  args+=("-dry-run")
fi

if [ "${STRICT_MATCH:-1}" = "0" ]; then
  args+=("-strict-match=false")
fi

if [ "${PRUNE_DISALLOWED:-1}" = "0" ]; then
  args+=("-prune-disallowed=false")
fi

if [ "${CONTINUE_ON_ERROR:-0}" = "1" ]; then
  args+=("-continue-on-error")
fi

echo "Fetching Foursquare places locally..."
if [ "${#args[@]}" -gt 0 ]; then
  go run ./cmd/fetchplaces "${args[@]}" "$@"
else
  go run ./cmd/fetchplaces "$@"
fi
