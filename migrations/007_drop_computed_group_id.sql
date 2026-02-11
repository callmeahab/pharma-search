DROP INDEX IF EXISTS idx_product_computed_group;
ALTER TABLE "Product" DROP COLUMN IF EXISTS "computedGroupId";
