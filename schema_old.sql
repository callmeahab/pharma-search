-- ============================================================================
-- PHARMACEUTICAL SEARCH DATABASE SCHEMA
-- Consolidated from all SQL files
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

-- Vendor locations table
CREATE TABLE IF NOT EXISTS "VendorLocations" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "vendorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT "VendorLocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "VendorLocations_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Categories table
CREATE TABLE IF NOT EXISTS "Category" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "name" TEXT NOT NULL UNIQUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- Brands table
CREATE TABLE IF NOT EXISTS "Brand" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "name" TEXT NOT NULL UNIQUE,
    "embedding" BYTEA,
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

-- Product names table
CREATE TABLE IF NOT EXISTS "ProductName" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "name" TEXT NOT NULL UNIQUE,
    "embedding" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT "ProductName_pkey" PRIMARY KEY ("id")
);

-- Product groups table
CREATE TABLE IF NOT EXISTS "ProductGroup" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "normalizedName" TEXT NOT NULL,
    "brandId" TEXT,
    "productNameId" TEXT,
    "dosageValue" DECIMAL(10,2),
    "dosageUnit" TEXT,
    "unitId" TEXT,
    "groupKey" TEXT NOT NULL UNIQUE,
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "vendorCount" INTEGER DEFAULT 0,
    "minPrice" DECIMAL(10,2),
    "maxPrice" DECIMAL(10,2),
    "avgPrice" DECIMAL(10,2),
    "similarityKey" TEXT,
    "coreProductIdentity" TEXT,
    "dosageRange" TEXT,
    "formCategory" TEXT,
    "mergedFromGroups" TEXT[],
    "lastMergeDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT "ProductGroup_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductGroup_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProductGroup_productNameId_fkey" FOREIGN KEY ("productNameId") REFERENCES "ProductName"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProductGroup_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Main products table with all enhancement columns
CREATE TABLE IF NOT EXISTS "Product" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "vendorId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "link" TEXT NOT NULL,
    "thumbnail" TEXT NOT NULL,
    "photos" TEXT NOT NULL,
    "description" TEXT,
    "originalTitle" TEXT,
    
    -- Product identification and processing
    "normalizedName" TEXT,
    "brandId" TEXT,
    "brandConfidence" DOUBLE PRECISION,
    "productNameId" TEXT,
    "productNameConfidence" DOUBLE PRECISION,
    "unitId" TEXT,
    "unitConfidence" DOUBLE PRECISION,
    "productGroupId" TEXT,
    
    -- Dosage and quantity information
    "dosageValue" DECIMAL(10,2),
    "dosageUnit" TEXT,
    "quantity" INTEGER,
    "quantityConfidence" DOUBLE PRECISION,
    
    -- Search and ML enhancements
    "searchTokens" TEXT[],
    "searchVector" tsvector,
    "titleEmbedding" BYTEA,
    
    -- Preprocessing and ML columns
    "groupingKey" TEXT,
    "strength" TEXT,
    "form" TEXT,
    "mlEmbedding" BYTEA,
    "similarityHash" TEXT,
    "coreProductIdentity" TEXT,
    "similarityKey" TEXT,
    "formCategory" TEXT,
    "dosageRange" TEXT,
    
    -- Processing timestamps
    "processedAt" TIMESTAMP(3),
    "preprocessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT "Product_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Product_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Product_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Product_productNameId_fkey" FOREIGN KEY ("productNameId") REFERENCES "ProductName"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Product_productGroupId_fkey" FOREIGN KEY ("productGroupId") REFERENCES "ProductGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    
    -- Unique constraint for vendor-title combination
    CONSTRAINT "Product_title_vendorId_key" UNIQUE ("title", "vendorId")
);

-- Users table
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL UNIQUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- CORE INDEXES - Basic performance indexes
-- ============================================================================

-- Vendor indexes
CREATE INDEX IF NOT EXISTS "idx_vendor_name" ON "Vendor"("name");
CREATE INDEX IF NOT EXISTS "idx_vendor_website" ON "Vendor"("website") WHERE "website" IS NOT NULL;

-- Vendor locations indexes
CREATE INDEX IF NOT EXISTS "idx_vendor_locations_vendor" ON "VendorLocations"("vendorId");
CREATE INDEX IF NOT EXISTS "idx_vendor_locations_city" ON "VendorLocations"("city");
CREATE INDEX IF NOT EXISTS "idx_vendor_locations_coordinates" ON "VendorLocations"("latitude", "longitude");

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
CREATE INDEX IF NOT EXISTS "idx_product_preprocessed" ON "Product"("preprocessedAt") WHERE "preprocessedAt" IS NOT NULL;

