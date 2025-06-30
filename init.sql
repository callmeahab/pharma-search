-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
-- Add new columns to Product table
ALTER TABLE "Product"
ADD COLUMN IF NOT EXISTS "normalizedName" TEXT;
ALTER TABLE "Product"
ADD COLUMN IF NOT EXISTS "productGroupId" TEXT;
ALTER TABLE "Product"
ADD COLUMN IF NOT EXISTS "processedAt" TIMESTAMP(3);
ALTER TABLE "Product"
ADD COLUMN IF NOT EXISTS "searchTokens" TEXT [];
ALTER TABLE "Product"
ADD COLUMN IF NOT EXISTS "dosageValue" DECIMAL;
ALTER TABLE "Product"
ADD COLUMN IF NOT EXISTS "dosageUnit" TEXT;
-- Create ProductGroup table
CREATE TABLE IF NOT EXISTS "ProductGroup" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "normalizedName" TEXT NOT NULL,
    "brandId" TEXT,
    "productNameId" TEXT,
    "dosageValue" DECIMAL,
    "dosageUnit" TEXT,
    "unitId" TEXT,
    "groupKey" TEXT NOT NULL,
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductGroup_pkey" PRIMARY KEY ("id")
);
-- Add indexes with CONCURRENTLY for production safety
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_productGroupId_idx" ON "Product"("productGroupId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_normalizedName_idx" ON "Product"("normalizedName");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_searchTokens_idx" ON "Product" USING GIN("searchTokens");
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "ProductGroup_groupKey_idx" ON "ProductGroup"("groupKey");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_normalizedName_trgm_idx" ON "Product" USING GIN("normalizedName" gin_trgm_ops);
-- Add foreign keys if not exists
DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Product_productGroupId_fkey'
) THEN
ALTER TABLE "Product"
ADD CONSTRAINT "Product_productGroupId_fkey" FOREIGN KEY ("productGroupId") REFERENCES "ProductGroup"("id") ON DELETE
SET NULL ON UPDATE CASCADE;
END IF;
END $$;