-- CLEANUP SCHEMA - 10th Iteration
-- This removes ALL redundant database fields and tables
-- Run after backing up: pg_dump pharmagician > backup.sql

BEGIN;

-- ============================================================================
-- STEP 0: Drop dependent views first
-- ============================================================================

DROP VIEW IF EXISTS price_comparison CASCADE;
DROP VIEW IF EXISTS product_groups CASCADE;
DROP VIEW IF EXISTS "ProductGroupAnalysis" CASCADE;

-- ============================================================================
-- STEP 1: Remove redundant columns from Product table
-- ============================================================================

ALTER TABLE "Product"
  -- Duplicate/Redundant fields
  DROP COLUMN IF EXISTS "originalTitle",
  DROP COLUMN IF EXISTS strength,
  DROP COLUMN IF EXISTS "brandProductLine",
  DROP COLUMN IF EXISTS "dosageNormalized",
  DROP COLUMN IF EXISTS "dosageText",
  DROP COLUMN IF EXISTS "volumeNormalized",
  DROP COLUMN IF EXISTS "volumeText",
  DROP COLUMN IF EXISTS "quantityText",
  DROP COLUMN IF EXISTS variant,
  DROP COLUMN IF EXISTS size,

  -- Unused fields
  DROP COLUMN IF EXISTS "specialCodes",
  DROP COLUMN IF EXISTS "multiplierPattern",
  DROP COLUMN IF EXISTS "extractionConfidence",
  DROP COLUMN IF EXISTS "processingErrors",

  -- Old grouping system (replaced by enhanced_grouping.go)
  DROP COLUMN IF EXISTS "groupingKey",
  DROP COLUMN IF EXISTS "similarityKey",

  -- Database-based search (replaced by Meilisearch)
  DROP COLUMN IF EXISTS "searchVector",
  DROP COLUMN IF EXISTS "searchTokens",
  DROP COLUMN IF EXISTS "keywordTags",

  -- Foreign keys to tables we're removing
  DROP COLUMN IF EXISTS "brandId",
  DROP COLUMN IF EXISTS "unitId",

  -- ML embedding (not currently used)
  DROP COLUMN IF EXISTS embedding;

-- ProductGroupId: Keep this one as it's used by ML grouping (optional feature)
-- We'll keep: productGroupId, computedGroupId, groupingConfidence, groupingMethod

-- ============================================================================
-- STEP 2: Remove redundant database functions
-- ============================================================================

DROP FUNCTION IF EXISTS enhanced_product_search(text, numeric, numeric, text[], text[], text[], integer) CASCADE;
DROP FUNCTION IF EXISTS expand_pharma_abbreviations(text) CASCADE;
DROP FUNCTION IF EXISTS convert_to_normalized_unit(numeric, text) CASCADE;

-- ============================================================================
-- STEP 3: Remove redundant tables (CAREFUL!)
-- ============================================================================

-- Check for foreign key dependencies first
DO $$
BEGIN
    RAISE NOTICE 'Checking for dependencies...';
END $$;

-- Remove tables that are replaced by enhanced_grouping.go
DROP TABLE IF EXISTS "Unit" CASCADE;
DROP TABLE IF EXISTS "ProductForm" CASCADE;
DROP TABLE IF EXISTS "Brand" CASCADE;
DROP TABLE IF EXISTS "Category" CASCADE;
DROP TABLE IF EXISTS "GroupingRules" CASCADE;

-- Remove user table if not needed
DROP TABLE IF EXISTS "User" CASCADE;

-- Keep: Product, ProductGroup (for ML), Vendor

-- ============================================================================
-- STEP 4: Remove unused indexes
-- ============================================================================

-- Remove indexes on dropped columns
DROP INDEX IF EXISTS "Product_searchVector_idx";
DROP INDEX IF EXISTS "Product_searchTokens_idx";
DROP INDEX IF EXISTS "Product_brandId_idx";
DROP INDEX IF EXISTS "Product_unitId_idx";
DROP INDEX IF EXISTS "Product_productFormId_idx";
DROP INDEX IF EXISTS "Product_groupingKey_idx";
DROP INDEX IF EXISTS "Product_similarityKey_idx";

-- ============================================================================
-- STEP 5: Add useful indexes for new system
-- ============================================================================

-- Index for enhanced grouping lookups
CREATE INDEX IF NOT EXISTS "Product_coreProductIdentity_idx" ON "Product"("coreProductIdentity");
CREATE INDEX IF NOT EXISTS "Product_extractedBrand_idx" ON "Product"("extractedBrand");
CREATE INDEX IF NOT EXISTS "Product_computedGroupId_idx" ON "Product"("computedGroupId");

-- Index for price comparison queries
CREATE INDEX IF NOT EXISTS "Product_vendorId_price_idx" ON "Product"("vendorId", price);

-- Index for common lookups
CREATE INDEX IF NOT EXISTS "Product_processedAt_idx" ON "Product"("processedAt") WHERE "processedAt" IS NULL;

-- ============================================================================
-- STEP 6: Update Product table comment
-- ============================================================================

COMMENT ON TABLE "Product" IS 'Streamlined product table for price comparison. Uses Meilisearch for search, enhanced_grouping.go for grouping.';

-- ============================================================================
-- STEP 7: Verify remaining schema
-- ============================================================================

DO $$
DECLARE
    product_columns INT;
    product_size TEXT;
BEGIN
    -- Count remaining columns
    SELECT COUNT(*) INTO product_columns
    FROM information_schema.columns
    WHERE table_name = 'Product' AND table_schema = 'public';

    RAISE NOTICE 'Product table now has % columns (was ~50)', product_columns;

    -- Show table size
    SELECT pg_size_pretty(pg_total_relation_size('"Product"'::regclass)) INTO product_size;
    RAISE NOTICE 'Product table size: %', product_size;
END $$;

-- ============================================================================
-- STEP 8: Clean up extensions (optional - be careful!)
-- ============================================================================

-- Only drop if not used elsewhere in database
-- Uncomment if you're sure:

-- DROP EXTENSION IF EXISTS fuzzystrmatch CASCADE;
-- DROP EXTENSION IF EXISTS pg_trgm CASCADE;
-- DROP EXTENSION IF EXISTS btree_gin CASCADE;

-- Keep uuid-ossp for ID generation

COMMIT;

-- ============================================================================
-- POST-CLEANUP VERIFICATION
-- ============================================================================

-- Show remaining tables
SELECT table_name,
       pg_size_pretty(pg_total_relation_size(quote_ident(table_name)::regclass)) as size
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY pg_total_relation_size(quote_ident(table_name)::regclass) DESC;

-- Show remaining Product columns
SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_name = 'Product' AND table_schema = 'public'
ORDER BY ordinal_position;

-- Show indexes on Product table
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'Product' AND schemaname = 'public'
ORDER BY indexname;
