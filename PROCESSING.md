# Product Processing with Go Backend

This document describes how to use the Go backend for product processing, replacing the previous Python-based processing system.

## Available Commands

The `pharma-server` binary now includes CLI commands for product processing:

### Basic Commands

- `./pharma-server` - Start the gRPC server (default behavior)
- `./pharma-server stats` - Show processing statistics and progress
- `./pharma-server analyze` - Analyze grouping effectiveness for price comparison
- `./pharma-server process` - Process unprocessed products with normalization
- `./pharma-server reprocess-all` - Reprocess ALL products (reset & reprocess)
- `./pharma-server index` - Index products to Meilisearch search engine

### Command Examples

```bash
# Check processing status
./pharma-server stats

# Process new products
./pharma-server process --batch-size=5000

# Reprocess everything (useful after algorithm changes)
./pharma-server reprocess-all

# Update search index
./pharma-server index --batch-size=1000

# Analyze grouping effectiveness
./pharma-server analyze
```

## Features

### Product Normalization
- Extracts product attributes (brand, dosage, volume, form, SPF, etc.)
- Creates normalized product names for better grouping
- Generates search tokens for full-text search
- Creates core product identities for price comparison

### Price Comparison Grouping
- Groups similar products across vendors for price comparison
- Uses intelligent dosage ranges instead of exact matching
- Handles product variants (e.g., "Vitamin D3" = "Vitamin D")
- Creates both exact and similarity grouping keys

### Search Indexing
- Indexes products to Meilisearch with enriched metadata
- Configures faceted search (brand, category, form, price ranges)
- Sets up synonyms and searchable attributes
- Enables filtering and sorting capabilities

### Analytics
- Processing statistics and progress tracking
- Grouping effectiveness analysis
- Price comparison potential metrics
- Performance recommendations

## Migration from Python

The Go backend replaces the following Python scripts:

- ✅ `reprocess_all_enhanced.py` → `./pharma-server reprocess-all`
- ✅ `product_grouping_system.py` → Built into processor (no ML dependency)
- ✅ `meilisearch_indexer.py` → `./pharma-server index`
- ✅ `monitor_processing.py` → `./pharma-server stats`
- ✅ `backend/src/product_processor.py` → Built into processor
- ✅ `backend/src/normalizer.py` → Built into normalizer

### Benefits of Migration

1. **No Python Dependencies**: No need for pandas, scikit-learn, sentence-transformers, etc.
2. **Better Performance**: Faster processing with Go's concurrency
3. **Single Binary**: Everything in one executable
4. **Memory Efficient**: Lower memory usage for large datasets
5. **Easy Deployment**: No virtual environments or dependency management

### Differences from Python Version

1. **No ML Grouping**: The Go version uses rule-based grouping instead of ML embeddings for better performance and fewer dependencies
2. **Simplified Pipeline**: Streamlined processing without complex ML preprocessing
3. **Better Error Handling**: More robust error handling and recovery
4. **Progress Tracking**: Built-in progress bars and statistics

## Database Schema

The Go processor works with the existing database schema and populates these key fields:

- `normalizedName` - Normalized product name for grouping
- `searchTokens` - Array of search tokens for matching
- `searchVector` - PostgreSQL tsvector for full-text search
- `extractedBrand` - Extracted brand name
- `productLine` - Core product name without brand/dosage
- `dosageValue/dosageUnit` - Extracted dosage information
- `volumeValue/volumeUnit` - Extracted volume/weight information
- `form` - Product form (tablet, capsule, cream, etc.)
- `spfValue` - SPF value for sun protection products
- `coreProductIdentity` - Core identity for price comparison

## Performance

Current processing performance on the test dataset:

- **149,283 products** processed
- **100% processing completeness**
- **79,860 unique product groups** created  
- **18% price comparison potential** (14,340 multi-vendor groups)
- **1.87 average products per group**
- **1.39 average vendors per group**

The system can process approximately 1,000-5,000 products per second depending on hardware.

## Monitoring

Use `./pharma-server stats` to monitor processing progress:

```
📊 Processing Statistics
==================================================
Progress Overview:
  Processed: [██████████████████████████████] 100.0% (149283/149283)
  Normalized: [██████████████████████████████] 100.0% (149283/149283)
  Tokenized: [██████████████████████████████] 100.0% (149283/149283)
  Vectorized: [██████████████████████████████] 100.0% (149283/149283)

💡 Recommendations:
  ✅ All products successfully processed!
  • Run 'index' command to update Meilisearch index
  • Run 'analyze' command for grouping effectiveness analysis
```

## Troubleshooting

### Common Issues

1. **Database Connection**: Ensure `DATABASE_URL` environment variable is set
2. **Meilisearch Connection**: Ensure `MEILI_URL` and `MEILI_API_KEY` are set for indexing
3. **Memory Usage**: Use smaller batch sizes if running out of memory
4. **Progress Monitoring**: Use `stats` command to check processing status

### Environment Variables

```bash
export DATABASE_URL="postgresql://postgres:password@localhost:5432/pharmagician"
export MEILI_URL="http://127.0.0.1:7700"
export MEILI_API_KEY="your-api-key-here"
```

### Logs

The Go backend provides structured logging for all operations. Check logs for detailed error information if commands fail.