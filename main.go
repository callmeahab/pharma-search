package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/smtp"
	"os"
	"sort"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/lib/pq"
	"github.com/rs/cors"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	"google.golang.org/protobuf/types/known/structpb"

	pb "github.com/callmeahab/pharma-search/gen"
	"github.com/callmeahab/pharma-search/gen/pbconnect"
	"github.com/callmeahab/pharma-search/internal/matching"
)

type server struct {
	db              *sql.DB
	featuredCache   []FeaturedGroup
	featuredCacheAt time.Time
	// Bounded LRU of grouped search results (shared by the unary + streaming handlers).
	searchCache *searchResultCache
}

func connectDB() (*sql.DB, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:docker@localhost:5432/pharma_search?sslmode=disable"
	}
	return sql.Open("postgres", dbURL)
}

// productSelectCols is the column list shared by every product query below; the
// scan order in scanProductRows MUST match it exactly.
const productSelectCols = `
	p.id, p.title, p.price, p."vendorId", v.name as vendor_name, p.link,
	COALESCE(p.thumbnail, '') as thumbnail,
	COALESCE(p."extractedBrand", '') as brand,
	COALESCE(p."normalizedName", '') as normalized_name,
	COALESCE(p."coreProductIdentity", '') as core_product_identity,
	COALESCE(p."canonicalIdentity", '') as canonical_identity,
	p."dosageValue", COALESCE(p."dosageUnit", '') as dosage_unit,
	p."volumeValue", COALESCE(p."volumeUnit", '') as volume_unit,
	COALESCE(p.form, '') as form, COALESCE(p."canonicalCategory", '') as category,
	p."quantityValue", p."priceScrapedAt"`

// fuzzyFallbackMin: only run the (slower) fuzzy trigram pass when the precise,
// index-served path returns fewer than this many hits — i.e. a query that found almost
// nothing exact (a typo / unknown spelling). Kept low: when the precise pass already
// found a coherent set, fuzzy expansion only pollutes it with weak trigram neighbours
// that share a prefix but are different products (searching "fervex" must not dredge up
// Ferin / Ferrolin / Fervance / Salvit Fervit, whose similarity ~0.3 is barely below a
// real typo's ~0.44, so a similarity threshold can't separate them — the count gate can).
const fuzzyFallbackMin = 3

func scanProductRows(rows *sql.Rows) ([]map[string]interface{}, error) {
	defer rows.Close()
	var results []map[string]interface{}
	for rows.Next() {
		var id, title, vendorId, vendorName, link, thumbnail string
		var brand, normalizedName, coreProductIdentity, canonicalIdentity, dosageUnit, volumeUnit, form, category string
		var price, dosageValue, volumeValue sql.NullFloat64
		var quantityValue sql.NullInt64
		var updatedAt sql.NullTime

		if err := rows.Scan(&id, &title, &price, &vendorId, &vendorName, &link, &thumbnail,
			&brand, &normalizedName, &coreProductIdentity, &canonicalIdentity,
			&dosageValue, &dosageUnit, &volumeValue, &volumeUnit, &form, &category, &quantityValue, &updatedAt); err != nil {
			return nil, fmt.Errorf("scan error: %w", err)
		}

		priceVal := 0.0
		if price.Valid {
			priceVal = price.Float64
		}
		updatedAtStr := ""
		if updatedAt.Valid {
			updatedAtStr = updatedAt.Time.UTC().Format(time.RFC3339)
		}

		results = append(results, map[string]interface{}{
			"id":                  id,
			"title":               title,
			"price":               priceVal, // DB stores price in RSD directly
			"vendorId":            vendorId,
			"vendorName":          vendorName,
			"link":                link,
			"thumbnail":           thumbnail,
			"brand":               brand,
			"normalizedName":      normalizedName,
			"coreProductIdentity": coreProductIdentity,
			"canonicalIdentity":   canonicalIdentity,
			"dosageValue":         dosageValue.Float64,
			"dosageUnit":          dosageUnit,
			"volumeValue":         volumeValue.Float64,
			"volumeUnit":          volumeUnit,
			"form":                form,
			"category":            category,
			"quantityValue":       float64(quantityValue.Int64),
			"updatedAt":           updatedAtStr,
		})
	}
	return results, rows.Err()
}

// searchProductsDB returns matching products (up to limit). With no query but
// brand/category filters it BROWSES the indexed canonicalCategory/extractedBrand
// columns directly (home-page category navigation). With a query it runs an
// index-served PRECISE pass (concept @> + substring ILIKE, all GIN-indexed) and
// only falls back to the slower fuzzy trigram pass when the precise pass is sparse
// (a typo'd/alias query). This avoids the full-table seq scan + per-row similarity()
// sort the old single-query design forced on every search.
func searchProductsDB(db *sql.DB, query string, limit int, browseBrands, browseCategories []string) ([]map[string]interface{}, error) {
	if db == nil {
		return nil, fmt.Errorf("database not connected")
	}
	if limit <= 0 {
		limit = 5000
	}

	rawQuery := strings.TrimSpace(query)

	// BROWSE: no search term -> drive results off the brand/category filters. Used by
	// the home page. Ordered by vendor coverage (how many pharmacies stock the product)
	// so the working set is the category's POPULAR/canonical products, not the cheapest
	// — ORDER BY price ASC would cap a 69k-row category to its sub-330-RSD tail and hide
	// every premium brand. The Go grouper then re-ranks by precise vendor_count.
	if rawQuery == "" {
		if len(browseBrands) == 0 && len(browseCategories) == 0 {
			return []map[string]interface{}{}, nil
		}
		// pq.Array(nil) binds as SQL NULL (not '{}'), which would make the cardinality
		// check NULL and drop every row — so coerce nil to an empty slice.
		if browseCategories == nil {
			browseCategories = []string{}
		}
		if browseBrands == nil {
			browseBrands = []string{}
		}
		rows, err := db.Query(`
			SELECT `+productSelectCols+`
			FROM "Product" p
			JOIN "Vendor" v ON v.id = p."vendorId"
			LEFT JOIN (
				SELECT pp."coreProductIdentity" AS ci, count(DISTINCT pp."vendorId") AS n
				FROM "Product" pp
				WHERE pp.price > 0
				  AND (cardinality($1::text[]) = 0 OR pp."canonicalCategory" = ANY($1))
				  AND (cardinality($2::text[]) = 0 OR pp."extractedBrand" = ANY($2))
				  AND pp."coreProductIdentity" <> ''
				GROUP BY pp."coreProductIdentity"
			) vc ON vc.ci = p."coreProductIdentity"
			WHERE p.price > 0
			  AND (cardinality($1::text[]) = 0 OR p."canonicalCategory" = ANY($1))
			  AND (cardinality($2::text[]) = 0 OR p."extractedBrand" = ANY($2))
			ORDER BY COALESCE(vc.n, 1) DESC, p.price ASC
			LIMIT $3
		`, pq.Array(browseCategories), pq.Array(browseBrands), limit)
		if err != nil {
			return nil, fmt.Errorf("browse query error: %w", err)
		}
		return scanProductRows(rows)
	}

	normalizedQuery := matching.NormalizeText(rawQuery)
	if normalizedQuery == "" {
		normalizedQuery = strings.ToLower(rawQuery)
	}
	rawLikePattern := "%" + escapeLikePattern(rawQuery) + "%"
	// SearchConcepts maps the query to canonical "concept" tokens (ingredient
	// mentions -> a single compact canonical, so spelling/language variants unify).
	// required uses AND semantics via the indexed @> operator.
	required, _ := matching.SearchConcepts(rawQuery)

	// PRECISE pass — every branch is GIN-indexable (searchTokens @>, trgm ILIKE on
	// title/normalizedName/coreProductIdentity). Patterns are bound params and the
	// indexed columns are NOT wrapped in COALESCE, so the planner BitmapOr's the four
	// indexes instead of seq-scanning. Ordering is cheap (no per-row similarity());
	// convertHitsToGroups re-ranks the resulting groups anyway.
	rows, err := db.Query(`
		SELECT `+productSelectCols+`
		FROM "Product" p
		JOIN "Vendor" v ON v.id = p."vendorId"
		WHERE p.price > 0
		  AND (
			(cardinality($2::text[]) > 0 AND p."searchTokens" @> $2)
			OR p.title ILIKE $1
			OR p."normalizedName" ILIKE $1
			OR p."coreProductIdentity" ILIKE $1
		  )
		ORDER BY
			CASE
				WHEN lower(p."coreProductIdentity") = $3 THEN 0
				WHEN cardinality($2::text[]) > 0 AND p."searchTokens" @> $2 THEN 1
				WHEN p."normalizedName" ILIKE $1 THEN 2
				WHEN p."coreProductIdentity" ILIKE $1 THEN 3
				ELSE 4
			END,
			-- Relevance within the tier so the LIMIT cut keeps the most relevant rows
			-- (not the cheapest) for broad queries whose match set exceeds the limit.
			-- Runs only on the index-narrowed match set, not a full table scan.
			GREATEST(
				similarity(p.title, $3),
				similarity(p."normalizedName", $3),
				similarity(p."coreProductIdentity", $3),
				word_similarity($3, p.title)
			) DESC,
			p.price ASC
		LIMIT $4
	`, rawLikePattern, pq.Array(required), normalizedQuery, limit)
	if err != nil {
		return nil, fmt.Errorf("search query error: %w", err)
	}
	results, err := scanProductRows(rows)
	if err != nil {
		return nil, err
	}

	// FUZZY FALLBACK — only when the precise pass is sparse (typo'd/alias query). The
	// `%`/`<%` operators are GIN-trgm-indexable on their own (no @> OR to defeat them).
	allowFuzzy := len(required) <= 1
	if allowFuzzy && len(results) < fuzzyFallbackMin {
		frows, ferr := db.Query(`
			SELECT `+productSelectCols+`
			FROM "Product" p
			JOIN "Vendor" v ON v.id = p."vendorId"
			WHERE p.price > 0
			  AND (
				p."coreProductIdentity" % $1
				OR p.title % $1
				OR $1 <% p.title
				OR $1 <% p."normalizedName"
			  )
			ORDER BY GREATEST(
				similarity(p.title, $1),
				similarity(p."coreProductIdentity", $1),
				word_similarity($1, p.title)
			) DESC
			LIMIT $2
		`, normalizedQuery, limit)
		if ferr == nil {
			fuzzy, _ := scanProductRows(frows)
			seen := make(map[string]struct{}, len(results))
			for _, r := range results {
				seen[getString(r, "id")] = struct{}{}
			}
			for _, r := range fuzzy {
				if _, ok := seen[getString(r, "id")]; !ok {
					results = append(results, r)
				}
			}
		}
	}

	return results, nil
}

