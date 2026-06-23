-- Remove the unused keywordTags column. It was populated by the ML pipeline but had
-- ZERO runtime consumers (no Go/frontend reader; only an index name reference). The
-- search-matchable fields (coreProductIdentity, searchTokens, normalizedName) cover
-- recall; keywordTags was dead storage. Dropping the GIN index + column.
DROP INDEX IF EXISTS idx_product_keyword_tags;
ALTER TABLE "Product" DROP COLUMN IF EXISTS "keywordTags";
