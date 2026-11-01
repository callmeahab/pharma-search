-- Optional, first-party aggregate usage measurements. No query text, product
-- names, external URLs, account IDs, IP addresses or user agents are collected.
CREATE TABLE IF NOT EXISTS "CatalogEvent" (
    id bigserial PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('search_complete','product_click','store_click')),
    request_id text NOT NULL DEFAULT '',
    rank integer,
    result_count integer,
    offer_count integer,
    latency_ms double precision,
    filter_count integer,
    corrected boolean,
    recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_event_time ON "CatalogEvent" (recorded_at);
CREATE INDEX IF NOT EXISTS idx_catalog_event_request ON "CatalogEvent" (request_id);