// autocompleteDB returns distinct product title suggestions using trigram/ILIKE matching.
func autocompleteDB(db *sql.DB, query string, limit int) ([]*pb.AutocompleteSuggestion, error) {
	if db == nil {
		return nil, fmt.Errorf("database not connected")
	}
	if limit <= 0 {
		limit = 8
	}

	rawQuery := strings.TrimSpace(query)
	normalizedQuery := matching.NormalizeText(rawQuery)
	if normalizedQuery == "" {
		normalizedQuery = strings.ToLower(rawQuery)
	}

	rawLikePattern := "%" + escapeLikePattern(rawQuery) + "%"
	required, _ := matching.SearchConcepts(rawQuery)
	allowFuzzy := len(required) <= 1

	rows, err := db.Query(`
		WITH q AS (
			SELECT
				$1::text   AS raw_like,
				$2::text   AS norm_query,
				$3::text[] AS required,
				$4::bool   AS allow_fuzzy
		)
		SELECT * FROM (
			SELECT DISTINCT ON (lower(p.title))
				p.id, p.title, p.price, v.name as vendor_name,
				GREATEST(
					similarity(p.title, q.norm_query),
					similarity(COALESCE(p."normalizedName", ''), q.norm_query),
					similarity(COALESCE(p."coreProductIdentity", ''), q.norm_query),
					word_similarity(q.norm_query, p.title)
				) as sim
			FROM "Product" p
			JOIN "Vendor" v ON v.id = p."vendorId"
			CROSS JOIN q
			WHERE p.price > 0
			  AND (
				(cardinality(q.required) > 0 AND COALESCE(p."searchTokens", ARRAY[]::text[]) @> q.required)
				OR p.title ILIKE q.raw_like
				OR COALESCE(p."normalizedName", '') ILIKE q.raw_like
				OR COALESCE(p."coreProductIdentity", '') ILIKE q.raw_like
				OR (q.allow_fuzzy AND COALESCE(p."coreProductIdentity", '') % q.norm_query)
				OR (q.allow_fuzzy AND p.title % q.norm_query)
				-- typo tolerance: word_similarity vs the best word in the title
				-- (catches one-char brand typos). See migration 010.
				OR (q.allow_fuzzy AND q.norm_query <% p.title)
				OR (q.allow_fuzzy AND q.norm_query <% COALESCE(p."normalizedName", ''))
			  )
			ORDER BY lower(p.title), sim DESC
		) sub
		ORDER BY sub.sim DESC
		LIMIT $5
	`, rawLikePattern, normalizedQuery, pq.Array(required), allowFuzzy, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var suggestions []*pb.AutocompleteSuggestion
	for rows.Next() {
		var id, title, vendorName string
		var price sql.NullFloat64
		var sim float64

		if err := rows.Scan(&id, &title, &price, &vendorName, &sim); err != nil {
			return nil, err
		}

		priceVal := 0.0
		if price.Valid {
			priceVal = price.Float64
		}

		suggestions = append(suggestions, &pb.AutocompleteSuggestion{
			Id:         id,
			Title:      title,
			Price:      priceVal,
			VendorName: vendorName,
		})
	}

	return suggestions, nil
}

func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func getStringAny(m map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if value := getString(m, key); value != "" {
			return value
		}
	}
	return ""
}

func getFloat(m map[string]interface{}, key string) float64 {
	if v, ok := m[key]; ok {
		switch t := v.(type) {
		case float64:
			return t
		case float32:
			return float64(t)
		case int:
			return float64(t)
		case int64:
			return float64(t)
		}
	}
	return 0
}

func getFloatAny(m map[string]interface{}, keys ...string) float64 {
	for _, key := range keys {
		if value, ok := m[key]; ok {
			switch t := value.(type) {
			case float64:
				return t
			case float32:
				return float64(t)
			case int:
				return float64(t)
			case int32:
				return float64(t)
			case int64:
				return float64(t)
			}
		}
	}
	return 0
}

func escapeLikePattern(value string) string {
	return strings.NewReplacer("%", "\\%", "_", "\\_").Replace(value)
}

// lowerStringSet builds a case-insensitive lookup set, dropping blanks.
func lowerStringSet(vals []string) map[string]struct{} {
	if len(vals) == 0 {
		return nil
	}
	set := make(map[string]struct{}, len(vals))
	for _, v := range vals {
		if t := strings.ToLower(strings.TrimSpace(v)); t != "" {
			set[t] = struct{}{}
		}
	}
	if len(set) == 0 {
		return nil
	}
	return set
}

