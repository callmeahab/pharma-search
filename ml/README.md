# Pharma Search ML

Machine learning models for pharmaceutical product name extraction and normalization.

## Overview

This module contains NER (Named Entity Recognition) models that extract structured information from product titles:
- **BRAND** - Product brand name (e.g., "Solgar", "NOW Foods")
- **DOSAGE** - Dosage with unit (e.g., "500mg", "1000 IU")
- **FORM** - Product form (e.g., "tablete", "kapsule", "sirup")
- **QUANTITY** - Package quantity (e.g., "60 komada", "100 caps")

## Setup

### 1. Create Virtual Environment

```bash
cd ml
python -m venv venv
source venv/bin/activate  # Linux/macOS
# or
.\venv\Scripts\activate   # Windows
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Install GPU Support (Optional but Recommended)

| Platform | GPU | Command |
|----------|-----|---------|
| macOS (Apple Silicon) | Metal | `pip install spacy[apple]` |
| Windows (NVIDIA) | CUDA 12.x | `pip install spacy[cuda12x]` |
| Windows (NVIDIA) | CUDA 11.x | `pip install spacy[cuda11x]` |
| Linux (NVIDIA) | CUDA 12.x | `pip install spacy[cuda12x]` |

### 4. Download Base Model

```bash
python -m spacy download xx_ent_wiki_sm
```

## Training

Train the NER model on pharmaceutical product data:

```bash
python train_multi_ner.py
```

The script will:
1. Auto-detect GPU (Metal/CUDA) and use it if available
2. Load training data from `Aposteka_processed.xlsx`
3. Generate NER training examples
4. Train for 30 iterations
5. Save the model to `models/pharma_ner`

Training output:
- `models/pharma_ner/` - Trained spaCy model
- `training_data_multi.json` - Sample of generated training data

## Testing

Test the trained model:

```bash
python test_multi_ner.py
```

## Usage

```python
import spacy

# Load the trained model
nlp = spacy.load("models/pharma_ner")

# Process a product title
doc = nlp("Solgar Vitamin D3 2000IU 100 kapsula")

# Extract entities
for ent in doc.ents:
    print(f"{ent.label_}: {ent.text}")

# Output:
# BRAND: Solgar
# DOSAGE: 2000IU
# QUANTITY: 100 kapsula
```

## GPU Acceleration

The training script automatically detects and uses available GPU:

- **macOS**: Uses Metal (Apple Silicon) via `thinc-apple-ops`
- **Windows/Linux**: Uses CUDA via `cupy`

To verify GPU is being used, check the output at training start:
```
GPU acceleration enabled: Metal (Apple Silicon)
# or
GPU acceleration enabled: CUDA
```

## Devcontainer (Windows with NVIDIA GPU)

The devcontainer is pre-configured for CUDA support. To enable:

1. Uncomment GPU section in `.devcontainer/docker-compose.yml`:
```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: all
          capabilities: [gpu]
```

2. Rebuild the devcontainer

The post-create script will auto-install `spacy[cuda12x]` if NVIDIA GPU is detected.

## Populating Database

After training the model, use `populate_missing_data.py` to extract entities from product titles and update the database:

```bash
# Dry run - show current stats and sample extractions
python populate_missing_data.py --dry-run

# Process products with missing data
python populate_missing_data.py

# Process all products (re-extract everything)
python populate_missing_data.py --all

# Limit to 1000 products
python populate_missing_data.py --limit 1000

# Skip updating ProductStandardization table
python populate_missing_data.py --no-standardization
```

The script updates:
- **Product table**: `extractedBrand`, `form`, `dosageValue`, `dosageUnit`, `quantityValue`, `quantityUnit`
- **ProductStandardization table**: Creates lookup entries for future matching

## Files

| File | Description |
|------|-------------|
| `train_multi_ner.py` | Main training script |
| `test_multi_ner.py` | Model testing script |
| `populate_missing_data.py` | Database population script |
| `batch_processor.py` | Legacy batch processor (dosage only) |
| `requirements.txt` | Python dependencies |
| `Aposteka_processed.xlsx` | Training data source |
| `models/pharma_ner/` | Trained model output |
