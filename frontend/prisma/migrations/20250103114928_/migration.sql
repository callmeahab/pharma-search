/*
  Warnings:

  - You are about to drop the column `url` on the `Vendor` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Vendor" DROP COLUMN "url",
ADD COLUMN     "scraperFile" TEXT,
ADD COLUMN     "website" TEXT,
ALTER COLUMN "logo" DROP NOT NULL;