// filterHitsByBrandCategory keeps hits whose brand/category match the (case-insensitive)
// filter sets. Empty filters pass everything. Multiple values within a dimension are
// OR'd; the two dimensions are AND'd. Filtering happens in Go (not SQL) so facets can
// be computed from the full hit set, keeping every option visible during refinement.
func filterHitsByBrandCategory(hits []map[string]interface{}, brands, categories []string) []map[string]interface{} {
	bset := lowerStringSet(brands)
	cset := lowerStringSet(categories)
	if bset == nil && cset == nil {
		return hits
	}
	out := make([]map[string]interface{}, 0, len(hits))
	for _, h := range hits {
		if bset != nil {
			if _, ok := bset[strings.ToLower(strings.TrimSpace(getStringAny(h, "brand", "brand_name")))]; !ok {
				continue
			}
		}
		if cset != nil {
			if _, ok := cset[strings.ToLower(strings.TrimSpace(getString(h, "category")))]; !ok {
				continue
			}
		}
		out = append(out, h)
	}
	return out
}

// filterCacheKey folds the active filters into the cache key so a filtered search
// never reuses the unfiltered result (or a different filter set's result). Values
// are normalized exactly as filterGroupsByBrandCategory normalizes them and joined
// with \x1f (which cannot appear in a facet value), so the key can't collide.
func filterCacheKey(base string, brands, categories []string) string {
	if len(brands) == 0 && len(categories) == 0 {
		return base
	}
	norm := func(vals []string) string {
		out := make([]string, 0, len(vals))
		for _, v := range vals {
			if t := strings.ToLower(strings.TrimSpace(v)); t != "" {
				out = append(out, t)
			}
		}
		sort.Strings(out)
		return strings.Join(out, "\x1f")
	}
	return base + "\x1fb=" + norm(brands) + "\x1fc=" + norm(categories)
}

// flattenGroupProducts collects the (vendor-deduped) member products of every group
// — used to compute facets on the same basis as the group/product totals.
func flattenGroupProducts(groups []map[string]interface{}) []map[string]interface{} {
	products := make([]map[string]interface{}, 0)
	for _, group := range groups {
		for _, item := range getSlice(group, "products") {
			if product, ok := item.(map[string]interface{}); ok {
				products = append(products, product)
			}
		}
	}
	return products
}

// filterGroupsByBrandCategory keeps a GROUP if at least one member product satisfies
// ALL active filters (brand AND category), preserving ALL members so price range,
// vendor count and display name stay accurate. Filtering hides non-matching groups;
// it never surgically prunes individual offers out of a matching group (which would
// distort the cross-vendor price comparison and relabel groups).
func filterGroupsByBrandCategory(groups []map[string]interface{}, brands, categories []string) []map[string]interface{} {
	bset := lowerStringSet(brands)
	cset := lowerStringSet(categories)
	if bset == nil && cset == nil {
		return groups
	}
	out := make([]map[string]interface{}, 0, len(groups))
	for _, g := range groups {
		matched := false
		for _, item := range getSlice(g, "products") {
			p, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			if bset != nil {
				if _, in := bset[strings.ToLower(strings.TrimSpace(getStringAny(p, "brand_name", "brand")))]; !in {
					continue
				}
			}
			if cset != nil {
				if _, in := cset[strings.ToLower(strings.TrimSpace(getString(p, "category")))]; !in {
					continue
				}
			}
			matched = true
			break
		}
		if matched {
			out = append(out, g)
		}
	}
	return out
}

func enrichProductsWithGroupKey(hits []map[string]interface{}) []map[string]interface{} {
	products := make([]map[string]interface{}, 0, len(hits))

	for rank, h := range hits {
		title := getString(h, "title")
		normalizedName := getString(h, "normalizedName")
		coreIdentity := getString(h, "coreProductIdentity")
		canonicalIdentity := getString(h, "canonicalIdentity")
		brand := getString(h, "brand")
		dosageValue := getFloat(h, "dosageValue")
		dosageUnit := getString(h, "dosageUnit")
		volumeValue := getFloat(h, "volumeValue")
		volumeUnit := getString(h, "volumeUnit")
		qtyVal := getFloat(h, "quantityValue")
		form := getString(h, "form")

		// DB stores price in RSD directly (not cents like Meilisearch did)
		price := getFloat(h, "price")
		pid := strings.ReplaceAll(getString(h, "id"), "product_", "")

		gk := matching.BuildGroupKey(matching.GroupKeyInput{
			Core:              coreIdentity,
			CanonicalIdentity: canonicalIdentity,
			Brand:             brand,
			Title:             title,
			ProductID:         pid,
			DosageValue:       dosageValue,
			DosageUnit:        dosageUnit,
			VolumeValue:       volumeValue,
			VolumeUnit:        volumeUnit,
			Quantity:          qtyVal,
			Form:              form,
		})

		product := map[string]interface{}{
			"id":                    pid,
			"title":                 title,
			"price":                 price,
			"vendor_id":             getString(h, "vendorId"),
			"vendor_name":           getString(h, "vendorName"),
			"link":                  getString(h, "link"),
			"thumbnail":             getString(h, "thumbnail"),
			"brand_name":            brand,
			"price_updated_at":      getString(h, "updatedAt"),
			"group_key":             gk.Key,
			"group_display":         gk.DisplayName,
			"group_method":          gk.Method,
			"group_residual":        gk.Residual,
			"group_has_measure":     gk.HasMeasure,
			"normalized_name":       normalizedName,
			"core_product_identity": coreIdentity,
			"dosage_value":          dosageValue,
			"dosage_unit":           dosageUnit,
			"volume_value":          volumeValue,
			"volume_unit":           volumeUnit,
			"form":                  form,
			"category":              getString(h, "category"),
			"quantity":              qtyVal,
			"rank":                  rank,
		}

		products = append(products, product)
	}

	return products
}

func candidateQueryScore(candidate, normalizedQuery string, queryTokens, queryVariants []string) int {
	candidate = matching.NormalizeText(candidate)
	if candidate == "" || normalizedQuery == "" {
		return 0
	}

	termScore := func(term string) int {
		if term == "" {
			return 0
		}
		switch {
		case candidate == term:
			return 1200
		case strings.HasPrefix(candidate, term+" "):
			return 1050
		case strings.Contains(candidate, " "+term+" "):
			return 980
		case strings.Contains(candidate, term):
			return 900
		default:
			return 0
		}
	}

	best := termScore(normalizedQuery)
	for _, variant := range queryVariants {
		best = max(best, termScore(variant))
	}

	if len(queryTokens) == 0 {
		return best
	}

	tokenHits := 0
	for _, token := range queryTokens {
		if strings.Contains(candidate, token) {
			tokenHits++
		}
	}

	if tokenHits == 0 {
		return best
	}

	best = max(best, tokenHits*120)
	if tokenHits == len(queryTokens) {
		best = max(best, 700+tokenHits*40)
	}

	return best
}

func groupQueryScore(group map[string]interface{}, query string) int {
	normalizedQuery := matching.NormalizeText(query)
	if normalizedQuery == "" {
		return 0
	}

	queryTokens := matching.Tokenize(query)
	queryVariants := matching.ExpandQueryVariants(query)
	best := 0

	scoreCandidate := func(candidate string, boost int) {
		score := candidateQueryScore(candidate, normalizedQuery, queryTokens, queryVariants)
		if score > 0 {
			best = max(best, score+boost)
		}
	}

	scoreCandidate(getString(group, "normalized_name"), 80)
	scoreCandidate(getString(group, "id"), 30)

	products := getSlice(group, "products")
	for idx, item := range products {
		product, ok := item.(map[string]interface{})
		if !ok {
			continue
		}

		positionBoost := max(0, 40-(idx*10))
		scoreCandidate(getString(product, "title"), 70+positionBoost)
		scoreCandidate(getString(product, "brand_name"), 55+positionBoost)
		scoreCandidate(getString(product, "normalized_name"), 65+positionBoost)
		scoreCandidate(getString(product, "core_product_identity"), 50+positionBoost)

		if idx >= 2 {
			break
		}
	}

	return best
}

