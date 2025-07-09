-- Fix for the ambiguous column reference in GroupingSummary view
-- This fixes the error: column reference "productGroupId" is ambiguous

-- Drop and recreate the GroupingSummary view with proper table aliases
DROP VIEW IF EXISTS "GroupingSummary";

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

-- Add comment for the fixed view
COMMENT ON VIEW "GroupingSummary" IS 'Summary statistics for product grouping effectiveness';