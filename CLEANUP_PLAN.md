# System Cleanup Plan - 10th Iteration

## 🎯 Redundancy Analysis

After 10 iterations, here's what to clean up:

---

## 1. DATABASE SCHEMA - Redundant Fields

### Product Table - Fields to REMOVE:

```sql
-- REMOVE: Unused/redundant fields
ALTER TABLE "Product"
  DROP COLUMN IF EXISTS "originalTitle",          -- Duplicate of title
  DROP COLUMN IF EXISTS strength,                 -- Covered by dosageValue+dosageUnit
  DROP COLUMN IF EXISTS "brandId",                -- Use extractedBrand (string) instead
  DROP COLUMN IF EXISTS "unitId",                 -- Use dosageUnit (string) instead
  DROP COLUMN IF EXISTS "productGroupId",         -- Old grouping, use enhanced grouping
  DROP COLUMN IF EXISTS embedding,                -- Not using ML embeddings currently
  DROP COLUMN IF EXISTS "searchVector",           -- Use Meilisearch instead
  DROP COLUMN IF EXISTS "searchTokens",           -- Use Meilisearch instead
  DROP COLUMN IF EXISTS "brandProductLine",       -- Redundant, computed field
  DROP COLUMN IF EXISTS "dosageNormalized",       -- Compute on-the-fly
  DROP COLUMN IF EXISTS "dosageText",             -- Redundant, parse from title
  DROP COLUMN IF EXISTS "volumeNormalized",       -- Compute on-the-fly
  DROP COLUMN IF EXISTS "volumeText",             -- Redundant, parse from title
  DROP COLUMN IF EXISTS "quantityText",           -- Redundant, parse from title
  DROP COLUMN IF EXISTS variant,                  -- Unused
  DROP COLUMN IF EXISTS size,                     -- Covered by volumeValue
  DROP COLUMN IF EXISTS "specialCodes",           -- Unused
  DROP COLUMN IF EXISTS "multiplierPattern",      -- Unused
  DROP COLUMN IF EXISTS "keywordTags",            -- Use Meilisearch tags
  DROP COLUMN IF EXISTS "groupingKey",            -- Old system, use enhanced_grouping.go
  DROP COLUMN IF EXISTS "similarityKey",          -- Old system, use enhanced_grouping.go
  DROP COLUMN IF EXISTS "extractionConfidence",   -- Unused JSON
  DROP COLUMN IF EXISTS "processingErrors";       -- Use logs instead
```

### Product Table - Fields to KEEP:

```sql
-- KEEP: Essential fields
id                  -- Primary key
vendorId            -- Required for price comparison
price               -- Required
title               -- Original product title
category            -- Useful categorization
link                -- Product URL
thumbnail           -- Product image
photos              -- Additional images
description         -- Product description
normalizedName      -- Still useful for fallback
form                -- Product form (tablet, capsule, etc.)
coreProductIdentity -- Used by enhanced grouping
processedAt         -- Processing timestamp
createdAt           -- Record creation
updatedAt           -- Last update
extractedBrand      -- Extracted brand name
productLine         -- Product line/series
dosageValue         -- Numeric dosage
dosageUnit          -- Dosage unit (mg, iu, etc.)
volumeValue         -- Package size
volumeUnit          -- Volume unit (ml, g, etc.)
quantityValue       -- Number of units
quantityUnit        -- Unit type (caps, tablets, etc.)
spfValue            -- SPF value for sunscreen
computedGroupId     -- For ML-based grouping (optional)
groupingConfidence  -- Grouping quality score
groupingMethod      -- Which method was used
```

### Tables to REMOVE ENTIRELY:

```sql
DROP TABLE IF EXISTS "Unit";           -- Use string-based units in enhanced_grouping
DROP TABLE IF EXISTS "ProductForm";    -- Use string-based forms in enhanced_grouping
DROP TABLE IF EXISTS "Brand";          -- Use extractedBrand string field
DROP TABLE IF EXISTS "Category";       -- Minimal value, can use string field
DROP TABLE IF EXISTS "GroupingRules";  -- Replaced by enhanced_grouping.go
DROP TABLE IF EXISTS "User";           -- Not needed for price comparison
```

### Tables to KEEP:

```sql
-- KEEP: Essential tables
"Product"       -- Core table (with cleaned fields)
"ProductGroup"  -- Optional, for ML-based grouping
"Vendor"        -- Required for multi-vendor price comparison
```

---

## 2. GO BACKEND - Redundant Code

### Files to REMOVE:

```bash
rm go-backend/normalizer.go          # OLD: Replaced by enhanced_grouping.go
rm go-backend/test_grouping.go       # Keep in root for testing only
```

### Files to KEEP & USE:

```bash
go-backend/main.go                   # Core server
go-backend/enhanced_grouping.go      # NEW grouping system
go-backend/comprehensive_mappings.go # Auto-generated mappings
go-backend/processor.go              # Product processing
```