func buildGroupDisplayName(products []map[string]interface{}) string {
	if len(products) == 0 {
		return ""
	}

	first := products[0]
	if displayName := strings.TrimSpace(getString(first, "group_display")); displayName != "" {
		return displayName
	}

	bestNormalized := ""
	for _, product := range products {
		normalized := strings.TrimSpace(getString(product, "normalized_name"))
		if normalized == "" {
			continue
		}
		if bestNormalized == "" || len(normalized) < len(bestNormalized) {
			bestNormalized = normalized
		}
	}
	if bestNormalized != "" {
		return bestNormalized
	}

	return getString(first, "title")
}

func compareProductsForVendor(a, b map[string]interface{}) bool {
	aPrice := getFloat(a, "price")
	bPrice := getFloat(b, "price")
	if aPrice != bPrice {
		return aPrice < bPrice
	}

	aRank := getFloat(a, "rank")
	bRank := getFloat(b, "rank")
	if aRank != bRank {
		return aRank < bRank
	}

	return getString(a, "id") < getString(b, "id")
}

func dedupeProductsByVendor(products []map[string]interface{}) ([]map[string]interface{}, int) {
	if len(products) <= 1 {
		return products, 0
	}

	byVendor := make(map[string]map[string]interface{}, len(products))
	for _, product := range products {
		vendorID := getString(product, "vendor_id")
		if vendorID == "" {
			vendorID = getString(product, "id")
		}

		existing, ok := byVendor[vendorID]
		if !ok || compareProductsForVendor(product, existing) {
			byVendor[vendorID] = product
		}
	}

	deduped := make([]map[string]interface{}, 0, len(byVendor))
	for _, product := range byVendor {
		deduped = append(deduped, product)
	}

	sort.Slice(deduped, func(i, j int) bool {
		return compareProductsForVendor(deduped[i], deduped[j])
	})

	return deduped, len(products) - len(deduped)
}

func countVisibleProducts(groups []map[string]interface{}) int {
	total := 0
	for _, group := range groups {
		total += len(getSlice(group, "products"))
	}
	return total
}

func formatQuantityFacetValue(quantity float64) string {
	if quantity <= 0 {
		return ""
	}
	if quantity == math.Trunc(quantity) {
		return fmt.Sprintf("%.0f", quantity)
	}
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.2f", quantity), "0"), ".")
}

// attachSizelessToLines reassigns a measureless brand-keyed/per-offer product to
// the brand-independent line family (prod::<residual>) when that residual already
// has a MEASURED line group in this result set. This unifies sizeless variants of
// a sports/supplement line (e.g. "Ultimate Nutrition Iso Sensation" with no weight)
// with their sized siblings, without affecting devices/cosmetics (whose residuals
// never have a measured line sibling).
func attachSizelessToLines(products []map[string]interface{}) {
	lineResiduals := map[string]bool{}
	for _, p := range products {
		if getString(p, "group_method") == "brand-line" {
			if r := getString(p, "group_residual"); r != "" {
				lineResiduals[r] = true
			}
		}
	}
	if len(lineResiduals) == 0 {
		return
	}
	for _, p := range products {
		method := getString(p, "group_method")
		if method != "brand-sku" && method != "single" {
			continue
		}
		if b, ok := p["group_has_measure"].(bool); ok && b {
			continue // has a size/strength of its own — keep it
		}
		residual := getString(p, "group_residual")
		if residual == "" || !lineResiduals[residual] || len(strings.Fields(residual)) < 2 {
			continue
		}
		p["group_key"] = "prod::" + residual
	}
}

// attachFormlessToDominantForm folds a form-UNKNOWN ingredient group
// (ing:<ingredient>::<strength>) into the most-stocked form variant of the same
// ingredient+strength (ing:<ingredient>::<strength>::form:<F>). Form is only ~41%
// extracted, so the same product otherwise splits into "with form" and "without
// form" groups (e.g. "Vitamin C 1000 MG" vs "Vitamin C 1000 MG Tablete"). Distinct
// forms (tablete vs kapsule) remain separate; only the unknown-form bucket attaches.
func attachFormlessToDominantForm(products []map[string]interface{}) {
	const sep = "::form:"
	// base (ingredient+strength) -> form key -> distinct vendors
	baseForms := map[string]map[string]map[string]struct{}{}
	for _, p := range products {
		if getString(p, "group_method") != "ingredient" {
			continue
		}
		k := getString(p, "group_key")
		idx := strings.Index(k, sep)
		if idx < 0 {
			continue // formless — counted as a target only, not a form variant
		}
		base := k[:idx]
		if baseForms[base] == nil {
			baseForms[base] = map[string]map[string]struct{}{}
		}
		if baseForms[base][k] == nil {
			baseForms[base][k] = map[string]struct{}{}
		}
		baseForms[base][k][getString(p, "vendor_id")] = struct{}{}
	}
	if len(baseForms) == 0 {
		return
	}
	dominant := make(map[string]string, len(baseForms))
	for base, forms := range baseForms {
		bestKey, bestN := "", -1
		for fk, vendors := range forms {
			if n := len(vendors); n > bestN || (n == bestN && fk < bestKey) {
				bestN, bestKey = n, fk
			}
		}
		dominant[base] = bestKey
	}
	for _, p := range products {
		if getString(p, "group_method") != "ingredient" {
			continue
		}
		k := getString(p, "group_key")
		if strings.Contains(k, sep) {
			continue // already has a form
		}
		if dk, ok := dominant[k]; ok {
			p["group_key"] = dk
		}
	}
}

