-- Source ingestion and the published catalog have different lifecycles. Queries
-- read an atomic offer snapshot, never half-imported/enriched Product rows.
CREATE TABLE IF NOT EXISTS "CatalogOffer" (
    id text PRIMARY KEY,
    sku_id text NOT NULL REFERENCES "CatalogSku"(id),
    "vendorId" text NOT NULL,
    title text NOT NULL,
    price double precision NOT NULL,
    link text NOT NULL,
    thumbnail text NOT NULL DEFAULT '',
    "priceScrapedAt" timestamptz,
    availability text NOT NULL DEFAULT 'unknown',
    source_product_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_catalog_offer_sku_price ON "CatalogOffer" (sku_id,price);
CREATE INDEX IF NOT EXISTS idx_catalog_offer_vendor ON "CatalogOffer" ("vendorId");
CREATE INDEX IF NOT EXISTS idx_catalog_offer_observed ON "CatalogOffer" ("priceScrapedAt");
CREATE TABLE IF NOT EXISTS "CatalogPublication" (
    id integer PRIMARY KEY CHECK (id=1),
    run_id text NOT NULL,
    published_at timestamptz NOT NULL
);

-- A title is mutable presentation, not a source identity. Existing source IDs
-- have been backfilled by catalog-rebuild; NULL remains compatible with legacy
-- importers until their first v2 import.
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_title_vendorId_key";
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_vendor_source_unique ON "Product" ("vendorId",source_product_id) WHERE source_product_id IS NOT NULL;
ALTER TABLE "ScraperRun" ADD COLUMN IF NOT EXISTS vendor_name text NOT NULL DEFAULT '';

INSERT INTO "CatalogOffer"(id,sku_id,"vendorId",title,price,link,thumbnail,"priceScrapedAt",availability,source_product_id)
SELECT id,sku_id,"vendorId",title,price,link,COALESCE(thumbnail,''),"priceScrapedAt",availability,COALESCE(source_product_id,link)
FROM "Product" WHERE sku_id IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO "CatalogPublication"(id,run_id,published_at)
SELECT 1,id,finished_at FROM "CatalogRun" WHERE status='ok' ORDER BY finished_at DESC LIMIT 1 ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS "OfferLifecycle" (
    id bigserial PRIMARY KEY,
    source_key text NOT NULL,
    sku_id text,
    vendor_id text NOT NULL,
    title text NOT NULL,
    link text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('not_seen_in_complete_snapshot')),
    observed_at timestamptz NOT NULL,
    UNIQUE(source_key,kind,observed_at)
);
