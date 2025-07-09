-- Database migration for enhanced product grouping
-- Run this script to add necessary columns and indexes

-- Enable extensions for better search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Add new columns to ProductGroup for enhanced grouping
ALTER TABLE "ProductGroup" 
ADD COLUMN IF NOT EXISTS "similarityKey" TEXT,
ADD COLUMN IF NOT EXISTS "coreProductIdentity" TEXT,
ADD COLUMN IF NOT EXISTS "dosageRange" TEXT,
ADD COLUMN IF NOT EXISTS "formCategory" TEXT,
ADD COLUMN IF NOT EXISTS "avgPrice" DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS "minPrice" DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS "maxPrice" DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS "vendorCount" INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS "mergedFromGroups" TEXT[],
ADD COLUMN IF NOT EXISTS "lastMergeDate" TIMESTAMP;

-- Add new columns to Product for enhanced processing
ALTER TABLE "Product" 
ADD COLUMN IF NOT EXISTS "coreProductIdentity" TEXT,
ADD COLUMN IF NOT EXISTS "similarityKey" TEXT,
ADD COLUMN IF NOT EXISTS "formCategory" TEXT,
ADD COLUMN IF NOT EXISTS "dosageRange" TEXT;

-- Create indexes for better performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_similarity_key" 
ON "Product" ("similarityKey") WHERE "similarityKey" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_core_identity" 
ON "Product" ("coreProductIdentity") WHERE "coreProductIdentity" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_dosage_range" 
ON "Product" ("dosageRange") WHERE "dosageRange" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_productgroup_similarity_key" 
ON "ProductGroup" ("similarityKey") WHERE "similarityKey" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_productgroup_core_identity" 
ON "ProductGroup" ("coreProductIdentity") WHERE "coreProductIdentity" IS NOT NULL;

