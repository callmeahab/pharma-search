-- Optimize search indexes for better performance
-- Run this script to add missing indexes that will dramatically improve search speed

-- 1. Add trigram index on title (most important for fuzzy search)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_title_trgm_idx" 
ON "Product" USING GIN(title gin_trgm_ops);

-- 2. Add trigram index on brand names
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Brand_name_trgm_idx" 
ON "Brand" USING GIN(name gin_trgm_ops);

-- 3. Composite index for price filtering with search conditions
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_price_processed_idx" 
ON "Product"(price, "processedAt") WHERE "processedAt" IS NOT NULL;

-- 4. Index for vendor filtering combined with price
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_vendor_price_idx" 
ON "Product"("vendorId", price);

-- 5. Index for brand filtering combined with price  
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_brand_price_idx" 
ON "Product"("brandId", price) WHERE "brandId" IS NOT NULL;

-- 6. Partial index for searching only processed products
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_processed_search_idx" 
ON "Product"("normalizedName", title, price) WHERE "processedAt" IS NOT NULL;

-- 7. Index to speed up token array searches
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_searchTokens_gin_idx" 
ON "Product" USING GIN("searchTokens" array_ops);

-- 8. Update table statistics to help query planner
ANALYZE "Product";
ANALYZE "Brand";
ANALYZE "Vendor";

-- Create a faster search function using prepared statements
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
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.title,
        p.price::NUMERIC,
        p."vendorId"::TEXT,
        v.name::TEXT as vendor_name,
        COALESCE(b.name, '')::TEXT as brand_name,
        (CASE 
            -- Exact title match (highest priority)
            WHEN p.title ILIKE search_query THEN 4000
            -- High trigram similarity 
            WHEN similarity(p.title, search_query) > 0.8 THEN 3000 + (similarity(p.title, search_query) * 500)::int
            -- Phrase match
            WHEN p.title ILIKE ('%' || search_query || '%') THEN 2500
            -- Brand exact match
            WHEN b.name ILIKE search_query THEN 2000
            -- Prefix match
            WHEN p.title ILIKE (search_query || '%') THEN 1500
            -- Token match
            WHEN search_query = ANY(p."searchTokens") THEN 1000
            -- Full-text search
            WHEN p."searchVector" @@ plainto_tsquery('english', search_query) THEN 
                (ts_rank(p."searchVector", plainto_tsquery('english', search_query)) * 100 + 500)::int
            ELSE 100
        END)::INTEGER as relevance_score
    FROM "Product" p
    JOIN "Vendor" v ON v.id = p."vendorId"
    LEFT JOIN "Brand" b ON p."brandId" = b.id
    WHERE 
        p."processedAt" IS NOT NULL
        AND (min_price IS NULL OR p.price >= min_price)
        AND (max_price IS NULL OR p.price <= max_price)
        AND (vendor_filter IS NULL OR p."vendorId" = ANY(vendor_filter))
        AND (brand_filter IS NULL OR p."brandId" = ANY(brand_filter))
        AND (
            -- Use indexes efficiently
            p.title ILIKE ('%' || search_query || '%') OR
            p."normalizedName" ILIKE ('%' || search_query || '%') OR
            b.name ILIKE ('%' || search_query || '%') OR
            similarity(p.title, search_query) > 0.3 OR
            similarity(p."normalizedName", search_query) > 0.3 OR
            p."searchVector" @@ plainto_tsquery('english', search_query) OR
            search_query = ANY(p."searchTokens")
        )
    ORDER BY relevance_score DESC, p.price ASC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql STABLE;