-- Product group indexes
CREATE INDEX IF NOT EXISTS "idx_product_group_key" ON "ProductGroup"("groupKey");
CREATE INDEX IF NOT EXISTS "idx_product_group_similarity" ON "ProductGroup"("similarityKey") WHERE "similarityKey" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_product_group_core_identity" ON "ProductGroup"("coreProductIdentity") WHERE "coreProductIdentity" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_product_group_product_count" ON "ProductGroup"("productCount" DESC);
CREATE INDEX IF NOT EXISTS "idx_product_group_vendor_count" ON "ProductGroup"("vendorCount" DESC);

-- ============================================================================
-- SEARCH INDEXES - Advanced search functionality
-- ============================================================================

-- Text search indexes
CREATE INDEX IF NOT EXISTS "idx_product_title_lower" ON "Product"(lower("title"));
CREATE INDEX IF NOT EXISTS "idx_product_normalized_lower" ON "Product"(lower("normalizedName")) WHERE "normalizedName" IS NOT NULL;

-- Trigram indexes for fuzzy search
CREATE INDEX IF NOT EXISTS "idx_product_title_trgm" ON "Product" USING gin(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_product_normalized_trgm" ON "Product" USING gin("normalizedName" gin_trgm_ops) WHERE "normalizedName" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_brand_name_trgm" ON "Brand" USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_product_group_normalized_trgm" ON "ProductGroup" USING gin("normalizedName" gin_trgm_ops);

-- Full-text search indexes
CREATE INDEX IF NOT EXISTS "idx_product_search_vector" ON "Product" USING gin("searchVector") WHERE "searchVector" IS NOT NULL;

-- Array search indexes
CREATE INDEX IF NOT EXISTS "idx_product_search_tokens" ON "Product" USING gin("searchTokens") WHERE "searchTokens" IS NOT NULL;

-- ============================================================================
-- PERFORMANCE INDEXES - Query optimization
-- ============================================================================

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS "idx_product_vendor_price" ON "Product"("vendorId", "price");
CREATE INDEX IF NOT EXISTS "idx_product_brand_price" ON "Product"("brandId", "price") WHERE "brandId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_product_group_price" ON "Product"("productGroupId", "price") WHERE "productGroupId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_product_processed_price" ON "Product"("processedAt", "price") WHERE "processedAt" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_product_vendor_group" ON "Product"("vendorId", "productGroupId") WHERE "productGroupId" IS NOT NULL;

-- ML and preprocessing indexes
CREATE INDEX IF NOT EXISTS "idx_product_grouping_key" ON "Product"("groupingKey") WHERE "groupingKey" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_product_similarity_key" ON "Product"("similarityKey") WHERE "similarityKey" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_product_similarity_hash" ON "Product"("similarityHash") WHERE "similarityHash" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_product_core_identity" ON "Product"("coreProductIdentity") WHERE "coreProductIdentity" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_product_strength" ON "Product"("strength") WHERE "strength" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_product_form" ON "Product"("form") WHERE "form" IS NOT NULL;

-- Composite indexes for ML grouping
CREATE INDEX IF NOT EXISTS "idx_product_category_strength" ON "Product"("category", "strength") WHERE "category" IS NOT NULL AND "strength" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_product_grouping_preprocessed" ON "Product"("groupingKey", "preprocessedAt") WHERE "groupingKey" IS NOT NULL AND "preprocessedAt" IS NOT NULL;

-- ============================================================================
-- SEARCH FUNCTIONS
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

-- Enhanced product search function with fuzzy matching and abbreviation support
CREATE OR REPLACE FUNCTION fast_product_search(
    search_query TEXT,
    min_price NUMERIC DEFAULT NULL,
    max_price NUMERIC DEFAULT NULL,
    vendor_filter TEXT[] DEFAULT NULL,
    brand_filter TEXT[] DEFAULT NULL,
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
    query_length INTEGER;
    cleaned_query TEXT;
    expanded_query TEXT;
    is_abbreviation BOOLEAN;
BEGIN
    -- Clean and prepare queries
    cleaned_query := LOWER(TRIM(search_query));
    expanded_query := expand_pharma_abbreviations(cleaned_query);
    is_abbreviation := cleaned_query != expanded_query;
    query_length := LENGTH(cleaned_query);
    
    -- For very short queries (1-4 chars), use enhanced fuzzy matching
    IF query_length <= 4 THEN
        RETURN QUERY
        SELECT 
            p.id,
            p.title,
            p.price::NUMERIC,
            p."vendorId"::TEXT,
            v.name::TEXT as vendor_name,
            COALESCE(b.name, '')::TEXT as brand_name,
            (CASE 
                -- If this is a known abbreviation, prioritize expanded matches
                WHEN is_abbreviation AND p.title ILIKE ('%' || expanded_query || '%') THEN 4800
                WHEN is_abbreviation AND p.title ~* ('\m' || expanded_query) THEN 4500
                -- Exact matches get highest priority
                WHEN LOWER(p.title) = cleaned_query THEN 5000
                WHEN p.title ILIKE (cleaned_query || '%') THEN 4500
                -- Token matches
                WHEN cleaned_query = ANY(COALESCE(p."searchTokens", ARRAY[]::TEXT[])) THEN 4000
                -- Trigram similarity for short queries
                WHEN similarity(LOWER(p.title), cleaned_query) > 0.3 THEN 
                    (3000 + (similarity(LOWER(p.title), cleaned_query) * 1000))::int
                WHEN is_abbreviation AND similarity(LOWER(p.title), expanded_query) > 0.3 THEN 
                    (3500 + (similarity(LOWER(p.title), expanded_query) * 1000))::int
                WHEN COALESCE(p."normalizedName", '') != '' AND similarity(LOWER(p."normalizedName"), cleaned_query) > 0.3 THEN 
                    (2500 + (similarity(LOWER(p."normalizedName"), cleaned_query) * 1000))::int
                -- Word boundary matches
                WHEN p.title ~* ('\m' || cleaned_query) THEN 3500
                -- Contains matches
                WHEN p.title ILIKE ('%' || cleaned_query || '%') THEN 2000
                WHEN COALESCE(p."normalizedName", '') ILIKE ('%' || cleaned_query || '%') THEN 1500
                -- Brand matches
                WHEN b.name ILIKE ('%' || cleaned_query || '%') THEN 1000
                -- Levenshtein distance for very similar words
                WHEN levenshtein(LOWER(split_part(p.title, ' ', 1)), cleaned_query) <= 2 THEN 800
                -- Check for expanded query matches if abbreviation
                WHEN is_abbreviation AND (
                    p.title ~* ('\m' || split_part(expanded_query, ' ', 1)) OR
                    p.title ILIKE ('%' || split_part(expanded_query, ' ', 1) || '%')
                ) THEN 700
                ELSE 100
            END)::INTEGER as relevance_score
        FROM "Product" p
        JOIN "Vendor" v ON v.id = p."vendorId"
        LEFT JOIN "Brand" b ON p."brandId" = b.id
        WHERE 
            (p."processedAt" IS NOT NULL OR p."preprocessedAt" IS NOT NULL)
            AND (min_price IS NULL OR p.price >= min_price)
            AND (max_price IS NULL OR p.price <= max_price)
            AND (vendor_filter IS NULL OR p."vendorId" = ANY(vendor_filter))
            AND (brand_filter IS NULL OR p."brandId" = ANY(brand_filter))
            AND (
                -- Multiple matching strategies for short queries
                LOWER(p.title) = cleaned_query OR
                p.title ILIKE (cleaned_query || '%') OR
                cleaned_query = ANY(COALESCE(p."searchTokens", ARRAY[]::TEXT[])) OR
                similarity(LOWER(p.title), cleaned_query) > 0.2 OR
                (COALESCE(p."normalizedName", '') != '' AND similarity(LOWER(p."normalizedName"), cleaned_query) > 0.2) OR
                p.title ~* ('\m' || cleaned_query) OR
                p.title ILIKE ('%' || cleaned_query || '%') OR
                COALESCE(p."normalizedName", '') ILIKE ('%' || cleaned_query || '%') OR
                b.name ILIKE ('%' || cleaned_query || '%') OR
                levenshtein(LOWER(split_part(p.title, ' ', 1)), cleaned_query) <= 2 OR
                -- Abbreviation expansion matches
                (is_abbreviation AND (
                    p.title ILIKE ('%' || expanded_query || '%') OR
                    p.title ~* ('\m' || expanded_query) OR
                    p.title ~* ('\m' || split_part(expanded_query, ' ', 1)) OR
                    similarity(LOWER(p.title), expanded_query) > 0.2
                )) OR
                -- Check if query matches start of any word in title
                EXISTS (
                    SELECT 1 FROM unnest(string_to_array(LOWER(p.title), ' ')) AS word
                    WHERE word ILIKE (cleaned_query || '%') OR 
                          similarity(word, cleaned_query) > 0.4 OR
                          (is_abbreviation AND word ILIKE (expanded_query || '%'))
                )
            )
        ORDER BY relevance_score DESC, p.price ASC
        LIMIT result_limit;
    ELSE
        -- For longer queries, use more traditional approach with abbreviation support
        RETURN QUERY
        SELECT 
            p.id,
            p.title,
            p.price::NUMERIC,
            p."vendorId"::TEXT,
            v.name::TEXT as vendor_name,
            COALESCE(b.name, '')::TEXT as brand_name,
            (CASE 
                -- Abbreviation matches get high priority
                WHEN is_abbreviation AND p.title ILIKE ('%' || expanded_query || '%') THEN 4900
                WHEN is_abbreviation AND p.title ~* ('\m' || expanded_query || '\M') THEN 4700
                -- Exact title matches
                WHEN LOWER(p.title) = cleaned_query THEN 5000
                WHEN p.title ILIKE cleaned_query THEN 4800
                WHEN p.title ILIKE (cleaned_query || '%') THEN 4000
                -- Word boundary matches  
                WHEN p.title ~* ('\m' || cleaned_query || '\M') THEN 3800
                -- Token matches
                WHEN cleaned_query = ANY(COALESCE(p."searchTokens", ARRAY[]::TEXT[])) THEN 3500
                -- Contains matches
                WHEN p.title ILIKE ('%' || cleaned_query || '%') THEN 3000
                WHEN COALESCE(p."normalizedName", '') ILIKE ('%' || cleaned_query || '%') THEN 2500
                -- Brand matches
                WHEN b.name ILIKE cleaned_query THEN 2200
                WHEN b.name ILIKE ('%' || cleaned_query || '%') THEN 2000
                -- Full text search (if searchVector exists)
                WHEN p."searchVector" IS NOT NULL AND p."searchVector" @@ plainto_tsquery('english', cleaned_query) THEN 
                    (1500 + (ts_rank(p."searchVector", plainto_tsquery('english', cleaned_query)) * 500))::int
                -- Similarity fallback for longer queries
                WHEN similarity(LOWER(p.title), cleaned_query) > 0.3 THEN 
                    (1000 + (similarity(LOWER(p.title), cleaned_query) * 500))::int
                ELSE 100
            END)::INTEGER as relevance_score
        FROM "Product" p
        JOIN "Vendor" v ON v.id = p."vendorId"
        LEFT JOIN "Brand" b ON p."brandId" = b.id
        WHERE 
            (p."processedAt" IS NOT NULL OR p."preprocessedAt" IS NOT NULL)
            AND (min_price IS NULL OR p.price >= min_price)
            AND (max_price IS NULL OR p.price <= max_price)
            AND (vendor_filter IS NULL OR p."vendorId" = ANY(vendor_filter))
            AND (brand_filter IS NULL OR p."brandId" = ANY(brand_filter))
            AND (
                LOWER(p.title) = cleaned_query OR
                p.title ILIKE ('%' || cleaned_query || '%') OR
                COALESCE(p."normalizedName", '') ILIKE ('%' || cleaned_query || '%') OR
                cleaned_query = ANY(COALESCE(p."searchTokens", ARRAY[]::TEXT[])) OR
                p.title ~* ('\m' || cleaned_query) OR
                b.name ILIKE ('%' || cleaned_query || '%') OR
                (p."searchVector" IS NOT NULL AND p."searchVector" @@ plainto_tsquery('english', cleaned_query)) OR
                similarity(LOWER(p.title), cleaned_query) > 0.2 OR
                -- Abbreviation expansion matches
                (is_abbreviation AND (
                    p.title ILIKE ('%' || expanded_query || '%') OR
                    p.title ~* ('\m' || expanded_query) OR
                    similarity(LOWER(p.title), expanded_query) > 0.2
                ))
            )
        ORDER BY relevance_score DESC, p.price ASC
        LIMIT result_limit;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- Enhanced autocomplete function
CREATE OR REPLACE FUNCTION fast_autocomplete_search(
    search_query TEXT,
    result_limit INTEGER DEFAULT 20
) RETURNS TABLE (
    id TEXT,
    title TEXT,
    price NUMERIC,
    vendor_name TEXT,
    relevance_score INTEGER
) AS $$
DECLARE
    cleaned_query TEXT;
    query_length INTEGER;
BEGIN
    cleaned_query := LOWER(TRIM(search_query));
    query_length := LENGTH(cleaned_query);
    
    RETURN QUERY
    SELECT DISTINCT ON (p."normalizedName", p.title)
        p.id,
        p.title,
        p.price::NUMERIC,
        v.name::TEXT as vendor_name,
        (CASE 
            -- Exact matches
            WHEN LOWER(p.title) = cleaned_query THEN 5000
            WHEN p.title ILIKE (cleaned_query || '%') THEN 4000
            WHEN cleaned_query = ANY(COALESCE(p."searchTokens", ARRAY[]::TEXT[])) THEN 3500
            -- For short queries, use more fuzzy matching
            WHEN query_length <= 4 AND similarity(LOWER(p.title), cleaned_query) > 0.3 THEN 
                (3000 + (similarity(LOWER(p.title), cleaned_query) * 1000))::int
            WHEN query_length <= 4 AND levenshtein(LOWER(split_part(p.title, ' ', 1)), cleaned_query) <= 2 THEN 2500
            -- Word starts with query
            WHEN EXISTS (
                SELECT 1 FROM unnest(string_to_array(LOWER(p.title), ' ')) AS word
                WHERE word ILIKE (cleaned_query || '%')
            ) THEN 2000
            -- Contains query
            WHEN p.title ILIKE ('%' || cleaned_query || '%') THEN 1500
            ELSE 1000
        END)::INTEGER as relevance_score
    FROM "Product" p
    JOIN "Vendor" v ON v.id = p."vendorId"
    WHERE 
        (p."processedAt" IS NOT NULL OR p."preprocessedAt" IS NOT NULL)
        AND (
            LOWER(p.title) = cleaned_query OR
            p.title ILIKE (cleaned_query || '%') OR
            cleaned_query = ANY(COALESCE(p."searchTokens", ARRAY[]::TEXT[])) OR
            p.title ILIKE ('%' || cleaned_query || '%') OR
            -- Enhanced matching for short queries
            (query_length <= 4 AND (
                similarity(LOWER(p.title), cleaned_query) > 0.2 OR
                levenshtein(LOWER(split_part(p.title, ' ', 1)), cleaned_query) <= 2 OR
                EXISTS (
                    SELECT 1 FROM unnest(string_to_array(LOWER(p.title), ' ')) AS word
                    WHERE word ILIKE (cleaned_query || '%') OR similarity(word, cleaned_query) > 0.4
                )
            ))
        )
    ORDER BY p."normalizedName", p.title, relevance_score DESC, p.price ASC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- ML similarity search function
CREATE OR REPLACE FUNCTION find_similar_products_by_hash(
    input_hash TEXT,
    max_hamming_distance INTEGER DEFAULT 5,
    result_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
    product_id TEXT,
    similarity_hash TEXT,
    hamming_distance INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id::TEXT,
        p."similarityHash"::TEXT,
        -- Calculate Hamming distance (simplified for PostgreSQL)
        CASE 
            WHEN p."similarityHash" = input_hash THEN 0
            ELSE length(p."similarityHash") -- Placeholder - actual Hamming distance would need a custom function
        END as hamming_distance
    FROM "Product" p
    WHERE p."similarityHash" IS NOT NULL 
        AND p."similarityHash" != input_hash
    ORDER BY 
        CASE 
            WHEN p."similarityHash" = input_hash THEN 0
            ELSE 1
        END,
        p.price ASC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- GROUP MANAGEMENT FUNCTIONS
-- ============================================================================

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

-- Trigger function to auto-update group stats when products change
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

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Product groups view for easy querying
CREATE OR REPLACE VIEW product_groups AS
SELECT 
    "groupingKey",
    COUNT(*) as product_count,
    MIN(price) as min_price,
    MAX(price) as max_price,
    AVG(price) as avg_price,
    COUNT(DISTINCT "vendorId") as vendor_count,
    array_agg(DISTINCT "vendorId") as vendor_ids,
    array_agg(id ORDER BY price) as product_ids,
    COALESCE(MAX("normalizedName"), MAX(title)) as group_name,
    MAX(category) as category,
    MAX(strength) as strength,
    MAX(form) as form
FROM "Product" 
WHERE "groupingKey" IS NOT NULL AND "groupingKey" != ''
GROUP BY "groupingKey"
HAVING COUNT(*) > 0
ORDER BY product_count DESC, min_price ASC;

-- Price comparison view
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

-- Grouping summary view
CREATE OR REPLACE VIEW "GroupingSummary" AS
SELECT 
    COUNT(*) as total_products,
    COUNT(DISTINCT p."productGroupId") as total_groups,
    AVG(group_stats.product_count) as avg_products_per_group,
    AVG(group_stats.vendor_count) as avg_vendors_per_group,
    COUNT(*) FILTER (WHERE group_stats.vendor_count > 1) as groups_with_multiple_vendors,
    COUNT(*) FILTER (WHERE group_stats.vendor_count = 1) as single_vendor_groups,
    ROUND(
        COUNT(*) FILTER (WHERE group_stats.vendor_count > 1) * 100.0 / 
        NULLIF(COUNT(DISTINCT p."productGroupId"), 0), 2
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

-- ============================================================================
-- MATERIALIZED VIEWS FOR PERFORMANCE
-- ============================================================================

-- Materialized view for fast group statistics
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

-- Indexes on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS "idx_productgroupstats_id" ON "ProductGroupStats" (id);
CREATE INDEX IF NOT EXISTS "idx_productgroupstats_product_count" ON "ProductGroupStats" ("productCount" DESC);
CREATE INDEX IF NOT EXISTS "idx_productgroupstats_vendor_count" ON "ProductGroupStats" ("vendor_count" DESC);
CREATE INDEX IF NOT EXISTS "idx_productgroupstats_core_identity" ON "ProductGroupStats" ("coreProductIdentity") WHERE "coreProductIdentity" IS NOT NULL;

-- Function to refresh materialized view
CREATE OR REPLACE FUNCTION refresh_product_group_stats()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY "ProductGroupStats";
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- DATA INTEGRITY AND MAINTENANCE
-- ============================================================================

-- Update statistics for query planner
ANALYZE "Product";
ANALYZE "Brand"; 
ANALYZE "Vendor";
ANALYZE "ProductGroup";

-- ============================================================================
-- CLEANUP AND COMMENTS
-- ============================================================================

-- Add helpful comments
COMMENT ON TABLE "Product" IS 'Main products table with all search, ML, and grouping enhancements';
COMMENT ON TABLE "ProductGroup" IS 'Product groups for better organization and price comparison';
COMMENT ON COLUMN "Product"."groupingKey" IS 'Key for grouping similar products using rule-based logic';
COMMENT ON COLUMN "Product"."similarityHash" IS 'Hash for fast ML-based similarity matching';
COMMENT ON COLUMN "Product"."mlEmbedding" IS 'ML-generated product embedding for semantic similarity';
COMMENT ON COLUMN "Product"."strength" IS 'Extracted and normalized product strength/dosage';
COMMENT ON COLUMN "Product"."form" IS 'Pharmaceutical form (tablet, capsule, syrup, etc.)';
COMMENT ON COLUMN "ProductGroup"."similarityKey" IS 'Key for grouping similar products across brands';
COMMENT ON COLUMN "ProductGroup"."coreProductIdentity" IS 'Core product identity for aggressive grouping';
COMMENT ON COLUMN "ProductGroup"."mergedFromGroups" IS 'Array of group IDs that were merged into this group';
COMMENT ON MATERIALIZED VIEW "ProductGroupStats" IS 'Materialized view with pre-calculated group statistics for fast queries';
COMMENT ON VIEW "PriceComparisonView" IS 'View optimized for price comparison queries';
COMMENT ON VIEW product_groups IS 'Simple view for basic product grouping queries';

-- Log completion
DO $$
BEGIN
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'PHARMACEUTICAL SEARCH DATABASE SCHEMA INSTALLATION COMPLETE';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'Schema features:';
    RAISE NOTICE '- Core tables: Vendor, Product, Brand, ProductGroup, etc.';
    RAISE NOTICE '- Advanced search with fuzzy matching and pharmaceutical abbreviations';
    RAISE NOTICE '- ML-enhanced product similarity and grouping';
    RAISE NOTICE '- Comprehensive indexing for performance';
    RAISE NOTICE '- Automatic group statistics maintenance';
    RAISE NOTICE '- Price comparison and analytics views';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '1. Run preprocessing: python backend/scripts/preprocess_products.py';
    RAISE NOTICE '2. Setup ML models: python backend/scripts/setup_ml.py';
    RAISE NOTICE '============================================================================';
END $$;