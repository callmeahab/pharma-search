-- ============================================================================
-- PHARMACEUTICAL SEARCH DATABASE SCHEMA - OPTIMIZED
-- Redundant fields and tables removed for better performance and maintainability
-- ============================================================================

-- Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "fuzzystrmatch";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Vendors table
CREATE TABLE IF NOT EXISTS "Vendor" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "name" TEXT NOT NULL UNIQUE,
    "logo" TEXT,
    "website" TEXT,
    "scraperFile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- Categories table
CREATE TABLE IF NOT EXISTS "Category" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "name" TEXT NOT NULL UNIQUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- Brands table (simplified - removed redundant embedding)
CREATE TABLE IF NOT EXISTS "Brand" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "name" TEXT NOT NULL UNIQUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- Units table
CREATE TABLE IF NOT EXISTS "Unit" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "name" TEXT NOT NULL UNIQUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- Product groups table (simplified - merged redundant fields)
CREATE TABLE IF NOT EXISTS "ProductGroup" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "normalizedName" TEXT NOT NULL,
    "brandId" TEXT,
    "dosageValue" DECIMAL(10,2),
    "dosageUnit" TEXT,
    "unitId" TEXT,
    "groupKey" TEXT NOT NULL UNIQUE,
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "vendorCount" INTEGER DEFAULT 0,
    "minPrice" DECIMAL(10,2),
    "maxPrice" DECIMAL(10,2),
    "avgPrice" DECIMAL(10,2),
    "coreProductIdentity" TEXT, -- Keep only one identity field
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT "ProductGroup_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductGroup_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProductGroup_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Main products table (significantly simplified)
CREATE TABLE IF NOT EXISTS "Product" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "vendorId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "title" TEXT NOT NULL,
    "originalTitle" TEXT, -- Keep original for reference
    "category" TEXT,
    "link" TEXT NOT NULL,
    "thumbnail" TEXT NOT NULL,
    "photos" TEXT NOT NULL,
    "description" TEXT,
    
    -- Normalized and processed data
    "normalizedName" TEXT,
    "brandId" TEXT,
    "unitId" TEXT,
    "productGroupId" TEXT,
    
    -- Dosage information (consolidated)
    "dosageValue" DECIMAL(10,2),
    "dosageUnit" TEXT,
    "strength" TEXT,
    "form" TEXT,
    
    -- Search optimization (kept essential fields only)
    "searchTokens" TEXT[],
    "searchVector" tsvector,
    
    -- ML preprocessing (single embedding field)
    "embedding" BYTEA, -- Single embedding field instead of multiple
    "coreProductIdentity" TEXT, -- Single identity field
    
    -- Processing timestamps
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT "Product_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Product_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Product_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Product_productGroupId_fkey" FOREIGN KEY ("productGroupId") REFERENCES "ProductGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    
    -- Unique constraint for vendor-title combination
    CONSTRAINT "Product_title_vendorId_key" UNIQUE ("title", "vendorId")
);

-- Users table (kept for future user features)
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL UNIQUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- ESSENTIAL INDEXES ONLY
-- ============================================================================

-- Vendor indexes
CREATE INDEX IF NOT EXISTS "idx_vendor_name" ON "Vendor"("name");

-- Brand indexes
CREATE INDEX IF NOT EXISTS "idx_brand_name" ON "Brand"("name");
CREATE INDEX IF NOT EXISTS "idx_brand_name_lower" ON "Brand"(lower("name"));

-- Product core indexes
CREATE INDEX IF NOT EXISTS "idx_product_vendor" ON "Product"("vendorId");
CREATE INDEX IF NOT EXISTS "idx_product_price" ON "Product"("price");
CREATE INDEX IF NOT EXISTS "idx_product_category" ON "Product"("category") WHERE "category" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_product_brand" ON "Product"("brandId") WHERE "brandId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_product_group" ON "Product"("productGroupId") WHERE "productGroupId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_product_processed" ON "Product"("processedAt") WHERE "processedAt" IS NOT NULL;

-- Product group indexes
CREATE INDEX IF NOT EXISTS "idx_product_group_key" ON "ProductGroup"("groupKey");
CREATE INDEX IF NOT EXISTS "idx_product_group_core_identity" ON "ProductGroup"("coreProductIdentity") WHERE "coreProductIdentity" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_product_group_product_count" ON "ProductGroup"("productCount" DESC);

-- Search indexes (essential only)
CREATE INDEX IF NOT EXISTS "idx_product_title_lower" ON "Product"(lower("title"));
CREATE INDEX IF NOT EXISTS "idx_product_normalized_lower" ON "Product"(lower("normalizedName")) WHERE "normalizedName" IS NOT NULL;

