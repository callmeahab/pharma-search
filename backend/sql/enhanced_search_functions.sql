-- Enhanced Search Functions for Pharma Search Application
-- This file contains all the search improvements including:
-- 1. Pharmaceutical abbreviation expansion
-- 2. Enhanced fuzzy search with trigrams  
-- 3. Improved search functions with dosage awareness
-- 4. Required PostgreSQL extensions
--
-- Run this after the database schema is set up but before starting the application

-- Enable required extensions for fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

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

-- Drop existing functions to replace them
DROP FUNCTION IF EXISTS fast_product_search(TEXT, NUMERIC, NUMERIC, TEXT[], TEXT[], INTEGER);
DROP FUNCTION IF EXISTS fast_autocomplete_search(TEXT, INTEGER);

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
            p."processedAt" IS NOT NULL
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
            p."processedAt" IS NOT NULL
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
        p."processedAt" IS NOT NULL
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

-- Create indexes to support enhanced search functionality
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_title_trgm ON "Product" USING GIN (LOWER(title) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_normalized_trgm ON "Product" USING GIN (LOWER("normalizedName") gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_brand_name_trgm ON "Brand" USING GIN (LOWER(name) gin_trgm_ops);

-- Create composite indexes for better performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_processed_price ON "Product" ("processedAt", price) WHERE "processedAt" IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_processed_vendor ON "Product" ("processedAt", "vendorId") WHERE "processedAt" IS NOT NULL;

-- Update statistics for query planner
ANALYZE "Product";
ANALYZE "Brand"; 
ANALYZE "Vendor";

-- Test the enhanced search functionality
DO $$
BEGIN
    RAISE NOTICE 'Enhanced search functions installed successfully!';
    RAISE NOTICE 'Testing abbreviation expansion:';
    RAISE NOTICE '  vitc -> %', expand_pharma_abbreviations('vitc');
    RAISE NOTICE '  d3 -> %', expand_pharma_abbreviations('d3');
    RAISE NOTICE '  omega3 -> %', expand_pharma_abbreviations('omega3');
END $$;