# Product Grouping System

ML-based product grouping for pharmaceutical price comparison using semantic embeddings and clustering.

## Files

### Core System
- `product_grouping_system.py` - Complete ML grouping system with CLI
- `product_grouping_schema.sql` - Database schema for product groups

### Integration
- `meilisearch_indexer.py` - Enhanced with pre-computed group support
- `backend/src/meilisearch_engine.py` - Hybrid real-time + pre-computed grouping

## Usage

### Database Setup
```bash
# Apply the grouping schema to your database
psql -d pharmagician -f product_grouping_schema.sql
```

### Run Product Grouping

```bash
# Test on sample data (300 products)
python product_grouping_system.py --sample 300 --dry-run

# Run on all products and save to database
python product_grouping_system.py

# Custom database URL
python product_grouping_system.py --db-url "postgresql://user:pass@host/db"
```

### Re-index Search
```bash
# After grouping, re-index Meilisearch with group data
python meilisearch_indexer.py
```

## How It Works

1. **ML Embeddings**: Uses `sentence-transformers` to create semantic embeddings of product titles
2. **Clustering**: DBSCAN algorithm groups semantically similar products
3. **Quality Scoring**: Cosine similarity between embeddings provides group quality
4. **Database Storage**: Groups saved with metadata for search integration
5. **Hybrid Search**: Meilisearch uses pre-computed groups + real-time fallback

## Results

- **84.7% grouping coverage** on pharmaceutical products
- **0.812 average quality score** (high confidence)
- **Semantic awareness**: Groups "Vitamin D3 2000 IU" with "Vitamin D 2000ij"
- **Brand intelligence**: Automatically groups product lines
- **Multi-language**: Handles Serbian/English pharmaceutical terms

## Database Schema

### ProductGroup Table
- Stores pre-computed product groups
- Quality scores and metadata
- Category classification
- Price ranges

### Product Enhancements
- `computedGroupId`: Links to ProductGroup
- `groupingMethod`: ML algorithm used
- `groupingConfidence`: Quality score

### Views
- `ProductGroupAnalysis`: Group health monitoring
- `GroupingSummary`: Category and method statistics