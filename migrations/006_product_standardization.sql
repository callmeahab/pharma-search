-- Migration: Create ProductStandardization table
-- This table stores manually standardized product names from Excel import
-- Used as primary lookup before falling back to rule-based extraction

-- Create the table
CREATE TABLE IF NOT EXISTS public."ProductStandardization" (
    id SERIAL PRIMARY KEY,

    -- The standardized/corrected title (what it should be)
    title TEXT NOT NULL,

    -- The original title as scraped (for matching)
    "originalTitle" TEXT,

    -- Product category
    category TEXT,

    -- Lowercase normalized version
    "normalizedName" TEXT NOT NULL,

    -- Extracted dosage information
    "dosageValue" NUMERIC(15,6),
    "dosageUnit" TEXT,

    -- Additional extracted fields (can be populated by ML later)
    "volumeValue" NUMERIC(15,6),
    "volumeUnit" TEXT,
    "brandName" TEXT,
    "productForm" TEXT,
    "quantityValue" INTEGER,
    "quantityUnit" TEXT,

    -- Confidence score (1.0 for manual imports, lower for ML)
    confidence NUMERIC(3,2) DEFAULT 1.0,

    -- Source of the standardization
    source TEXT DEFAULT 'excel_import',

    -- Timestamps
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add comment
COMMENT ON TABLE public."ProductStandardization" IS 'Manually standardized product names for lookup during processing';

-- Create indexes for fast lookups
-- Primary lookup: match on originalTitle (case-insensitive)
CREATE INDEX IF NOT EXISTS idx_standardization_original_title_lower
    ON public."ProductStandardization" (LOWER("originalTitle"));

-- Trigram index for fuzzy matching on originalTitle
CREATE INDEX IF NOT EXISTS idx_standardization_original_title_trgm
    ON public."ProductStandardization" USING gin ("originalTitle" gin_trgm_ops);

-- Index on standardized title
CREATE INDEX IF NOT EXISTS idx_standardization_title_lower
    ON public."ProductStandardization" (LOWER(title));

-- Index on normalized name
CREATE INDEX IF NOT EXISTS idx_standardization_normalized
    ON public."ProductStandardization" ("normalizedName");

-- Index on category for filtering
CREATE INDEX IF NOT EXISTS idx_standardization_category
    ON public."ProductStandardization" (category) WHERE category IS NOT NULL;

-- Index on source for filtering by import type
CREATE INDEX IF NOT EXISTS idx_standardization_source
    ON public."ProductStandardization" (source);

-- Create unique constraint on originalTitle to prevent duplicates
-- Note: Some originalTitles may map to different standardized titles (different sizes)
-- So we need a composite unique on originalTitle + title
CREATE UNIQUE INDEX IF NOT EXISTS idx_standardization_unique_mapping
    ON public."ProductStandardization" ("originalTitle", title);

-- Create trigger for updatedAt
CREATE OR REPLACE FUNCTION update_standardization_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_standardization_updated_at ON public."ProductStandardization";
CREATE TRIGGER update_standardization_updated_at
    BEFORE UPDATE ON public."ProductStandardization"
    FOR EACH ROW
    EXECUTE FUNCTION update_standardization_updated_at();

-- Create a lookup function for the Go backend
CREATE OR REPLACE FUNCTION lookup_standardization(search_title TEXT)
RETURNS TABLE (
    standardized_title TEXT,
    normalized_name TEXT,
    dosage_value NUMERIC,
    dosage_unit TEXT,
    volume_value NUMERIC,
    volume_unit TEXT,
    brand_name TEXT,
    product_form TEXT,
    confidence NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ps.title,
        ps."normalizedName",
        ps."dosageValue",
        ps."dosageUnit",
        ps."volumeValue",
        ps."volumeUnit",
        ps."brandName",
        ps."productForm",
        ps.confidence
    FROM "ProductStandardization" ps
    WHERE LOWER(ps."originalTitle") = LOWER(search_title)
    ORDER BY ps.confidence DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION lookup_standardization IS 'Lookup standardized product info by original title';
