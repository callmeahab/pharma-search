-- Bounded suggestions per lexeme are rebuilt with the atomic publication. The
-- full search remains exhaustive; autocomplete is a small discovery preview.
CREATE TABLE IF NOT EXISTS "CatalogSuggestion" (
 term text NOT NULL,
 sku_id text NOT NULL,
 display_name text NOT NULL,
 normalized_title text NOT NULL,
 vendor_count integer NOT NULL,
 PRIMARY KEY(term,sku_id)
);
CREATE INDEX IF NOT EXISTS idx_catalog_suggestion_term ON "CatalogSuggestion"(term text_pattern_ops);
