-- LLM-canonicalized per-product identity (brand + line/stage/variant), mined
-- per-brand for products the rule-based extractor collapses to a bare brand
-- (e.g. "Oligovit SE"/"Oligovit HER", "Aptamil 1/2/3" stages, "Kaltex Daily
-- Stress Support"). When present, matching.BuildGroupKey trusts it verbatim as the
-- group identity instead of re-deriving from the (lossy) coreProductIdentity.
-- The rule pipeline never writes this column, so a re-extract preserves it.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "canonicalIdentity" text;