-- Trigram indexes for fuzzy search
CREATE INDEX IF NOT EXISTS "idx_product_title_trgm" ON "Product" USING gin(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_product_normalized_trgm" ON "Product" USING gin("normalizedName" gin_trgm_ops) WHERE "normalizedName" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_brand_name_trgm" ON "Brand" USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_product_group_normalized_trgm" ON "ProductGroup" USING gin("normalizedName" gin_trgm_ops);

-- Full-text search indexes
CREATE INDEX IF NOT EXISTS "idx_product_search_vector" ON "Product" USING gin("searchVector") WHERE "searchVector" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_product_search_tokens" ON "Product" USING gin("searchTokens") WHERE "searchTokens" IS NOT NULL;

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS "idx_product_vendor_price" ON "Product"("vendorId", "price");
CREATE INDEX IF NOT EXISTS "idx_product_brand_price" ON "Product"("brandId", "price") WHERE "brandId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_product_group_price" ON "Product"("productGroupId", "price") WHERE "productGroupId" IS NOT NULL;

-- ML and identity indexes
CREATE INDEX IF NOT EXISTS "idx_product_core_identity" ON "Product"("coreProductIdentity") WHERE "coreProductIdentity" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_product_strength" ON "Product"("strength") WHERE "strength" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_product_form" ON "Product"("form") WHERE "form" IS NOT NULL;

-- ============================================================================
-- SEARCH FUNCTIONS (Simplified)
-- ============================================================================

-- Pharmaceutical abbreviation expansion function
CREATE OR REPLACE FUNCTION expand_pharma_abbreviations(query TEXT) 
RETURNS TEXT AS $$
DECLARE
    expanded_query TEXT;
BEGIN
    expanded_query := LOWER(TRIM(query));
    
    -- Common pharmaceutical abbreviations
    expanded_query := CASE
        WHEN expanded_query = 'vitc' THEN 'vitamin c'
        WHEN expanded_query = 'vitd' THEN 'vitamin d'
        WHEN expanded_query = 'vitb' THEN 'vitamin b'
        WHEN expanded_query = 'vit' THEN 'vitamin'
        WHEN expanded_query = 'calc' THEN 'calcium'
        WHEN expanded_query = 'mag' THEN 'magnesium'
        WHEN expanded_query = 'prob' THEN 'probiotic'
        WHEN expanded_query = 'omega3' THEN 'omega-3'
        WHEN expanded_query = 'coq10' THEN 'coenzyme q10'
        WHEN expanded_query = 'zn' THEN 'zinc'
        WHEN expanded_query = 'fe' THEN 'iron'
        WHEN expanded_query = 'mg' THEN 'magnesium'
        WHEN expanded_query = 'ca' THEN 'calcium'
        WHEN expanded_query = 'k2' THEN 'vitamin k2'
        WHEN expanded_query = 'b12' THEN 'vitamin b12'
        WHEN expanded_query = 'd3' THEN 'vitamin d3'
        WHEN expanded_query = 'c' THEN 'vitamin c'
        ELSE expanded_query
    END;
    
    RETURN expanded_query;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Simplified product search function
CREATE OR REPLACE FUNCTION fast_product_search(
    search_query TEXT,
    min_price NUMERIC DEFAULT NULL,
    max_price NUMERIC DEFAULT NULL,
    vendor_filter TEXT[] DEFAULT NULL,
    result_limit INTEGER DEFAULT 100
) RETURNS TABLE (
    id TEXT,
    title TEXT,
    price NUMERIC,
    vendor_id TEXT,
    vendor_name TEXT,
    brand_name TEXT,
    relevance_score INTEGER
) AS $$
DECLARE
    cleaned_query TEXT;
    expanded_query TEXT;
BEGIN
    cleaned_query := LOWER(TRIM(search_query));
    expanded_query := expand_pharma_abbreviations(cleaned_query);
    
    RETURN QUERY
    SELECT 
        p.id,
        p.title,
        p.price::NUMERIC,
        p."vendorId"::TEXT,
        v.name::TEXT as vendor_name,
        COALESCE(b.name, '')::TEXT as brand_name,
        (CASE 
            WHEN LOWER(p.title) = cleaned_query THEN 5000
            WHEN p.title ILIKE (cleaned_query || '%') THEN 4500
            WHEN cleaned_query = ANY(COALESCE(p."searchTokens", ARRAY[]::TEXT[])) THEN 4000
            WHEN similarity(LOWER(p.title), cleaned_query) > 0.3 THEN 
                (3000 + (similarity(LOWER(p.title), cleaned_query) * 1000))::int
            WHEN p.title ~* ('\m' || cleaned_query) THEN 3500
            WHEN p.title ILIKE ('%' || cleaned_query || '%') THEN 2000
            WHEN COALESCE(p."normalizedName", '') ILIKE ('%' || cleaned_query || '%') THEN 1500
            WHEN b.name ILIKE ('%' || cleaned_query || '%') THEN 1000
            ELSE 100
        END)::INTEGER as relevance_score
    FROM "Product" p
    JOIN "Vendor" v ON v.id = p."vendorId"
    LEFT JOIN "Brand" b ON p."brandId" = b.id
    WHERE 
        (min_price IS NULL OR p.price >= min_price)
        AND (max_price IS NULL OR p.price <= max_price)
        AND (vendor_filter IS NULL OR p."vendorId" = ANY(vendor_filter))
        AND (
            LOWER(p.title) = cleaned_query OR
            p.title ILIKE (cleaned_query || '%') OR
            cleaned_query = ANY(COALESCE(p."searchTokens", ARRAY[]::TEXT[])) OR
            similarity(LOWER(p.title), cleaned_query) > 0.2 OR
            p.title ~* ('\m' || cleaned_query) OR
            p.title ILIKE ('%' || cleaned_query || '%') OR
            COALESCE(p."normalizedName", '') ILIKE ('%' || cleaned_query || '%') OR
            b.name ILIKE ('%' || cleaned_query || '%')
        )
    ORDER BY relevance_score DESC, p.price ASC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to update group statistics
CREATE OR REPLACE FUNCTION update_group_stats(group_id TEXT)
RETURNS void AS $$
BEGIN
    UPDATE "ProductGroup" 
    SET 
        "productCount" = (SELECT COUNT(*) FROM "Product" WHERE "productGroupId" = group_id),
        "vendorCount" = (SELECT COUNT(DISTINCT "vendorId") FROM "Product" WHERE "productGroupId" = group_id),
        "minPrice" = (SELECT MIN(price) FROM "Product" WHERE "productGroupId" = group_id),
        "maxPrice" = (SELECT MAX(price) FROM "Product" WHERE "productGroupId" = group_id),
        "avgPrice" = (SELECT AVG(price) FROM "Product" WHERE "productGroupId" = group_id),
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE id = group_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update group stats when products change
CREATE OR REPLACE FUNCTION update_group_stats_trigger()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW."productGroupId" IS NOT NULL THEN
        PERFORM update_group_stats(NEW."productGroupId");
    ELSIF TG_OP = 'UPDATE' AND (OLD."productGroupId" != NEW."productGroupId" OR OLD.price != NEW.price) THEN
        IF OLD."productGroupId" IS NOT NULL THEN
            PERFORM update_group_stats(OLD."productGroupId");
        END IF;
        IF NEW."productGroupId" IS NOT NULL THEN
            PERFORM update_group_stats(NEW."productGroupId");
        END IF;
    ELSIF TG_OP = 'DELETE' AND OLD."productGroupId" IS NOT NULL THEN
        PERFORM update_group_stats(OLD."productGroupId");
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create the trigger
DROP TRIGGER IF EXISTS product_group_stats_trigger ON "Product";
CREATE TRIGGER product_group_stats_trigger
    AFTER INSERT OR UPDATE OR DELETE ON "Product"
    FOR EACH ROW EXECUTE FUNCTION update_group_stats_trigger();

-- ============================================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================================

-- Simple product groups view
CREATE OR REPLACE VIEW product_groups AS
SELECT 
    pg.id,
    pg."normalizedName",
    pg."groupKey",
    pg."productCount",
    pg."vendorCount",
    pg."minPrice",
    pg."maxPrice",
    pg."avgPrice",
    b.name as brand_name
FROM "ProductGroup" pg
LEFT JOIN "Brand" b ON pg."brandId" = b.id
WHERE pg."productCount" > 0;

-- Price comparison view
CREATE OR REPLACE VIEW price_comparison AS
SELECT 
    p.id,
    p.title,
    p.price,
    v.name as vendor_name,
    b.name as brand_name,
    p."productGroupId",
    pg."normalizedName" as group_name,
    pg."minPrice" as group_min_price,
    pg."maxPrice" as group_max_price,
    pg."avgPrice" as group_avg_price
FROM "Product" p
JOIN "Vendor" v ON p."vendorId" = v.id
LEFT JOIN "Brand" b ON p."brandId" = b.id
LEFT JOIN "ProductGroup" pg ON p."productGroupId" = pg.id
WHERE p."processedAt" IS NOT NULL;

-- ============================================================================
-- DATA INTEGRITY AND MAINTENANCE
-- ============================================================================

-- Update timestamps trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for timestamp updates
CREATE TRIGGER update_vendor_updated_at BEFORE UPDATE ON "Vendor" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_category_updated_at BEFORE UPDATE ON "Category" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_brand_updated_at BEFORE UPDATE ON "Brand" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_unit_updated_at BEFORE UPDATE ON "Unit" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_product_group_updated_at BEFORE UPDATE ON "ProductGroup" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_product_updated_at BEFORE UPDATE ON "Product" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_updated_at BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE "Product" IS 'Main products table with normalized and processed data';
COMMENT ON TABLE "ProductGroup" IS 'Groups similar products together for better search results';
COMMENT ON COLUMN "Product"."embedding" IS 'Single ML embedding field for semantic similarity';
COMMENT ON COLUMN "Product"."coreProductIdentity" IS 'Core product identity for grouping';
COMMENT ON VIEW "product_groups" IS 'Simple view for basic product grouping queries';
COMMENT ON VIEW "price_comparison" IS 'View optimized for price comparison queries';
