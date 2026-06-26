#!/usr/bin/env bash
#
# Fetch local place data into the local dev database.
#
# Common usage:
#   make fetch-places
#   DRY_RUN=1 make fetch-places
#   VENDOR=Benu DRY_RUN=1 make fetch-places
#   MAX_VENDORS=5 CONTINUE_ON_ERROR=1 make fetch-places
#   SOURCES=osm,tomtom,foursquare make fetch-places
#   SOURCES=osm,tomtom VENDOR=Benu DRY_RUN=1 make fetch-places
#   FIELDS=fsq_place_id,name,latitude,longitude,categories,location,photos make fetch-places
#   COVERAGE_BOUNDS=42.2322,18.8170,46.1900,23.0063 MAX_SPLIT_DEPTH=8 make fetch-places
#   CATEGORY_IDS=4bf58dd8d48988d10f951735,5745c2e4498e11e7bccabdbd make fetch-places  # faster, less complete
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

if [ "${SKIP_MIGRATE:-0}" != "1" ]; then
  echo "Applying local database migrations..."
  go run ./cmd/migrate
fi

args=()

if [ -n "${SOURCES:-}" ]; then
  args+=("-sources" "$SOURCES")
fi

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

if [ -n "${COVERAGE_BOUNDS:-}" ]; then
  args+=("-coverage-bounds" "$COVERAGE_BOUNDS")
fi

if [ -n "${MAX_SPLIT_DEPTH:-}" ]; then
  args+=("-max-split-depth" "$MAX_SPLIT_DEPTH")
fi

if [ -n "${CATEGORY_IDS:-}" ]; then
  args+=("-category-ids" "$CATEGORY_IDS")
fi

if [ -n "${OSM_OVERPASS_URL:-}" ]; then
  args+=("-osm-overpass-url" "$OSM_OVERPASS_URL")
fi

if [ -n "${OSM_OVERPASS_TIMEOUT:-${OSM_TIMEOUT:-}}" ]; then
  args+=("-osm-timeout" "${OSM_OVERPASS_TIMEOUT:-${OSM_TIMEOUT:-}}")
fi

if [ -n "${OSM_CACHE_FILE:-}" ]; then
  args+=("-osm-cache" "$OSM_CACHE_FILE")
fi

if [ "${OSM_REFRESH:-0}" = "1" ]; then
  args+=("-osm-refresh")
fi

if [ -n "${TOMTOM_BASE_URL:-}" ]; then
  args+=("-tomtom-base-url" "$TOMTOM_BASE_URL")
fi

if [ -n "${TOMTOM_COUNTRY_SET:-}" ]; then
  args+=("-tomtom-country-set" "$TOMTOM_COUNTRY_SET")
fi

if [ -n "${TOMTOM_SEARCH_LIMIT:-${TOMTOM_LIMIT:-}}" ]; then
  args+=("-tomtom-limit" "${TOMTOM_SEARCH_LIMIT:-${TOMTOM_LIMIT:-}}")
fi

if [ -n "${TOMTOM_MAX_PAGES:-}" ]; then
  args+=("-tomtom-max-pages" "$TOMTOM_MAX_PAGES")
fi

if [ "${TOMTOM_OPENING_HOURS:-1}" = "0" ]; then
  args+=("-tomtom-opening-hours=false")
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

if [ "${PRUNE_STALE:-1}" = "0" ]; then
  args+=("-prune-stale=false")
fi

if [ "${CONTINUE_ON_ERROR:-0}" = "1" ]; then
  args+=("-continue-on-error")
fi

if [ "${REQUIRE_ALL_SOURCES:-0}" = "1" ]; then
  args+=("-require-all-sources")
fi

echo "Fetching places locally..."
if [ "${#args[@]}" -gt 0 ]; then
  go run ./cmd/fetchplaces "${args[@]}" "$@"
else
  go run ./cmd/fetchplaces "$@"
fi
