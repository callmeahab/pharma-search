-- Migration: 006_drop_product_group
-- Remove the ProductGroup table and all related objects.
-- Grouping is done in real-time from computedGroupId on Product rows.

-- Drop views that reference ProductGroup
DROP VIEW IF EXISTS public."ProductGroupAnalysis";
DROP VIEW IF EXISTS public.product_groups;
DROP VIEW IF EXISTS public.price_comparison;

-- Drop trigger on ProductGroup
DROP TRIGGER IF EXISTS update_product_group_updated_at ON public."ProductGroup";

-- Drop the FK constraint and column from Product
ALTER TABLE public."Product" DROP CONSTRAINT IF EXISTS "Product_productGroupId_fkey";
ALTER TABLE public."Product" DROP COLUMN IF EXISTS "productGroupId";

-- Drop ProductGroup indexes (will be dropped with the table, but be explicit)
DROP INDEX IF EXISTS idx_product_group_key;
DROP INDEX IF EXISTS idx_product_group_normalized_trgm;
DROP INDEX IF EXISTS idx_product_group_core_identity;
DROP INDEX IF EXISTS idx_product_group_product_count;
DROP INDEX IF EXISTS idx_product_group_category;
DROP INDEX IF EXISTS idx_product_group_ingredient;

-- Drop Product indexes that referenced productGroupId
DROP INDEX IF EXISTS idx_product_group;
DROP INDEX IF EXISTS idx_product_group_price;

-- Drop the ProductGroup table
DROP TABLE IF EXISTS public."ProductGroup";

-- Drop functions that only served ProductGroup
DROP FUNCTION IF EXISTS public.update_group_stats(text);
DROP FUNCTION IF EXISTS public.update_group_stats_trigger();
