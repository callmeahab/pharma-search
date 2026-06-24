# Product Enrichment

This directory is now a small enrichment toolkit, not a full ML training stack.

The production path is:
- import reviewed mappings into `ProductStandardization`
- run deterministic enrichment over `Product` (rules + the shared dictionaries in `internal/matching/data/`)

## What Remains

| File | Purpose |
|------|---------|
| `populate_missing_data.py` | Main enrichment job for `Product` and `ProductStandardization` |
| `matching_utils.py` | Shared normalization, canonical title building, and search token helpers |
| `scripts/import_standardization.py` | Imports reviewed Excel mappings into `ProductStandardization` |
| `scripts/canonicalize_identities.py` | LLM pass that writes `Product.canonicalIdentity` for bare-brand catch-all groups (formula stages, short variants). Needs `ANTHROPIC_API_KEY` |
| `scripts/build_dictionaries.py` | Rebuilds the shared dictionaries in `internal/matching/data/` |
| `test_matching_utils.py` | Regression tests for normalization helpers |
| `requirements.txt` | Runtime dependencies for rules + Excel import + canonicalize |

## Setup

```bash
cd ml
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Import Reviewed Standardization

```bash
python scripts/import_standardization.py --excel-path Aposteka_processed.xlsx
```

This is the highest-value input in the folder. Reviewed lookup rows are more useful than training scripts unless you have a proven evaluation loop.

## Enrich Products

```bash
# Dry run / sample output
python populate_missing_data.py --dry-run

# Process rows with missing data
python populate_missing_data.py

# Fill all rows again
python populate_missing_data.py --all
```

## Canonicalize Identities (LLM)

```bash
export ANTHROPIC_API_KEY=...
python scripts/canonicalize_identities.py            # full run
python scripts/canonicalize_identities.py --dry-run  # preview, no DB writes
```

Reuses the Go grouping (`cmd/groupdump -csv`) as the single source of truth, finds
bare-brand catch-all groups that over-merge distinct products, and asks Claude to
assign each product a canonical `brand + minimal-distinguishing-token` identity that
`matching.BuildGroupKey` trusts verbatim. Idempotent (clears all `canonicalIdentity`
then re-writes).

## Full Pipeline (one command)

`deploy/scrapers/run-pipeline.sh` runs the entire workflow end to end:

```
(build dicts) -> scrape -> import-csv -> postprocess -> extract -> canonicalize -> (sync)
```

```bash
# Full run (re-scrape everything, extract, canonicalize):
ANTHROPIC_API_KEY=... deploy/scrapers/run-pipeline.sh

# Re-process existing CSVs without re-scraping, then push to prod:
SKIP_SCRAPE=1 SYNC=1 ANTHROPIC_API_KEY=... deploy/scrapers/run-pipeline.sh
```

Toggles: `SKIP_SCRAPE`, `SKIP_EXTRACT`, `SKIP_CANONICALIZE`, `BUILD_DICTS`, `SYNC`.
Load-bearing phases abort on failure; canonicalize is best-effort (skipped if
`ANTHROPIC_API_KEY` is unset). This is also what should be SCHEDULED.

## Recommendation

- Treat rules + reviewed standardization + the mined dictionaries as the production pipeline.
- Per-product hard cases (formula stages, short variants) are handled by the LLM-mined `Product.canonicalIdentity` override, not by rules.
