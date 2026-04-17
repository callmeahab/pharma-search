# Product Enrichment

This directory is now a small enrichment toolkit, not a full ML training stack.

The production path is:
- import reviewed mappings into `ProductStandardization`
- run deterministic enrichment over `Product`
- optionally load a pre-trained spaCy model if you already have one

## What Remains

| File | Purpose |
|------|---------|
| `populate_missing_data.py` | Main enrichment job for `Product` and `ProductStandardization` |
| `matching_utils.py` | Shared normalization, canonical title building, and search token helpers |
| `scripts/import_standardization.py` | Imports reviewed Excel mappings into `ProductStandardization` |
| `test_matching_utils.py` | Regression tests for normalization helpers |
| `requirements.txt` | Runtime dependencies for rules + Excel import |
| `requirements-ml.txt` | Optional extra dependency if you want spaCy model support |

## Setup

```bash
cd ml
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

If you have a compatible saved spaCy model and want to use it as a secondary signal:

```bash
pip install -r requirements-ml.txt
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

# Recommended production mode
python populate_missing_data.py --rules-only

# Fill all rows again
python populate_missing_data.py --all --rules-only

# Use an optional local spaCy model if present under ml/models/pharma_ner
python populate_missing_data.py
```

## Recommendation

- Treat rules + reviewed standardization as the default production pipeline.
- Treat spaCy support as optional and experimental.
- If you want ML back later, add it only after you have a held-out benchmark showing it improves ambiguous brand/core-identity extraction.
