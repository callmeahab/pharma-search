-- Migration: 015_vendor_places
-- Local cache of Foursquare Places data for physical vendor/pharmacy locations.
-- A Vendor can have many branches, while the existing Vendor table remains the
-- catalog/product owner.

CREATE TABLE IF NOT EXISTS public."VendorPlace" (
    id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "vendorId" text NOT NULL REFERENCES public."Vendor"(id) ON UPDATE CASCADE ON DELETE CASCADE,
    "foursquareId" text NOT NULL,
    name text NOT NULL,
    address text,
    locality text,
    region text,
    postcode text,
    country text,
    "formattedAddress" text,
    phone text,
    email text,
    website text,
    "hoursDisplay" text,
    "openNow" boolean,
    hours jsonb NOT NULL DEFAULT '{}'::jsonb,
    categories jsonb NOT NULL DEFAULT '[]'::jsonb,
    chains jsonb NOT NULL DEFAULT '[]'::jsonb,
    photos jsonb NOT NULL DEFAULT '[]'::jsonb,
    "socialMedia" jsonb NOT NULL DEFAULT '{}'::jsonb,
    rating double precision,
    popularity double precision,
    price integer,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    timezone text,
    "mapsUrl" text,
    source text NOT NULL DEFAULT 'foursquare',
    "rawPlace" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "fetchedAt" timestamptz NOT NULL DEFAULT now(),
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "VendorPlace_vendor_foursquare_key" UNIQUE ("vendorId", "foursquareId")
);

CREATE INDEX IF NOT EXISTS idx_vendor_place_vendor ON public."VendorPlace" ("vendorId");
CREATE INDEX IF NOT EXISTS idx_vendor_place_city ON public."VendorPlace" (locality);
CREATE INDEX IF NOT EXISTS idx_vendor_place_coordinates ON public."VendorPlace" (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_vendor_place_fetched ON public."VendorPlace" ("fetchedAt");
