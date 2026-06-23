-- Migration: 011_price_scraped_at
-- Records when each product's price was actually SCRAPED (from the CSV's
-- scrapedAt column), distinct from "updatedAt" — which the importer bumps to
-- now() on every run as the delist watermark, so it can't represent price age.
-- Powers the "price retrieved <when>" freshness indicator in the UI.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "priceScrapedAt" timestamptz;