func convertHitsToGroups(hits []map[string]interface{}, query string, db *sql.DB) []map[string]interface{} {
	if len(hits) == 0 {
		return []map[string]interface{}{}
	}

	products := enrichProductsWithGroupKey(hits)
	attachSizelessToLines(products)
	attachFormlessToDominantForm(products)

	type groupData struct {
		firstRank int
		products  []map[string]interface{}
	}
	groupMap := make(map[string]*groupData)
	groupOrder := make([]string, 0)

	for _, p := range products {
		// group_key is always populated by BuildGroupKey (ingredient / brand-sku / per-offer).
		gid := getString(p, "group_key")
		if gid == "" {
			gid = "offer:" + getString(p, "id")
		}
		rank := int(getFloat(p, "rank"))

		if existing, ok := groupMap[gid]; ok {
			existing.products = append(existing.products, p)
		} else {
			groupMap[gid] = &groupData{
				firstRank: rank,
				products:  []map[string]interface{}{p},
			}
			groupOrder = append(groupOrder, gid)
		}
	}

	groups := make([]map[string]interface{}, 0, len(groupMap))

	for _, gid := range groupOrder {
		gd := groupMap[gid]
		rawProductCount := len(gd.products)
		prods, hiddenOfferCount := dedupeProductsByVendor(gd.products)

		prices := make([]float64, 0, len(prods))
		for _, p := range prods {
			prices = append(prices, getFloat(p, "price"))
		}

		minP, maxP, avgP := 0.0, 0.0, 0.0
		if len(prices) > 0 {
			minP, maxP = prices[0], prices[len(prices)-1]
			total := 0.0
			for _, price := range prices {
				total += price
			}
			avgP = total / float64(len(prices))
		}

		displayName := buildGroupDisplayName(prods)
		if displayName == "" {
			displayName = gid
		}

		group := map[string]interface{}{
			"id":              gid,
			"normalized_name": displayName,
			"products":        prods,
			"price_range":     map[string]interface{}{"min": minP, "max": maxP, "avg": avgP},
			"vendor_count":    len(prods),
			"product_count":   rawProductCount,
			"dosage_value":    getFloat(prods[0], "dosage_value"),
			"dosage_unit":     getString(prods[0], "dosage_unit"),
			"relevance_rank":  gd.firstRank,
			"hidden_offers":   hiddenOfferCount,
		}
		group["match_score"] = groupQueryScore(group, query)

		groups = append(groups, group)
	}

	// Sort by relevance (match_score) first. Within the same relevance tier prefer
	// broader coverage — a group offered by many pharmacies is the canonical
	// product for an ingredient query and should outrank a 1-vendor cosmetic
	// listing that merely happens to mention the same word. Then fall back to the
	// search rank and price spread.
	sort.SliceStable(groups, func(i, j int) bool {
		// Compare relevance in coarse tiers (buckets of 100) so groups that match
		// the query about equally well are then ordered by coverage. This stops a
		// 1-vendor listing that scores a few boost points higher from outranking
		// the canonical, widely-stocked group for the same ingredient.
		si := getFloat(groups[i], "match_score")
		sj := getFloat(groups[j], "match_score")
		ti, tj := math.Floor(si/100), math.Floor(sj/100)
		if ti != tj {
			return ti > tj
		}

		ci := getFloat(groups[i], "vendor_count")
		cj := getFloat(groups[j], "vendor_count")
		if ci != cj {
			return ci > cj
		}

		if si != sj {
			return si > sj
		}

		ri := getFloat(groups[i], "relevance_rank")
		rj := getFloat(groups[j], "relevance_rank")
		if ri != rj {
			return ri < rj
		}

		iPriceRange := getMap(groups[i], "price_range")
		jPriceRange := getMap(groups[j], "price_range")
		iSpread := getFloat(iPriceRange, "max") - getFloat(iPriceRange, "min")
		jSpread := getFloat(jPriceRange, "max") - getFloat(jPriceRange, "min")
		if iSpread != jSpread {
			return iSpread > jSpread
		}

		return getString(groups[i], "id") < getString(groups[j], "id")
	})
	return groups
}

func toStructPB(v interface{}) (*structpb.Struct, error) {
	// Always round-trip through JSON: structpb.NewStruct rejects nested types like
	// []map[string]interface{} (which our group payloads contain), whereas the JSON
	// round-trip normalizes every array to []interface{} and every number to
	// float64, making the result structpb-compatible regardless of caller.
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var mm map[string]interface{}
	if err := json.Unmarshal(b, &mm); err != nil {
		return nil, err
	}
	return structpb.NewStruct(mm)
}

func (s *server) Health(ctx context.Context, req *connect.Request[pb.HealthRequest]) (*connect.Response[pb.HealthResponse], error) {
	return connect.NewResponse(&pb.HealthResponse{Status: "healthy"}), nil
}

func (s *server) Autocomplete(ctx context.Context, req *connect.Request[pb.AutocompleteRequest]) (*connect.Response[pb.AutocompleteResponse], error) {
	limit := int(req.Msg.GetLimit())
	if limit <= 0 {
		limit = 8
	}
	suggestions, err := autocompleteDB(s.db, req.Msg.GetQ(), limit)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&pb.AutocompleteResponse{Suggestions: suggestions, Query: req.Msg.GetQ(), Limit: req.Msg.GetLimit()}), nil
}

