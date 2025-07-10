/*
  Warnings:

  - You are about to drop the column `productGroupId` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the `ProductGroup` table. If the table is not empty, all the data it contains will be lost.
  - The references from Brand, ProductName, and Unit tables to ProductGroup have been removed.

*/

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_productGroupId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "Product_productGroupId_idx";

-- DropIndex  
DROP INDEX IF EXISTS "ProductGroup_groupKey_idx";

-- AlterTable
ALTER TABLE "Product" DROP COLUMN IF EXISTS "productGroupId";

-- DropTable
DROP TABLE IF EXISTS "ProductGroup";

-- Note: Dependent views were dropped manually before this migration:
-- DROP MATERIALIZED VIEW IF EXISTS "ProductGroupStats" CASCADE;
-- DROP VIEW IF EXISTS "PriceComparisonView" CASCADE; 
-- DROP VIEW IF EXISTS "GroupingSummary" CASCADE;