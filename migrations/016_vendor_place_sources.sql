-- Migration: 016_vendor_place_sources
-- Treat VendorPlace.foursquareId as a generic provider place id scoped by source.

ALTER TABLE public."VendorPlace"
    ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'foursquare';

ALTER TABLE public."VendorPlace"
    DROP CONSTRAINT IF EXISTS "VendorPlace_vendor_foursquare_key";

ALTER TABLE public."VendorPlace"
    DROP CONSTRAINT IF EXISTS "VendorPlace_vendor_source_external_key";

ALTER TABLE public."VendorPlace"
    ADD CONSTRAINT "VendorPlace_vendor_source_external_key"
    UNIQUE ("vendorId", source, "foursquareId");

CREATE INDEX IF NOT EXISTS idx_vendor_place_source ON public."VendorPlace" (source);
