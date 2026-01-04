-- Migration: 005_views
-- Database views for common queries

-- View: product_groups - Simple view for product grouping queries
CREATE OR REPLACE VIEW public.product_groups AS
SELECT
    pg.id,
    pg."normalizedName",
    pg."groupKey",
    pg."productCount",
    pg."vendorCount",
    pg."minPrice",
    pg."maxPrice",
    pg."avgPrice",
    pg."categoryType",
    pg."coreIngredient"
FROM public."ProductGroup" pg
WHERE pg."productCount" > 0;

COMMENT ON VIEW public.product_groups IS 'View for product grouping queries';

-- View: price_comparison - View for price comparison queries
CREATE OR REPLACE VIEW public.price_comparison AS
SELECT
    p.id,
    p.title,
    p.price,
    v.name AS vendor_name,
    p."extractedBrand" AS brand_name,
    p."productGroupId",
    pg."normalizedName" AS group_name,
    pg."minPrice" AS group_min_price,
    pg."maxPrice" AS group_max_price,
    pg."avgPrice" AS group_avg_price
FROM public."Product" p
JOIN public."Vendor" v ON p."vendorId" = v.id
LEFT JOIN public."ProductGroup" pg ON p."productGroupId" = pg.id
WHERE p."processedAt" IS NOT NULL;

COMMENT ON VIEW public.price_comparison IS 'View for price comparison queries';

-- View: ProductGroupAnalysis - Analysis view for product groups
CREATE OR REPLACE VIEW public."ProductGroupAnalysis" AS
SELECT
    pg.id AS group_id,
    pg."groupName",
    pg."categoryType",
    pg."productCount",
    pg."vendorCount",
    pg."qualityScore",
    count(p.id) AS actual_product_count,
    count(DISTINCT p."vendorId") AS actual_vendor_count,
    min(p.price) AS actual_min_price,
    max(p.price) AS actual_max_price,
    avg(p.price) AS actual_avg_price
FROM public."ProductGroup" pg
LEFT JOIN public."Product" p ON p."computedGroupId"::text = pg.id
WHERE pg."isActive" = true
GROUP BY pg.id, pg."groupName", pg."categoryType", pg."productCount", pg."vendorCount", pg."qualityScore";