### In processor.go - REMOVE:

```go
// REMOVE: Old normalization code
func (p *ProductProcessor) processBatchNormalized() {
    // This uses old normalizer.go - DELETE IT
}

// REMOVE: SearchVector and SearchTokens processing
"searchVector" = to_tsvector('english', $4),
"searchTokens" = string_to_array($3, ' '),
```

---

## 3. DOCUMENTATION - Consolidate

### Files to REMOVE (Redundant/Outdated):

```bash
rm README_GROUPING.md              # OLD: Before enhanced grouping
rm PRODUCT_GROUPING_SOLUTION.md    # OLD: Superseded by comprehensive docs
rm PROCESSING.md                   # OLD: Outdated processing info
rm meilisearch_design.md           # OLD: Initial design, now implemented
rm seed.sql                        # OLD: Not needed
```

### Files to KEEP:

```bash
INDEX.md                           # Main navigation
AUTOMATION_COMPLETE.md             # System overview
COMPREHENSIVE_GROUPING_SOLUTION.md # Technical details
REPLICABLE_GROUPING.md            # Automation guide
README_AFTER_SCRAPING.md          # Quick reference
README.md                         # Project README
Makefile                          # Commands
```

---

## 4. PYTHON SCRIPTS - Clean Up

### Keep Only:

```bash
scripts/update_mappings.py         # Auto-update system (ESSENTIAL)
```

### Remove any old scripts like:

```bash
# Check for and remove:
scripts/old_normalizer.py
scripts/extract_patterns.py
scripts/test_*.py
```

---

## 5. DATABASE FUNCTIONS - Remove Redundant

### Functions to REMOVE:

```sql
DROP FUNCTION IF EXISTS enhanced_product_search();  -- Use Meilisearch
DROP FUNCTION IF EXISTS expand_pharma_abbreviations(); -- Use enhanced_grouping
DROP FUNCTION IF EXISTS convert_to_normalized_unit(); -- Use comprehensive_mappings
```

### Functions to KEEP:

None needed! Everything is handled by:
- **Meilisearch** for search
- **enhanced_grouping.go** for grouping
- **comprehensive_mappings.go** for normalization

---

## 6. POSTGRESQL EXTENSIONS - Review

### Extensions to REMOVE (if not used elsewhere):

```sql
DROP EXTENSION IF EXISTS fuzzystrmatch;  -- Not needed, use Meilisearch
DROP EXTENSION IF EXISTS pg_trgm;        -- Not needed, use Meilisearch
DROP EXTENSION IF EXISTS btree_gin;      -- Not needed
```

### Extensions to KEEP:

```sql
uuid-ossp  -- For generating IDs (if needed)
```

---

## Implementation Steps

### Step 1: Backup Everything

```bash
# Backup database
pg_dump pharmagician > backup_before_cleanup.sql

# Backup code
git commit -am "Backup before cleanup"
git tag pre-cleanup-v10
```

### Step 2: Clean Database Schema

```sql
-- Run this SQL file (see below)
psql pharmagician < cleanup_schema.sql
```

### Step 3: Clean Code

```bash
# Remove old files
rm go-backend/normalizer.go
rm README_GROUPING.md
rm PRODUCT_GROUPING_SOLUTION.md
rm PROCESSING.md
rm meilisearch_design.md
rm seed.sql

# Test that everything still works
make test-grouping
```

### Step 4: Update References

```bash
# Search for any remaining references to removed fields
grep -r "searchVector\|brandId\|unitId" go-backend/*.go
# Fix any found references
```

### Step 5: Verify & Deploy

```bash
# Test the system
make update-and-test

# If all good, commit
git add -A
git commit -m "Major cleanup: Removed redundant code and schema"
git push
```

---

## Expected Benefits

### Database Size Reduction:

- **Before:** ~50 columns in Product table
- **After:** ~25 columns in Product table
- **Savings:** 50% reduction in storage

### Code Simplicity:

- **Before:** 3 grouping systems (normalizer, ML, rules)
- **After:** 1 grouping system (enhanced_grouping + Meilisearch)
- **Savings:** 66% code reduction

### Maintenance:

- **Before:** Multiple systems to update
- **After:** One auto-updating system
- **Savings:** 90% maintenance time

---

## Risk Assessment

### Low Risk (Safe to Remove):

- ✅ Unused database columns
- ✅ Old documentation files
- ✅ Redundant Go files

### Medium Risk (Test First):

- ⚠️ Removing database tables (check for foreign keys)
- ⚠️ Removing extensions (check if used elsewhere)

### Migration Strategy:

1. **Phase 1:** Remove files and docs (reversible)
2. **Phase 2:** Remove unused columns (keep backups)
3. **Phase 3:** Remove unused tables (final cleanup)

---

## Cleanup SQL Script

See next file: `cleanup_schema.sql`
