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
| `test_matching_utils.py` | Regression tests for normalization helpers |
| `requirements.txt` | Runtime dependencies for rules + Excel import |

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

## Recommendation

- Treat rules + reviewed standardization + the mined dictionaries as the production pipeline.
- Per-product hard cases (formula stages, short variants) are handled by the LLM-mined `Product.canonicalIdentity` override, not by rules.
