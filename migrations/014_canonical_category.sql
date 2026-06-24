-- Canonical product category for brand/category filtering + faceting.
-- Derived at enrichment time by ml/scripts/assign_categories.py from the mined
-- category map + cosmetic-brand / ingredient / form signals. Read by the search
-- backend (searchProductsDB SELECT, buildFacetsFromHits, brand/category filter).
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "canonicalCategory" text;

-- Filtering is `col = ANY($arr)` over the search hit set; partial btree indexes
-- keep the (sparse, low-cardinality) lookups cheap.
CREATE INDEX IF NOT EXISTS idx_product_canonical_category
  ON "Product" ("canonicalCategory") WHERE "canonicalCategory" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_extracted_brand
  ON "Product" ("extractedBrand") WHERE "extractedBrand" IS NOT NULL;
