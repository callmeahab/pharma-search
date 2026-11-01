#!/usr/bin/env bash
#
# Full data pipeline, end to end:
#   (build dicts) -> scrape -> import-csv -> postprocess -> extract -> categorize -> canonicalize -> (sync)
#
# This is the single command to run the entire workflow. It is what should be
# SCHEDULED (not `bun start`, which only writes CSVs and never touches the DB).
# Each phase's exit code is checked; a failure in a load-bearing phase aborts the
# run (canonicalize is enrichment and is best-effort).
#
# Env toggles (all optional):
#   SKIP_SCRAPE=1        reuse existing CSVs (import+postprocess only) — no re-scrape
#   SKIP_EXTRACT=1       skip the ML entity extraction
#   SKIP_CATEGORIZE=1    skip the canonical-category assignment
#   SKIP_CANONICALIZE=1  skip the LLM canonicalIdentity pass
#   BUILD_DICTS=1        rebuild the shared dictionaries before extracting
#   SYNC=1               run deploy/sync-data.sh to push the catalog to prod at the end
#   SCRAPER_FILTER=...   restrict scrapers (substring match; see run-scrapers-worker.ts)
#   SCRAPER_CONCURRENCY / SCRAPER_TIMEOUT_MS   tune the scrape (defaults 6 / 15m)
#   DATABASE_URL         postgres URL (defaults to local)
#   ANTHROPIC_API_KEY    required for the canonicalize phase (skipped if unset)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRAPERS_DIR="${SCRAPERS_DIR:-$REPO_ROOT/scrapers}"
PY="$REPO_ROOT/ml/.venv/bin/python"
[ -x "$PY" ] || PY="python3"
export PATH="$HOME/.bun/bin:/root/.bun/bin:/usr/local/bin:$PATH"

phase() { echo; echo "==== [$(date -u +%Y-%m-%dT%H:%M:%SZ)] $* ===="; }
die()   { echo "ERROR: $*" >&2; exit 1; }

command -v bun >/dev/null 2>&1 || die "bun not found on PATH"
# mkdir is atomic on macOS and Linux. A concurrent job never imports half a run.
LOCK_DIR="$REPO_ROOT/cache/pipeline.lock"
mkdir -p "$REPO_ROOT/cache"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  old_pid=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
  if [[ "$old_pid" =~ ^[0-9]+$ ]] && ! kill -0 "$old_pid" 2>/dev/null; then
    rm "$LOCK_DIR/pid"; rmdir "$LOCK_DIR"; mkdir "$LOCK_DIR"
  else die "pipeline already running ($LOCK_DIR)"; fi
fi
printf '%s\n' "$$" > "$LOCK_DIR/pid"
trap 'rm -f "$LOCK_DIR/pid"; rmdir "$LOCK_DIR"' EXIT
phase "database migrations"
(cd "$REPO_ROOT" && go run ./cmd/migrate -seed-vendors=false) || die "migration failed"

if [ "${BUILD_DICTS:-0}" = "1" ]; then
  phase "build dictionaries"
  "$PY" "$REPO_ROOT/ml/scripts/build_dictionaries.py" || die "build_dictionaries failed"
fi

cd "$SCRAPERS_DIR" || die "SCRAPERS_DIR not found: $SCRAPERS_DIR"

if [ "${SKIP_SCRAPE:-0}" = "1" ]; then
  phase "import + postprocess (SKIP_SCRAPE=1, reusing existing CSVs)"
  bun import-csv.ts || die "import-csv failed"
  SCRAPER_RUN_DB_CLEANUP="${SCRAPER_RUN_DB_CLEANUP:-1}" bun run postprocess || die "postprocess failed"
else
  phase "scrape source snapshots"
  SCRAPE_STATUS=0
  SCRAPER_RUN_DB_CLEANUP=0 bun run-scrapers-worker.ts || SCRAPE_STATUS=$?
  if [ "$SCRAPE_STATUS" -ge 128 ]; then die "worker interrupted"; fi
  if [ "$SCRAPE_STATUS" != 0 ]; then echo "WARN: scraper failures recorded; publishing successful source snapshots" >&2; fi
  phase "import + postprocess"
  bun import-csv.ts || die "import-csv failed"
  bun run postprocess || die "postprocess failed"
fi

if [ "${SKIP_EXTRACT:-0}" != "1" ]; then
  phase "extract entities (populate_missing_data --all)"
  "$PY" "$REPO_ROOT/ml/populate_missing_data.py" --all || die "extraction failed"
fi

if [ "${SKIP_CATEGORIZE:-0}" != "1" ]; then
  phase "assign canonical categories (assign_categories)"
  # Deterministic (no API key needed); depends on the extracted brand/form/core.
  "$PY" "$REPO_ROOT/ml/scripts/assign_categories.py" || die "category assignment failed"
fi

if [ "${SKIP_CANONICALIZE:-0}" != "1" ]; then
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    phase "canonicalize identities (LLM)"
    # Enrichment only — a failure here must NOT fail the pipeline.
    "$PY" "$REPO_ROOT/ml/scripts/canonicalize_identities.py" \
      || echo "WARN: canonicalize_identities failed; continuing without it" >&2
  else
    echo "WARN: ANTHROPIC_API_KEY unset — skipping canonicalize phase" >&2
  fi
fi

phase "publish exact SKU catalog"
(cd "$REPO_ROOT" && go run -ldflags "-X main.buildVersion=$(python3 deploy/source-version.py)" . catalog-rebuild) || die "catalog rebuild failed"
phase "source health"
HEALTH_STATUS=${SCRAPE_STATUS:-0}
bun catalog-health.ts --check > "$REPO_ROOT/cache/source-health.json" || HEALTH_STATUS=$?
if [ "$HEALTH_STATUS" != 0 ]; then echo "WARN: source health needs attention; see cache/source-health.json" >&2; fi

if [ "${SYNC:-0}" = "1" ]; then
  phase "sync catalog to prod (deploy/sync-data.sh)"
  bash "$REPO_ROOT/deploy/sync-data.sh" || die "sync-data failed"
fi

phase "pipeline complete"
exit "$HEALTH_STATUS"