func (s *server) Search(ctx context.Context, req *connect.Request[pb.SearchRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	limit := int(req.Msg.GetLimit())
	if limit == 0 {
		limit = 5000
	}
	if limit > 5000 {
		limit = 5000
	}

	hits, err := searchProductsDB(s.db, req.Msg.GetQ(), limit, req.Msg.GetBrandNames(), req.Msg.GetCategories())
	if err != nil {
		return nil, err
	}

	// Facets from the full hit set; products from the filtered set.
	facets := buildFacetsFromHits(hits)
	filtered := filterHitsByBrandCategory(hits, req.Msg.GetBrandNames(), req.Msg.GetCategories())
	products := enrichProductsWithGroupKey(filtered)

	// Convert facets to generic map for JSON response
	facetMap := map[string]interface{}{}
	for k, v := range facets {
		values := map[string]interface{}{}
		for fk, fv := range v.Values {
			values[fk] = fv
		}
		facetMap[k] = values
	}

	data := map[string]interface{}{
		"products":         products,
		"total":            len(filtered),
		"offset":           0,
		"limit":            limit,
		"search_type_used": "postgresql",
		"facets":           facetMap,
	}

	jsonBytes, err := json.Marshal(data)
	if err != nil {
		log.Printf("JSON marshal error: %v", err)
		return nil, err
	}

	var jsonData map[string]interface{}
	if err := json.Unmarshal(jsonBytes, &jsonData); err != nil {
		log.Printf("JSON unmarshal error: %v", err)
		return nil, err
	}

	st, err := toStructPB(jsonData)
	if err != nil {
		log.Printf("toStructPB error: %v", err)
		return nil, err
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
}

func (s *server) SearchGroups(ctx context.Context, req *connect.Request[pb.SearchGroupsRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	groupLimit := int(req.Msg.GetLimit())
	if groupLimit == 0 {
		groupLimit = 20
	}

	// Shared cached path: filters double as the BROWSE selector when q is empty
	// (home-page navigation) and are applied group-level inside on a cache miss.
	cached, err := s.cachedGroupedSearch(req.Msg.GetQ(), req.Msg.GetBrandNames(), req.Msg.GetCategories())
	if err != nil {
		return nil, err
	}

	paginatedGroups := cached.groups
	if len(paginatedGroups) > groupLimit {
		paginatedGroups = paginatedGroups[:groupLimit]
	}

	data := map[string]interface{}{
		"groups":           paginatedGroups,
		"total":            len(cached.groups),
		"offset":           0,
		"limit":            groupLimit,
		"search_type_used": "postgresql",
	}
	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
}

func (s *server) SearchGroupsStream(ctx context.Context, req *connect.Request[pb.SearchGroupsRequest], stream *connect.ServerStream[pb.ProductGroupChunk]) error {
	query := strings.TrimSpace(req.Msg.GetQ())
	requestedOffset := int(req.Msg.GetOffset())
	requestedLimit := int(req.Msg.GetLimit())
	if requestedLimit <= 0 {
		requestedLimit = 24 // Default page size
	}

	brandFilter := req.Msg.GetBrandNames()
	categoryFilter := req.Msg.GetCategories()

	// Shared cached path (skips the 5000-row fetch + grouping on a hit).
	cached, err := s.cachedGroupedSearch(query, brandFilter, categoryFilter)
	if err != nil {
		return err
	}

	// Return the requested slice of groups
	totalGroups := len(cached.groups)
	startIdx := requestedOffset
	endIdx := min(requestedOffset+requestedLimit, totalGroups)

	if startIdx >= totalGroups {
		// No more results
		chunk := &pb.ProductGroupChunk{
			Groups:     []*pb.ProductGroup{},
			IsComplete: true,
			Metadata: &pb.SearchMetadata{
				TotalProducts:  int32(cached.totalHits),
				TotalGroups:    int32(totalGroups),
				SearchTypeUsed: "postgresql",
				Facets:         cached.facets,
			},
		}
		return stream.Send(chunk)
	}

	// Send the requested page of groups
	pageGroups := cached.groups[startIdx:endIdx]
	chunk := convertGroupsToProto(pageGroups)
	chunk.IsComplete = true
	chunk.Metadata = &pb.SearchMetadata{
		TotalProducts:  int32(cached.totalHits),
		TotalGroups:    int32(totalGroups),
		SearchTypeUsed: "postgresql",
		Facets:         cached.facets,
	}

	return stream.Send(chunk)
}

// Cache helper methods (thin wrappers over the bounded LRU).
func (s *server) getSearchCache(key string) *cachedSearchResult { return s.searchCache.get(key) }

func (s *server) setSearchCache(key string, result *cachedSearchResult) {
	s.searchCache.put(key, result)
}

// cachedGroupedSearch is the single grouped-search path shared by the unary and
// streaming handlers: on a cache hit it returns the prebuilt, filtered, faceted result
// (skipping the 5000-row fetch + grouping + folding passes entirely); on a miss it
// builds and caches it. The cache key is (normalized query + sorted brand/category
// filters), independent of limit/offset, so pagination reuses one entry.
func (s *server) cachedGroupedSearch(query string, brands, categories []string) (*cachedSearchResult, error) {
	base := matching.NormalizeText(query)
	if base == "" {
		base = strings.ToLower(query)
	}
	key := filterCacheKey(base, brands, categories)
	if c := s.getSearchCache(key); c != nil {
		return c, nil
	}
	hits, err := searchProductsDB(s.db, query, 5000, brands, categories)
	if err != nil {
		return nil, err
	}
	allGroups := convertHitsToGroups(hits, query, s.db)
	// Facets from the FULL grouped set (vendor-deduped) so every option stays visible
	// during multi-select refinement and its count matches what selecting it yields.
	facets := buildFacetsFromHits(flattenGroupProducts(allGroups))
	// Group-level filter: hide non-matching groups but keep all members of matching ones
	// so price range / vendor count / display name stay accurate.
	displayGroups := filterGroupsByBrandCategory(allGroups, brands, categories)
	visible := countVisibleProducts(displayGroups)
	res := &cachedSearchResult{
		groups:    displayGroups,
		facets:    facets,
		totalHits: visible,
		products:  visible, // memory unit for the LRU budget
		cachedAt:  time.Now(),
	}
	s.setSearchCache(key, res)
	return res, nil
}

func (s *server) cleanupSearchCache() {
	ticker := time.NewTicker(1 * time.Minute)
	for range ticker.C {
		s.searchCache.sweepExpired()
		st := s.searchCache.stats()
		total := st.hits + st.misses
		if total > 0 {
			log.Printf("searchcache: %d entries, %d products held, %.0f%% hit rate (%d hits / %d misses)",
				st.entries, st.products, 100*float64(st.hits)/float64(total), st.hits, st.misses)
		}
	}
}

func convertGroupsToProto(groups []map[string]interface{}) *pb.ProductGroupChunk {
	pbGroups := make([]*pb.ProductGroup, 0, len(groups))

	for _, g := range groups {
		products := getSlice(g, "products")
		pbProducts := make([]*pb.Product, 0, len(products))

		for _, p := range products {
			pm, ok := p.(map[string]interface{})
			if !ok {
				continue
			}
			pbProducts = append(pbProducts, &pb.Product{
				Id:          getString(pm, "id"),
				Title:       getString(pm, "title"),
				Price:       getFloat(pm, "price"),
				VendorId:    getString(pm, "vendor_id"),
				VendorName:  getString(pm, "vendor_name"),
				Link:        getString(pm, "link"),
				Thumbnail:   getString(pm, "thumbnail"),
				BrandName:   getString(pm, "brand_name"),
				GroupKey:    getString(pm, "group_key"),
				DosageValue: getFloat(pm, "dosage_value"),
				DosageUnit:  getString(pm, "dosage_unit"),
				Form:           getString(pm, "form"),
				Quantity:       int32(getFloat(pm, "quantity")),
				Rank:           int32(getFloat(pm, "rank")),
				PriceUpdatedAt: getString(pm, "price_updated_at"),
				Category:       getString(pm, "category"),
			})
		}

		priceRange := getMap(g, "price_range")
		pbGroups = append(pbGroups, &pb.ProductGroup{
			Id:             getString(g, "id"),
			NormalizedName: getString(g, "normalized_name"),
			Products:       pbProducts,
			PriceRange: &pb.PriceRange{
				Min: getFloat(priceRange, "min"),
				Max: getFloat(priceRange, "max"),
				Avg: getFloat(priceRange, "avg"),
			},
			VendorCount:  int32(getFloat(g, "vendor_count")),
			ProductCount: int32(getFloat(g, "product_count")),
			DosageValue:  getFloat(g, "dosage_value"),
			DosageUnit:   getString(g, "dosage_unit"),
		})
	}

	return &pb.ProductGroupChunk{Groups: pbGroups}
}

func buildFacetsFromHits(hits []map[string]interface{}) map[string]*pb.FacetValues {
	facetCounts := make(map[string]map[string]int)

	for _, hit := range hits {
		if vendor := strings.TrimSpace(getStringAny(hit, "vendorName", "vendor_name")); vendor != "" {
			if facetCounts["vendorName"] == nil {
				facetCounts["vendorName"] = make(map[string]int)
			}
			facetCounts["vendorName"][vendor]++
		}

		if brand := strings.TrimSpace(getStringAny(hit, "brand", "brand_name")); brand != "" {
			if facetCounts["brand"] == nil {
				facetCounts["brand"] = make(map[string]int)
			}
			facetCounts["brand"][brand]++
		}

		if unit := strings.TrimSpace(getStringAny(hit, "dosageUnit", "dosage_unit")); unit != "" {
			if facetCounts["dosageUnit"] == nil {
				facetCounts["dosageUnit"] = make(map[string]int)
			}
			facetCounts["dosageUnit"][unit]++
		}

		if form := strings.TrimSpace(getString(hit, "form")); form != "" {
			if facetCounts["form"] == nil {
				facetCounts["form"] = make(map[string]int)
			}
			facetCounts["form"][form]++
		}

		if category := strings.TrimSpace(getString(hit, "category")); category != "" {
			if facetCounts["category"] == nil {
				facetCounts["category"] = make(map[string]int)
			}
			facetCounts["category"][category]++
		}

		if quantity := formatQuantityFacetValue(getFloatAny(hit, "quantityValue", "quantity")); quantity != "" {
			if facetCounts["quantity"] == nil {
				facetCounts["quantity"] = make(map[string]int)
			}
			facetCounts["quantity"][quantity]++
		}
	}

	result := make(map[string]*pb.FacetValues)
	for facetName, counts := range facetCounts {
		values := make(map[string]int32)
		for k, v := range counts {
			values[k] = int32(v)
		}
		result[facetName] = &pb.FacetValues{Values: values}
	}

	return result
}

func getSlice(m map[string]interface{}, key string) []interface{} {
	if v, ok := m[key].([]interface{}); ok {
		return v
	}
	if v, ok := m[key].([]map[string]interface{}); ok {
		result := make([]interface{}, len(v))
		for i, item := range v {
			result[i] = item
		}
		return result
	}
	return nil
}

func getMap(m map[string]interface{}, key string) map[string]interface{} {
	if v, ok := m[key].(map[string]interface{}); ok {
		return v
	}
	return map[string]interface{}{}
}

func (s *server) GetFacets(ctx context.Context, req *connect.Request[pb.FacetsRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	if s.db == nil {
		return nil, fmt.Errorf("database not connected")
	}

	facets := map[string]interface{}{}

	// Vendor name counts
	vendorRows, err := s.db.Query(`SELECT v.name, COUNT(*) FROM "Product" p JOIN "Vendor" v ON v.id = p."vendorId" GROUP BY v.name ORDER BY COUNT(*) DESC`)
	if err == nil {
		vendorCounts := map[string]interface{}{}
		for vendorRows.Next() {
			var name string
			var count int
			if err := vendorRows.Scan(&name, &count); err == nil {
				vendorCounts[name] = count
			}
		}
		vendorRows.Close()
		facets["vendorName"] = vendorCounts
	}

	// Brand counts
	brandRows, err := s.db.Query(`SELECT "extractedBrand", COUNT(*) FROM "Product" WHERE "extractedBrand" IS NOT NULL AND "extractedBrand" != '' GROUP BY "extractedBrand" ORDER BY COUNT(*) DESC LIMIT 200`)
	if err == nil {
		brandCounts := map[string]interface{}{}
		for brandRows.Next() {
			var brand string
			var count int
			if err := brandRows.Scan(&brand, &count); err == nil {
				brandCounts[brand] = count
			}
		}
		brandRows.Close()
		facets["brand"] = brandCounts
	}

	// Canonical category counts
	catRows, err := s.db.Query(`SELECT "canonicalCategory", COUNT(*) FROM "Product" WHERE "canonicalCategory" IS NOT NULL AND "canonicalCategory" != '' GROUP BY "canonicalCategory" ORDER BY COUNT(*) DESC`)
	if err == nil {
		catCounts := map[string]interface{}{}
		for catRows.Next() {
			var cat string
			var count int
			if err := catRows.Scan(&cat, &count); err == nil {
				catCounts[cat] = count
			}
		}
		catRows.Close()
		facets["category"] = catCounts
	}

	// Dosage unit counts
	unitRows, err := s.db.Query(`SELECT "dosageUnit", COUNT(*) FROM "Product" WHERE "dosageUnit" IS NOT NULL AND "dosageUnit" != '' GROUP BY "dosageUnit" ORDER BY COUNT(*) DESC`)
	if err == nil {
		unitCounts := map[string]interface{}{}
		for unitRows.Next() {
			var unit string
			var count int
			if err := unitRows.Scan(&unit, &count); err == nil {
				unitCounts[unit] = count
			}
		}
		unitRows.Close()
		facets["dosageUnit"] = unitCounts
	}

	data := map[string]interface{}{"facets": facets, "status": "success"}
	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
}

func (s *server) GetFeatured(ctx context.Context, req *connect.Request[pb.FeaturedRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	limit := int(req.Msg.GetLimit())
	if limit <= 0 {
		limit = 24
	}

	// Use cached featured products if available
	var groups []FeaturedGroup
	if len(s.featuredCache) > 0 {
		if limit >= len(s.featuredCache) {
			groups = s.featuredCache
		} else {
			groups = s.featuredCache[:limit]
		}
	} else {
		// Fallback: fetch from database if cache is empty
		var err error
		groups, err = s.GetFeaturedProducts(ctx, limit)
		if err != nil {
			log.Printf("Error getting featured products: %v", err)
			data := map[string]interface{}{
				"groups": []interface{}{},
				"total":  0,
				"offset": 0,
				"limit":  limit,
			}
			st, _ := toStructPB(data)
			return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
		}
	}

	// Build response struct
	type responseData struct {
		Groups []FeaturedGroup `json:"groups"`
		Total  int             `json:"total"`
		Offset int             `json:"offset"`
		Limit  int             `json:"limit"`
	}

	resp := responseData{
		Groups: groups,
		Total:  len(groups),
		Offset: 0,
		Limit:  limit,
	}

	// Convert via JSON to get proper map[string]interface{}
	jsonBytes, err := json.Marshal(resp)
	if err != nil {
		return nil, err
	}

	var data map[string]interface{}
	if err := json.Unmarshal(jsonBytes, &data); err != nil {
		return nil, err
	}

	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
}

func (s *server) PriceComparison(ctx context.Context, req *connect.Request[pb.PriceComparisonRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	hits, err := searchProductsDB(s.db, req.Msg.GetQ(), 5000, nil, nil)
	if err != nil {
		return nil, err
	}
	allGroups := convertHitsToGroups(hits, req.Msg.GetQ(), s.db)

	groups := allGroups
	if len(allGroups) > 10 {
		groups = allGroups[:10]
	}

	data := map[string]interface{}{
		"query":        req.Msg.GetQ(),
		"groups":       groups,
		"total_groups": len(allGroups),
		"message":      "Price comparison using PostgreSQL",
	}
	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
}

func (s *server) Contact(ctx context.Context, req *connect.Request[pb.ContactRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	contactEmail := os.Getenv("CONTACT_EMAIL")
	if contactEmail == "" {
		contactEmail = "apostekafm@gmail.com"
	}

	smtpHost := os.Getenv("SMTP_HOST")
	smtpPort := os.Getenv("SMTP_PORT")
	smtpUser := os.Getenv("SMTP_USER")
	smtpPass := os.Getenv("SMTP_PASS")

	if smtpHost == "" || smtpPort == "" || smtpUser == "" || smtpPass == "" {
		data := map[string]interface{}{
			"ok":     true,
			"mocked": true,
			"missing": map[string]bool{
				"SMTP_HOST": smtpHost == "",
				"SMTP_PORT": smtpPort == "",
				"SMTP_USER": smtpUser == "",
				"SMTP_PASS": smtpPass == "",
			},
		}
		st, err := toStructPB(data)
		if err != nil {
			return nil, err
		}
		return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
	}

	from := "Pharmagician <no-reply@pharmagician.rs>"
	to := []string{contactEmail}
	subject := fmt.Sprintf("Kontakt forma: %s", req.Msg.GetName())
	body := fmt.Sprintf("Ime: %s\nEmail: %s\n\nPoruka:\n%s", req.Msg.GetName(), req.Msg.GetEmail(), req.Msg.GetMessage())

	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nReply-To: %s\r\nSubject: %s\r\n\r\n%s",
		from, contactEmail, req.Msg.GetEmail(), subject, body)

	auth := smtp.PlainAuth("", smtpUser, smtpPass, smtpHost)
	addr := fmt.Sprintf("%s:%s", smtpHost, smtpPort)

	err := smtp.SendMail(addr, auth, smtpUser, to, []byte(msg))
	if err != nil {
		data := map[string]interface{}{"ok": false, "error": err.Error()}
		st, err := toStructPB(data)
		if err != nil {
			return nil, err
		}
		return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
	}

	data := map[string]interface{}{"ok": true}
	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
}

// ProcessProducts is deprecated - Meilisearch indexing is no longer used.
func (s *server) ProcessProducts(ctx context.Context, req *connect.Request[pb.ProcessRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	data := map[string]interface{}{"status": "deprecated", "message": "Meilisearch indexing removed. Search uses PostgreSQL directly."}
	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
}

// ReprocessAll is deprecated - Meilisearch indexing is no longer used.
func (s *server) ReprocessAll(ctx context.Context, req *connect.Request[pb.ReprocessAllRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	data := map[string]interface{}{"status": "deprecated", "message": "Meilisearch indexing removed. Search uses PostgreSQL directly."}
	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
}

// RebuildIndex is deprecated - Meilisearch indexing is no longer used.
func (s *server) RebuildIndex(ctx context.Context, req *connect.Request[pb.RebuildIndexRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	data := map[string]interface{}{"status": "deprecated", "message": "Meilisearch indexing removed. Search uses PostgreSQL directly."}
	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
}

// RebuildIndexWithStandardization is deprecated - Meilisearch indexing is no longer used.
func (s *server) RebuildIndexWithStandardization(ctx context.Context, req *connect.Request[pb.RebuildIndexRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	data := map[string]interface{}{"status": "deprecated", "message": "Meilisearch indexing removed. Search uses PostgreSQL directly."}
	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
}

func (s *server) ProcessingAnalysis(ctx context.Context, req *connect.Request[pb.ProcessingAnalysisRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	if s.db == nil {
		data := map[string]interface{}{"status": "error", "message": "Database not connected"}
		st, err := toStructPB(data)
		if err != nil {
			return nil, err
		}
		return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
	}

	// Basic stats query
	var totalProducts, processedProducts int
	err := s.db.QueryRow(`SELECT COUNT(*), COUNT(CASE WHEN "processedAt" IS NOT NULL THEN 1 END) FROM "Product"`).Scan(&totalProducts, &processedProducts)
	if err != nil {
		data := map[string]interface{}{"status": "error", "message": err.Error()}
		st, err := toStructPB(data)
		if err != nil {
			return nil, err
		}
		return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
	}

	data := map[string]interface{}{
		"status": "completed",
		"statistics": map[string]interface{}{
			"total_products":     totalProducts,
			"processed_products": processedProducts,
			"processing_rate":    float64(processedProducts) / float64(totalProducts) * 100,
		},
		"message": "Processing analysis complete",
	}
	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
}

func main() {
	// Load .env (SMTP_*, MAIL_FROM, APP_URL, ...) without overriding real env vars.
	loadDotEnv(".env")

	// Handle CLI commands or start ConnectRPC server
	if len(os.Args) >= 2 {
		switch os.Args[1] {
		case "test-search":
			runTestSearch()
			return
		case "pricewatch":
			runPriceWatchCLI()
			return
		case "help":
			fmt.Println("Usage: pharma-search [command]")
			fmt.Println("")
			fmt.Println("Commands:")
			fmt.Println("  (no args)      Start the ConnectRPC server")
			fmt.Println("  test-search    Test search with query: pharma-search test-search \"query\"")
			fmt.Println("  pricewatch     Run the price-watch job once (refresh prices + send alerts)")
			fmt.Println("  help           Show this help message")
			return
		}
	}
	runConnectServer()
}

func runPriceWatchCLI() {
	db, err := connectDB()
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()
	srv := &server{db: db}
	if err := srv.runPriceWatch(); err != nil {
		log.Fatalf("pricewatch failed: %v", err)
	}
}

func runTestSearch() {
	db, err := connectDB()
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	query := "vitamin d"
	if len(os.Args) > 2 {
		query = os.Args[2]
	}

	start := time.Now()
	hits, err := searchProductsDB(db, query, 1000, nil, nil)
	if err != nil {
		log.Fatalf("Search failed: %v", err)
	}
	elapsed := time.Since(start)

	fmt.Printf("PostgreSQL returned %d hits for query: %s (in %v)\n", len(hits), query, elapsed)
	if len(hits) > 0 {
		fmt.Println("\nFirst 5 products:")
		enriched := enrichProductsWithGroupKey(hits)
		for i := 0; i < 5 && i < len(enriched); i++ {
			title := getString(enriched[i], "title")
			fmt.Printf("  %d. %s\n     -> Group: %s [%s] (%s)\n", i+1, title,
				getString(enriched[i], "group_key"),
				getString(enriched[i], "group_method"),
				getString(enriched[i], "group_display"))
		}
	}

	groups := convertHitsToGroups(hits, query, db)

	fmt.Printf("\nSearch Results for \"%s\":\n\n", query)
	fmt.Printf("Total groups found: %d\n\n", len(groups))
	fmt.Println("Rank | Product Name                                      | Best Hit | Products")
	fmt.Println("-----|---------------------------------------------------|----------|----------")

	maxDisplay := 10
	if len(groups) < maxDisplay {
		maxDisplay = len(groups)
	}

	for i := 0; i < maxDisplay; i++ {
		g := groups[i]
		name := g["normalized_name"].(string)
		if len(name) > 49 {
			name = name[:46] + "..."
		}
		rank := g["relevance_rank"]
		products := g["product_count"]

		rankStr := "N/A"
		if rank != nil {
			rankStr = fmt.Sprintf("#%d", rank.(int)+1) // 1-indexed for display
		}

		fmt.Printf("%-4d | %-49s | %8s | %v\n", i+1, name, rankStr, products)
	}

	if len(groups) > maxDisplay {
		fmt.Printf("\n... and %d more groups\n", len(groups)-maxDisplay)
	}
	fmt.Println()
}

func (s *server) prefetchFeaturedProducts() {
	if s.db == nil {
		log.Println("Skipping featured products prefetch: database not connected")
		return
	}

	log.Println("Prefetching featured products...")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	groups, err := s.GetFeaturedProducts(ctx, 50) // Cache up to 50 groups
	if err != nil {
		log.Printf("Warning: Failed to prefetch featured products: %v", err)
		return
	}

	s.featuredCache = groups
	s.featuredCacheAt = time.Now()
	log.Printf("Cached %d featured product groups", len(groups))
}

func runConnectServer() {
	// Connect to database
	db, err := connectDB()
	if err != nil {
		log.Printf("Warning: Failed to connect to database: %v", err)
		db = nil // Set to nil so methods can handle gracefully
	} else {
		log.Println("Database connected successfully")
		defer db.Close()
	}

	// Create the Connect handler. The search cache is bounded by total member-products
	// held (default 50k ≈ ~75MB worst case) so a burst of distinct queries can't OOM the
	// box, with a 5-minute freshness TTL. Both tunable via env; SEARCH_CACHE_TTL=0 disables.
	cacheTTL := 5 * time.Minute
	if v := getEnvDuration("SEARCH_CACHE_TTL"); v != 0 || os.Getenv("SEARCH_CACHE_TTL") != "" {
		cacheTTL = v
	}
	srv := &server{
		db:          db,
		searchCache: newSearchResultCache(getEnvInt("SEARCH_CACHE_MAX_PRODUCTS", 50000), cacheTTL),
	}

	// Prefetch featured products on startup
	srv.prefetchFeaturedProducts()

	// Start cache cleanup goroutine
	go srv.cleanupSearchCache()

	// Start the background price-watch job (refresh watched prices + email alerts).
	if db != nil {
		go srv.startPriceWatchLoop()
	}

	path, handler := pbconnect.NewPharmaAPIHandler(srv)

	// Create HTTP mux
	mux := http.NewServeMux()
	mux.Handle(path, handler)

	// Account / auth JSON endpoints (separate from the ConnectRPC search API).
	srv.registerAuthRoutes(mux)
	srv.registerWatchRoutes(mux)
	srv.registerVendorRoutes(mux)

	// Add CORS middleware
	corsHandler := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "Connect-Protocol-Version"},
		ExposedHeaders:   []string{"Grpc-Status", "Grpc-Message"},
		AllowCredentials: true,
		MaxAge:           300,
	})

	// Wrap with CORS and h2c for HTTP/2 support
	h2cHandler := h2c.NewHandler(corsHandler.Handler(mux), &http2.Server{})

	// Start server
	addr := ":50051"
	log.Printf("ConnectRPC server listening on %s", addr)
	if err := http.ListenAndServe(addr, h2cHandler); err != nil {
		log.Fatalf("Failed to serve: %v", err)
	}
}
