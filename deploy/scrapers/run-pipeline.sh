#!/usr/bin/env bash
#
# Full scraper pipeline: scrape -> import-csv -> postprocess.
# This is what should be SCHEDULED (not `bun start`, which only writes CSVs and
# never touches the DB). Exit code is propagated so the scheduler/alerting notices
# a failed run.
#
# Override the scrapers location with SCRAPERS_DIR; otherwise it's resolved
# relative to this script (repo-root/scrapers).
set -uo pipefail

SCRAPERS_DIR="${SCRAPERS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../scrapers" && pwd)}"
export PATH="$HOME/.bun/bin:/root/.bun/bin:/usr/local/bin:$PATH"

if ! command -v bun >/dev/null 2>&1; then
  echo "ERROR: bun not found on PATH" >&2
  exit 127
fi

cd "$SCRAPERS_DIR" || { echo "ERROR: SCRAPERS_DIR not found: $SCRAPERS_DIR" >&2; exit 1; }

echo "[$(date -Iseconds)] scraper pipeline starting in $SCRAPERS_DIR"

# `bun run pipeline` = run-scrapers-worker.ts && import-csv.ts && postprocess.
# Enable per-vendor zero-price cleanup + dedupe inside the run.
SCRAPER_RUN_DB_CLEANUP="${SCRAPER_RUN_DB_CLEANUP:-1}" bun run pipeline
code=$?

echo "[$(date -Iseconds)] scraper pipeline exited with code $code"
exit $code
