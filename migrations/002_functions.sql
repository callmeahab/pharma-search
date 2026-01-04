-- Migration: 002_functions
-- Database functions for product processing

-- Function: update_updated_at_column (used by triggers)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW."updatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

-- Function: update_group_stats
CREATE OR REPLACE FUNCTION public.update_group_stats(group_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
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
$$;

-- Function: update_group_stats_trigger (trigger function)
CREATE OR REPLACE FUNCTION public.update_group_stats_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW."productGroupId" IS NOT NULL THEN
        PERFORM update_group_stats(NEW."productGroupId");
    ELSIF TG_OP = 'UPDATE' AND (OLD."productGroupId" IS DISTINCT FROM NEW."productGroupId" OR OLD.price != NEW.price) THEN
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
$$;

-- Function: expand_pharma_abbreviations (for search)
CREATE OR REPLACE FUNCTION public.expand_pharma_abbreviations(query text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
    expanded_query TEXT;
BEGIN
    expanded_query := LOWER(TRIM(query));

    expanded_query := CASE
        -- Vitamins
        WHEN expanded_query = 'vitc' THEN 'vitamin c'
        WHEN expanded_query = 'vitd' THEN 'vitamin d'
        WHEN expanded_query = 'vitb' THEN 'vitamin b'
        WHEN expanded_query = 'vit' THEN 'vitamin'
        WHEN expanded_query = 'd3' THEN 'vitamin d3'
        WHEN expanded_query = 'b12' THEN 'vitamin b12'
        WHEN expanded_query = 'k2' THEN 'vitamin k2'
        -- Minerals
        WHEN expanded_query = 'calc' THEN 'calcium'
        WHEN expanded_query = 'mag' THEN 'magnesium'
        WHEN expanded_query = 'zn' THEN 'zinc'
        WHEN expanded_query = 'fe' THEN 'iron'
        -- Supplements
        WHEN expanded_query = 'prob' THEN 'probiotic'
        WHEN expanded_query = 'omega3' THEN 'omega-3'
        WHEN expanded_query = 'coq10' THEN 'coenzyme q10'
        WHEN expanded_query = 'bcaa' THEN 'branched chain amino acids'
        ELSE expanded_query
    END;

    RETURN expanded_query;
END;
$$;

-- Function: fast_product_search
CREATE OR REPLACE FUNCTION public.fast_product_search(
    search_query text,
    min_price numeric DEFAULT NULL,
    max_price numeric DEFAULT NULL,
    vendor_filter text[] DEFAULT NULL,
    result_limit integer DEFAULT 100
)
RETURNS TABLE(
    id text,
    title text,
    price numeric,
    vendor_id text,
    vendor_name text,
    brand_name text,
    relevance_score integer
)
LANGUAGE plpgsql
AS $$
DECLARE
    cleaned_query TEXT;
BEGIN
    cleaned_query := LOWER(TRIM(search_query));

    RETURN QUERY
    SELECT
        p.id,
        p.title,
        p.price::NUMERIC,
        p."vendorId"::TEXT,
        v.name::TEXT as vendor_name,
        COALESCE(p."extractedBrand", '')::TEXT as brand_name,
        (CASE
            WHEN LOWER(p.title) = cleaned_query THEN 5000
            WHEN p.title ILIKE (cleaned_query || '%') THEN 4500
            WHEN cleaned_query = ANY(COALESCE(p."searchTokens", ARRAY[]::TEXT[])) THEN 4000
            WHEN similarity(LOWER(p.title), cleaned_query) > 0.3 THEN
                (3000 + (similarity(LOWER(p.title), cleaned_query) * 1000))::int
            WHEN p.title ~* ('\m' || cleaned_query) THEN 3500
            WHEN p.title ILIKE ('%' || cleaned_query || '%') THEN 2000
            WHEN COALESCE(p."normalizedName", '') ILIKE ('%' || cleaned_query || '%') THEN 1500
            WHEN p."extractedBrand" ILIKE ('%' || cleaned_query || '%') THEN 1000
            ELSE 100
        END)::INTEGER as relevance_score
    FROM "Product" p
    JOIN "Vendor" v ON v.id = p."vendorId"
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
            p."extractedBrand" ILIKE ('%' || cleaned_query || '%')
        )
    ORDER BY relevance_score DESC, p.price ASC
    LIMIT result_limit;
END;
$$;
