-- Additive catalog identity and immutable observation storage. Account/group
-- history tables remain intact; legacy keys are never guessed into a new SKU.
CREATE TABLE IF NOT EXISTS "CatalogSku" (
    id text PRIMARY KEY,
    family_id text NOT NULL,
    identity_version text NOT NULL,
    identity_signature text NOT NULL,
    display_name text NOT NULL,
    normalized_title text NOT NULL,
    brand text NOT NULL DEFAULT '',
    category text NOT NULL DEFAULT '',
    form text NOT NULL DEFAULT '',
    quantity integer NOT NULL DEFAULT 0,
    dosage_value double precision NOT NULL DEFAULT 0,
    dosage_unit text NOT NULL DEFAULT '',
    volume_value double precision NOT NULL DEFAULT 0,
    volume_unit text NOT NULL DEFAULT '',
    comparable boolean NOT NULL DEFAULT false,
    match_method text NOT NULL,
    gtin text NOT NULL DEFAULT '',
    unit_quantity double precision NOT NULL DEFAULT 0,
    unit_label text NOT NULL DEFAULT '',
    search_tokens text[] NOT NULL DEFAULT '{}',
    attributes jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_sku_tokens ON "CatalogSku" USING gin(search_tokens);
CREATE INDEX IF NOT EXISTS idx_catalog_sku_title_prefix ON "CatalogSku" (normalized_title text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_catalog_sku_title_trgm ON "CatalogSku" USING gin(normalized_title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_catalog_sku_family ON "CatalogSku" (family_id);
CREATE INDEX IF NOT EXISTS idx_catalog_sku_brand ON "CatalogSku" (brand);
CREATE INDEX IF NOT EXISTS idx_catalog_sku_category ON "CatalogSku" (category);

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS sku_id text REFERENCES "CatalogSku"(id);
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS source_product_id text;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS gtin text NOT NULL DEFAULT '';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS availability text NOT NULL DEFAULT 'unknown'
    CHECK (availability IN ('unknown','available','unavailable'));
CREATE INDEX IF NOT EXISTS idx_product_sku_price ON "Product" (sku_id,price);
CREATE INDEX IF NOT EXISTS idx_product_price_observed ON "Product" ("priceScrapedAt");
CREATE INDEX IF NOT EXISTS idx_product_source ON "Product" ("vendorId",source_product_id);

CREATE TABLE IF NOT EXISTS "CatalogLexeme" (term text PRIMARY KEY, sku_count integer NOT NULL);
CREATE INDEX IF NOT EXISTS idx_catalog_lexeme_prefix ON "CatalogLexeme" (term text_pattern_ops);

CREATE TABLE IF NOT EXISTS "CatalogRun" (
    id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    status text NOT NULL CHECK (status IN ('running','ok','error')),
    identity_version text NOT NULL,
    offer_count integer NOT NULL DEFAULT 0,
    sku_count integer NOT NULL DEFAULT 0,
    details jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_catalog_run_finished ON "CatalogRun" (finished_at DESC) WHERE status='ok';

-- No foreign keys to the replaceable source catalog: observations must survive
-- delisting and catalog-only syncs. The immutable source/title/vendor evidence is
-- retained so a historical identity can be reviewed after a matching revision.
CREATE TABLE IF NOT EXISTS "OfferPriceObservation" (
    id bigserial PRIMARY KEY,
    source_key text NOT NULL,
    sku_id text NOT NULL,
    vendor_id text NOT NULL,
    vendor_name text NOT NULL,
    title text NOT NULL,
    link text NOT NULL,
    price double precision NOT NULL CHECK (price>0),
    availability text NOT NULL,
    observed_at timestamptz NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(source_key,observed_at,price,availability)
);
CREATE INDEX IF NOT EXISTS idx_offer_observation_sku_time ON "OfferPriceObservation" (sku_id,observed_at);
CREATE TABLE IF NOT EXISTS "CatalogPriceHistory" (
    sku_id text NOT NULL,
    observed_at timestamptz NOT NULL,
    min_price double precision NOT NULL,
    offer_count integer NOT NULL,
    PRIMARY KEY(sku_id,observed_at)
);
CREATE TABLE IF NOT EXISTS "CatalogIdentityAlias" (
    legacy_key text PRIMARY KEY,
    sku_id text,
    candidate_count integer NOT NULL,
    reviewed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "Watch" ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;
ALTER TABLE "Watch" ADD COLUMN IF NOT EXISTS review_reason text;

CREATE TABLE IF NOT EXISTS "ScraperRun" (
    id text PRIMARY KEY,
    scraper text NOT NULL,
    started_at timestamptz NOT NULL,
    finished_at timestamptz NOT NULL,
    status text NOT NULL,
    products integer NOT NULL DEFAULT 0,
    attempt integer NOT NULL DEFAULT 1,
    details jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_scraper_run_source_time ON "ScraperRun" (scraper,finished_at DESC);
