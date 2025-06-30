/*
  Warnings:

  - A unique constraint covering the columns `[name]` on the table `Category` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[title,vendorId]` on the table `Product` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[email]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[name]` on the table `Vendor` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "brandConfidence" DOUBLE PRECISION,
ADD COLUMN     "brandId" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "dosageUnit" TEXT,
ADD COLUMN     "dosageValue" DECIMAL(65,30),
ADD COLUMN     "normalizedName" TEXT,
ADD COLUMN     "originalTitle" TEXT,
ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "productGroupId" TEXT,
ADD COLUMN     "productNameConfidence" DOUBLE PRECISION,
ADD COLUMN     "productNameId" TEXT,
ADD COLUMN     "quantity" INTEGER,
ADD COLUMN     "quantityConfidence" DOUBLE PRECISION,
ADD COLUMN     "searchTokens" TEXT[],
ADD COLUMN     "searchVector" tsvector,
ADD COLUMN     "titleEmbedding" BYTEA,
ADD COLUMN     "unitConfidence" DOUBLE PRECISION,
ADD COLUMN     "unitId" TEXT,
ALTER COLUMN "price" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "category" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "embedding" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductName" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "embedding" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductName_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductGroup" (
    "id" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "brandId" TEXT,
    "productNameId" TEXT,
    "dosageValue" DECIMAL(65,30),
    "dosageUnit" TEXT,
    "unitId" TEXT,
    "groupKey" TEXT NOT NULL,
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_name_key" ON "Unit"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ProductName_name_key" ON "ProductName"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ProductGroup_groupKey_key" ON "ProductGroup"("groupKey");

-- CreateIndex
CREATE INDEX "ProductGroup_groupKey_idx" ON "ProductGroup"("groupKey");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE INDEX "Product_searchVector_idx" ON "Product" USING GIN ("searchVector");

-- CreateIndex
CREATE INDEX "Product_productGroupId_idx" ON "Product"("productGroupId");

-- CreateIndex
CREATE INDEX "Product_normalizedName_idx" ON "Product"("normalizedName");

-- CreateIndex
CREATE INDEX "Product_searchTokens_idx" ON "Product" USING GIN ("searchTokens");

-- CreateIndex
CREATE UNIQUE INDEX "Product_title_vendorId_key" ON "Product"("title", "vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_name_key" ON "Vendor"("name");

-- AddForeignKey
ALTER TABLE "ProductGroup" ADD CONSTRAINT "ProductGroup_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductGroup" ADD CONSTRAINT "ProductGroup_productNameId_fkey" FOREIGN KEY ("productNameId") REFERENCES "ProductName"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductGroup" ADD CONSTRAINT "ProductGroup_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_productNameId_fkey" FOREIGN KEY ("productNameId") REFERENCES "ProductName"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_productGroupId_fkey" FOREIGN KEY ("productGroupId") REFERENCES "ProductGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
