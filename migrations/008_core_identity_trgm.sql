-- Migration: 008_core_identity_trgm
-- Trigram index on coreProductIdentity so concept-based search can do fast
-- fuzzy (typo-tolerant) matching on the short identity string rather than the
-- whole title (e.g. "magnezium" -> "magnesium").

CREATE INDEX IF NOT EXISTS idx_product_core_trgm
    ON public."Product" USING gin ("coreProductIdentity" gin_trgm_ops)
    WHERE ("coreProductIdentity" IS NOT NULL);