-- Trigram indexes for fuzzy searching
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_title_trgm" 
ON "Product" USING gin (title gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_normalized_trgm" 
ON "Product" USING gin ("normalizedName" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_brand_name_trgm" 
ON "Brand" USING gin (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_productgroup_normalized_trgm" 
ON "ProductGroup" USING gin ("normalizedName" gin_trgm_ops);

-- GIN indexes for array searching
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_search_tokens_gin" 
ON "Product" USING gin ("searchTokens");

-- Composite indexes for common query patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_vendor_group" 
ON "Product" ("vendorId", "productGroupId") WHERE "productGroupId" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_price_group" 
ON "Product" ("productGroupId", "price") WHERE "productGroupId" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_vendor_price" 
ON "Product" ("vendorId", "price");

-- Case-insensitive text search indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_title_lower" 
ON "Product" (lower(title));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_normalized_lower" 
ON "Product" (lower("normalizedName")) WHERE "normalizedName" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_brand_name_lower" 
ON "Brand" (lower(name));

-- Create materialized view for fast group statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS "ProductGroupStats" AS
SELECT 
    pg.id,
    pg."normalizedName",
    pg."groupKey",
    pg."similarityKey",
    pg."coreProductIdentity",
    pg."productCount",
    COUNT(DISTINCT p."vendorId") as vendor_count,
    MIN(p.price) as min_price,
    MAX(p.price) as max_price,
    AVG(p.price) as avg_price,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY p.price) as median_price,
    array_agg(DISTINCT p."vendorId") as vendor_ids,
    array_agg(DISTINCT b.name) FILTER (WHERE b.name IS NOT NULL) as brands,
    pg."createdAt",
    pg."updatedAt"
FROM "ProductGroup" pg
JOIN "Product" p ON p."productGroupId" = pg.id
LEFT JOIN "Brand" b ON p."brandId" = b.id
GROUP BY pg.id, pg."normalizedName", pg."groupKey", pg."similarityKey", 
         pg."coreProductIdentity", pg."productCount", pg."createdAt", pg."updatedAt";

-- Create unique index on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS "idx_productgroupstats_id" 
ON "ProductGroupStats" (id);

-- Create indexes on materialized view for fast queries
CREATE INDEX IF NOT EXISTS "idx_productgroupstats_product_count" 
ON "ProductGroupStats" ("productCount" DESC);

CREATE INDEX IF NOT EXISTS "idx_productgroupstats_vendor_count" 
ON "ProductGroupStats" ("vendor_count" DESC);

CREATE INDEX IF NOT EXISTS "idx_productgroupstats_core_identity" 
ON "ProductGroupStats" ("coreProductIdentity") WHERE "coreProductIdentity" IS NOT NULL;

-- Function to refresh materialized view
CREATE OR REPLACE FUNCTION refresh_product_group_stats()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY "ProductGroupStats";
END;
$$ LANGUAGE plpgsql;

-- Function to update group statistics
CREATE OR REPLACE FUNCTION update_group_stats(group_id TEXT)
RETURNS void AS $$
BEGIN
    UPDATE "ProductGroup"
    SET 
        "productCount" = (
            SELECT COUNT(*) 
            FROM "Product" 
            WHERE "productGroupId" = group_id
        ),
        "vendorCount" = (
            SELECT COUNT(DISTINCT "vendorId") 
            FROM "Product" 
            WHERE "productGroupId" = group_id
        ),
        "minPrice" = (
            SELECT MIN(price) 
            FROM "Product" 
            WHERE "productGroupId" = group_id
        ),
        "maxPrice" = (
            SELECT MAX(price) 
            FROM "Product" 
            WHERE "productGroupId" = group_id
        ),
        "avgPrice" = (
            SELECT AVG(price) 
            FROM "Product" 
            WHERE "productGroupId" = group_id
        ),
        "updatedAt" = NOW()
    WHERE id = group_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update group stats when products change
CREATE OR REPLACE FUNCTION update_group_stats_trigger()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD."productGroupId" IS DISTINCT FROM NEW."productGroupId" THEN
            -- Group changed, update both old and new groups
            IF OLD."productGroupId" IS NOT NULL THEN
                PERFORM update_group_stats(OLD."productGroupId");
            END IF;
            IF NEW."productGroupId" IS NOT NULL THEN
                PERFORM update_group_stats(NEW."productGroupId");
            END IF;
        ELSIF OLD.price IS DISTINCT FROM NEW.price AND NEW."productGroupId" IS NOT NULL THEN
            -- Price changed, update group stats
            PERFORM update_group_stats(NEW."productGroupId");
        END IF;
    ELSIF TG_OP = 'INSERT' AND NEW."productGroupId" IS NOT NULL THEN
        PERFORM update_group_stats(NEW."productGroupId");
    ELSIF TG_OP = 'DELETE' AND OLD."productGroupId" IS NOT NULL THEN
        PERFORM update_group_stats(OLD."productGroupId");
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-updating group stats
DROP TRIGGER IF EXISTS product_group_stats_trigger ON "Product";
CREATE TRIGGER product_group_stats_trigger
    AFTER INSERT OR UPDATE OR DELETE ON "Product"
    FOR EACH ROW
    EXECUTE FUNCTION update_group_stats_trigger();

-- Create view for easy price comparison queries
CREATE OR REPLACE VIEW "PriceComparisonView" AS
SELECT 
    pg.id as group_id,
    pg."normalizedName" as product_name,
    pg."coreProductIdentity",
    pg."dosageValue",
    pg."dosageUnit",
    p.id as product_id,
    p.title,
    p.price,
    p.link,
    p.thumbnail,
    v.name as vendor_name,
    v.website as vendor_website,
    b.name as brand_name,
    p."createdAt",
    p."updatedAt",
    -- Price comparison metrics
    p.price - pg."avgPrice" as price_diff_from_avg,
    CASE 
        WHEN pg."maxPrice" - pg."minPrice" > 0 
        THEN (p.price - pg."minPrice") / (pg."maxPrice" - pg."minPrice") * 100 
        ELSE 0 
    END as price_percentile,
    pg."vendorCount",
    pg."productCount"
FROM "ProductGroup" pg
JOIN "Product" p ON p."productGroupId" = pg.id
JOIN "Vendor" v ON p."vendorId" = v.id
LEFT JOIN "Brand" b ON p."brandId" = b.id
WHERE pg."productCount" > 1  -- Only show groups with multiple products for comparison
ORDER BY pg."productCount" DESC, p.price;

-- Create indexes on the price comparison view
CREATE INDEX IF NOT EXISTS "idx_price_comparison_group_price" 
ON "Product" ("productGroupId", "price") WHERE "productGroupId" IS NOT NULL;

-- Add helpful comments
COMMENT ON COLUMN "ProductGroup"."similarityKey" IS 'Key for grouping similar products across brands';
COMMENT ON COLUMN "ProductGroup"."coreProductIdentity" IS 'Core product identity for aggressive grouping';
COMMENT ON COLUMN "ProductGroup"."dosageRange" IS 'Dosage range category for flexible grouping';
COMMENT ON COLUMN "ProductGroup"."vendorCount" IS 'Number of different vendors selling this product';
COMMENT ON COLUMN "ProductGroup"."mergedFromGroups" IS 'Array of group IDs that were merged into this group';

COMMENT ON MATERIALIZED VIEW "ProductGroupStats" IS 'Materialized view with pre-calculated group statistics for fast queries';
COMMENT ON VIEW "PriceComparisonView" IS 'View optimized for price comparison queries';

-- Create summary statistics view
CREATE OR REPLACE VIEW "GroupingSummary" AS
SELECT 
    COUNT(*) as total_products,
    COUNT(DISTINCT "productGroupId") as total_groups,
    AVG(group_stats.product_count) as avg_products_per_group,
    AVG(group_stats.vendor_count) as avg_vendors_per_group,
    COUNT(*) FILTER (WHERE group_stats.vendor_count > 1) as groups_with_multiple_vendors,
    COUNT(*) FILTER (WHERE group_stats.vendor_count = 1) as single_vendor_groups,
    ROUND(
        COUNT(*) FILTER (WHERE group_stats.vendor_count > 1) * 100.0 / 
        NULLIF(COUNT(DISTINCT "productGroupId"), 0), 2
    ) as multi_vendor_percentage
FROM "Product" p
JOIN (
    SELECT 
        "productGroupId",
        COUNT(*) as product_count,
        COUNT(DISTINCT "vendorId") as vendor_count
    FROM "Product"
    WHERE "productGroupId" IS NOT NULL
    GROUP BY "productGroupId"
) group_stats ON p."productGroupId" = group_stats."productGroupId"
WHERE p."productGroupId" IS NOT NULL;

-- Initial data migration (optional - run if you want to update existing data)
-- This will be handled by the enhanced processor, but you can run it manually:

/*
-- Reset processing status to reprocess with new grouping
UPDATE "Product" SET "processedAt" = NULL WHERE "processedAt" IS NOT NULL;

-- Clear old groups to rebuild with new logic
DELETE FROM "ProductGroup";

-- Note: After running this, you'll need to run the enhanced processor to rebuild groups
*/
