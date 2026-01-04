-- Migration: 003_indexes
-- Database indexes for optimized queries

-- Vendor indexes
CREATE INDEX IF NOT EXISTS idx_vendor_name ON public."Vendor" USING btree (name);

-- ProductGroup indexes
CREATE INDEX IF NOT EXISTS idx_product_group_key ON public."ProductGroup" USING btree ("groupKey");
CREATE INDEX IF NOT EXISTS idx_product_group_normalized_trgm ON public."ProductGroup" USING gin ("normalizedName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_product_group_core_identity ON public."ProductGroup" USING btree ("coreProductIdentity") WHERE ("coreProductIdentity" IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_product_group_product_count ON public."ProductGroup" USING btree ("productCount" DESC);
CREATE INDEX IF NOT EXISTS idx_product_group_category ON public."ProductGroup" USING btree ("categoryType");
CREATE INDEX IF NOT EXISTS idx_product_group_ingredient ON public."ProductGroup" USING btree ("coreIngredient");

-- Product indexes - Primary lookups
CREATE INDEX IF NOT EXISTS idx_product_vendor ON public."Product" USING btree ("vendorId");
CREATE INDEX IF NOT EXISTS idx_product_vendor_price ON public."Product" USING btree ("vendorId", price);
CREATE INDEX IF NOT EXISTS idx_product_price ON public."Product" USING btree (price);

-- Product indexes - Title search (critical for performance)
CREATE INDEX IF NOT EXISTS idx_product_title_lower ON public."Product" USING btree (lower(title));
CREATE INDEX IF NOT EXISTS idx_product_title_trgm ON public."Product" USING gin (title gin_trgm_ops);

-- Product indexes - Brand and category
CREATE INDEX IF NOT EXISTS idx_product_extracted_brand ON public."Product" USING btree ("extractedBrand") WHERE ("extractedBrand" IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_product_product_line ON public."Product" USING btree ("productLine") WHERE ("productLine" IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_product_category ON public."Product" USING btree (category) WHERE (category IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_product_form ON public."Product" USING btree (form) WHERE (form IS NOT NULL);

-- Product indexes - Dosage and volume
CREATE INDEX IF NOT EXISTS idx_product_dosage_value ON public."Product" USING btree ("dosageValue") WHERE ("dosageValue" IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_product_dosage_unit ON public."Product" USING btree ("dosageUnit") WHERE ("dosageUnit" IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_product_volume_value ON public."Product" USING btree ("volumeValue") WHERE ("volumeValue" IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_product_spf_value ON public."Product" USING btree ("spfValue") WHERE ("spfValue" IS NOT NULL);

-- Product indexes - Grouping
CREATE INDEX IF NOT EXISTS idx_product_group ON public."Product" USING btree ("productGroupId") WHERE ("productGroupId" IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_product_group_price ON public."Product" USING btree ("productGroupId", price) WHERE ("productGroupId" IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_product_core_identity ON public."Product" USING btree ("coreProductIdentity") WHERE ("coreProductIdentity" IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_product_computed_group ON public."Product" USING btree ("computedGroupId");

-- Product indexes - Search
CREATE INDEX IF NOT EXISTS idx_product_search_tokens ON public."Product" USING gin ("searchTokens") WHERE ("searchTokens" IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_product_keyword_tags ON public."Product" USING gin ("keywordTags") WHERE ("keywordTags" IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_product_normalized_lower ON public."Product" USING btree (lower("normalizedName")) WHERE ("normalizedName" IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_product_normalized_trgm ON public."Product" USING gin ("normalizedName" gin_trgm_ops) WHERE ("normalizedName" IS NOT NULL);

-- Product indexes - Processing status
CREATE INDEX IF NOT EXISTS idx_product_processed ON public."Product" USING btree ("processedAt") WHERE ("processedAt" IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_product_unprocessed ON public."Product" USING btree (id) WHERE ("processedAt" IS NULL);
