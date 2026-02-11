package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/smtp"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"
	_ "github.com/lib/pq"
	"github.com/rs/cors"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	"google.golang.org/protobuf/types/known/structpb"

	"github.com/callmeahab/pharma-search/gen/pbconnect"
	pb "github.com/callmeahab/pharma-search/gen"
)

type server struct {
	db              *sql.DB
	featuredCache   []FeaturedGroup
	featuredCacheAt time.Time
	// Search results cache for scroll-based pagination
	searchCache     map[string]*cachedSearchResult
	searchCacheMu   sync.RWMutex
}

type cachedSearchResult struct {
	groups    []map[string]interface{}
	facets    map[string]*pb.FacetValues
	totalHits int
	cachedAt  time.Time
}

func connectDB() (*sql.DB, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:docker@localhost:5432/pharmagician?sslmode=disable"
	}
	return sql.Open("postgres", dbURL)
}

// searchProductsDB queries PostgreSQL using trigram similarity + ILIKE for product search.
// Returns all matching products (up to limit) with fields matching what enrichProductsWithGroupKey expects.
func searchProductsDB(db *sql.DB, query string, limit int) ([]map[string]interface{}, error) {
	if db == nil {
		return nil, fmt.Errorf("database not connected")
	}
	if limit <= 0 {
		limit = 5000
	}

	// Escape LIKE special characters in user input
	escapedQuery := strings.NewReplacer("%", "\\%", "_", "\\_").Replace(query)
	likePattern := "%" + escapedQuery + "%"

	rows, err := db.Query(`
		SELECT
			p.id,
			p.title,
			p.price,
			p."vendorId",
			v.name as vendor_name,
			p.link,
			COALESCE(p.thumbnail, '') as thumbnail,
			COALESCE(p."extractedBrand", '') as brand,
			COALESCE(p."normalizedName", '') as normalized_name,
			COALESCE(p."coreProductIdentity", '') as core_product_identity,
			p."dosageValue",
			COALESCE(p."dosageUnit", '') as dosage_unit,
			p."volumeValue",
			COALESCE(p."volumeUnit", '') as volume_unit,
			COALESCE(p.form, '') as form,
			p."quantityValue"
		FROM "Product" p
		JOIN "Vendor" v ON v.id = p."vendorId"
		WHERE p.title ILIKE $1
		   OR p."normalizedName" ILIKE $1
		   OR p.title % $2
		ORDER BY
			CASE WHEN p.title ILIKE $1 OR COALESCE(p."normalizedName", '') ILIKE $1 THEN 0 ELSE 1 END,
			GREATEST(
				similarity(p.title, $2),
				similarity(COALESCE(p."normalizedName", ''), $2)
			) DESC
		LIMIT $3
	`, likePattern, query, limit)
	if err != nil {
		return nil, fmt.Errorf("search query error: %w", err)
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var id, title, vendorId, vendorName, link, thumbnail string
		var brand, normalizedName, coreProductIdentity, dosageUnit, volumeUnit, form string
		var price, dosageValue, volumeValue sql.NullFloat64
		var quantityValue sql.NullInt64

		if err := rows.Scan(&id, &title, &price, &vendorId, &vendorName, &link, &thumbnail,
			&brand, &normalizedName, &coreProductIdentity,
			&dosageValue, &dosageUnit, &volumeValue, &volumeUnit, &form, &quantityValue); err != nil {
			return nil, fmt.Errorf("scan error: %w", err)
		}

		priceVal := 0.0
		if price.Valid {
			priceVal = price.Float64
		}

		result := map[string]interface{}{
			"id":              id,
			"title":           title,
			"price":           priceVal, // DB stores price in RSD directly
			"vendorId":        vendorId,
			"vendorName":      vendorName,
			"link":            link,
			"thumbnail":       thumbnail,
			"brand":           brand,
			"normalizedName":  normalizedName,
			"coreProductIdentity": coreProductIdentity,
			"dosageValue":     dosageValue.Float64,
			"dosageUnit":      dosageUnit,
			"volumeValue":     volumeValue.Float64,
			"volumeUnit":      volumeUnit,
			"form":            form,
			"quantityValue":   float64(quantityValue.Int64),
		}
		results = append(results, result)
	}

	if err := rows.Err(); err != nil {
		return nil, err
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

	escapedQuery := strings.NewReplacer("%", "\\%", "_", "\\_").Replace(query)
	likePattern := "%" + escapedQuery + "%"

	rows, err := db.Query(`
		SELECT * FROM (
			SELECT DISTINCT ON (lower(p.title))
				p.id, p.title, p.price, v.name as vendor_name,
				similarity(p.title, $2) as sim
			FROM "Product" p
			JOIN "Vendor" v ON v.id = p."vendorId"
			WHERE p.title ILIKE $1 OR p.title % $2
			ORDER BY lower(p.title), similarity(p.title, $2) DESC
		) sub
		ORDER BY sub.sim DESC
		LIMIT $3
	`, likePattern, query, limit)
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

func uniqueStrings(values []string) []string {
	set := map[string]struct{}{}
	for _, v := range values {
		set[v] = struct{}{}
	}
	out := make([]string, 0, len(set))
	for v := range set {
		out = append(out, v)
	}
	sort.Strings(out)
	return out
}

// Regex patterns for extracting dosage - pharma dosage vs volume
// Pharma dosage: mg, mcg, iu and variants (the actual drug dosage)
var pharmaDosagePattern = regexp.MustCompile(`(?i)\b(\d+(?:[.,]\d+)?)\s*(mg|mcg|μg|µg|iu|i\.u\.|i\.j\.|ij)\b`)

// Volume: ml, l (container/liquid volume)
var volumePattern = regexp.MustCompile(`(?i)\b(\d+(?:[.,]\d+)?)\s*(ml|l)\b`)

// Ambiguous: g can be dosage (small values like 0.5g) or weight/volume (large values like 200g)
var gramPattern = regexp.MustCompile(`(?i)\b(\d+(?:[.,]\d+)?)\s*(g|gr|gram|grama)\b`)

// normalizeUnit normalizes dosage unit strings to canonical forms
func normalizeUnit(unit string) string {
	switch unit {
	case "i.u.", "i.j.", "ij":
		return "iu"
	case "μg", "µg":
		return "mcg"
	case "gr", "gram", "grama":
		return "g"
	default:
		return unit
	}
}

// Regex pattern for extracting quantity (count of tablets/capsules)
// Matches: "30 tableta", "30 mikrotableta", "a30", "x30", "tableta a30"
var quantityPattern = regexp.MustCompile(`\b[ax]?(\d+)\s*(mikrotablet|mikrokapsul|tab|tabl|tableta|tablete|kaps|kapsula|kapsule|caps|capsule|softgel|gel|komada|kom)\w*\b`)
var quantitySuffixPattern = regexp.MustCompile(`\b[ax](\d+)\b`)

// extractGroupKey extracts a grouping key from a product title
// Format: "ingredient dosage quantity" e.g., "vitamin d3 2000 iu 30", "omega 3 1000 mg 60"
func extractGroupKey(title string) string {
	t := strings.ToLower(title)

	// Clean up common noise - including hyphens and dashes
	noise := []string{"®", "™", "©", ",", "(", ")", "[", "]", "/", "\\", "_", "-", "–", "—"}
	for _, n := range noise {
		t = strings.ReplaceAll(t, n, " ")
	}
	t = strings.Join(strings.Fields(t), " ")

	// Extract dosage: prefer pharma dosage (mg/mcg/iu) over volume (ml/l)
	dosage := ""
	dosageMatch := ""
	if match := pharmaDosagePattern.FindStringSubmatch(t); len(match) >= 3 {
		// Found a real pharma dosage (mg, mcg, iu)
		amount := match[1]
		unit := normalizeUnit(strings.ToLower(match[2]))
		dosageMatch = match[0]
		dosage = amount + " " + unit
	} else if match := gramPattern.FindStringSubmatch(t); len(match) >= 3 {
		// Gram is ambiguous: small values (<=5g) are likely dosage, larger are weight
		amount := match[1]
		val, _ := strconv.ParseFloat(strings.Replace(amount, ",", ".", 1), 64)
		if val <= 5.0 {
			dosageMatch = match[0]
			dosage = amount + " g"
		}
		// else: treat as weight, don't use as dosage
	}
	// Note: volume (ml/l) is intentionally NOT used as dosage

	// Extract quantity (e.g., "30 tableta", "a60", "60 caps")
	quantity := ""
	quantityMatch := ""
	if match := quantityPattern.FindStringSubmatch(t); len(match) >= 2 {
		quantity = match[1] // Just the number
		quantityMatch = match[0]
	} else if match := quantitySuffixPattern.FindStringSubmatch(t); len(match) >= 2 {
		// Fallback for "a30", "x60" suffix format
		quantity = match[1]
		quantityMatch = match[0]
	}

	// Remove dosage and quantity from title for cleaner ingredient extraction
	ingredientPart := t
	if dosageMatch != "" {
		ingredientPart = strings.Replace(ingredientPart, dosageMatch, " ", 1)
	}
	if quantityMatch != "" {
		ingredientPart = strings.Replace(ingredientPart, quantityMatch, " ", 1)
	}
	ingredientPart = strings.Join(strings.Fields(ingredientPart), " ")

	// Words to skip when extracting ingredient
	skipWords := map[string]bool{
		"a": true, "za": true, "i": true, "sa": true, "od": true, "u": true,
		"the": true, "of": true, "with": true, "and": true, "for": true,
		"kapsule": true, "kapsula": true, "tablete": true, "tableta": true,
		"mikrotablete": true, "mikrotableta": true, "mikrokapsule": true,
		"softgel": true, "soft": true, "gel": true, "caps": true, "tab": true, "tbl": true,
		"iu": true, "mg": true, "ml": true, "mcg": true, "g": true,
		"sprej": true, "oral": true, "kapi": true, "sirup": true,
	}

	// Brand names to skip (they come before ingredient)
	brandWords := map[string]bool{
		"esi": true, "now": true, "vitabiotics": true, "terranova": true,
		"bivits": true, "activa": true, "masterteh": true, "multi": true,
		"essence": true, "food": true, "ultra": true, "plus": true,
		"detrical": true, "videtril": true, "nutrition": true,
	}

	words := strings.Fields(ingredientPart)
	coreWords := make([]string, 0, 4)
	alphaNumPattern := regexp.MustCompile(`^\d+[a-z]+$|^[a-z]+\d+$`)

	for _, w := range words {
		// Skip filler and form words
		if skipWords[w] {
			continue
		}
		// Skip brand words but continue looking
		if brandWords[w] {
			continue
		}

		// Check if previous coreWord is "vitamin" or "omega"
		isAfterVitaminOrOmega := len(coreWords) > 0 &&
			(coreWords[len(coreWords)-1] == "vitamin" || coreWords[len(coreWords)-1] == "omega")

		// Skip pure numbers unless after vitamin/omega (to keep "omega 3", "vitamin b12")
		if _, err := strconv.Atoi(w); err == nil {
			if isAfterVitaminOrOmega {
				// Keep it - omega 3, omega 6
			} else {
				continue
			}
		}

		// Skip numbers with letters like "a30", "30tbl" unless it's like "d3", "b12"
		if alphaNumPattern.MatchString(w) {
			if isAfterVitaminOrOmega && len(w) <= 3 {
				// Keep it - vitamin d3, vitamin b12
			} else {
				continue
			}
		}

		// Skip single letters unless after vitamin/omega (e.g., vitamin d, vitamin b)
		if len(w) < 2 {
			if isAfterVitaminOrOmega {
				// Keep it - vitamin d, vitamin b
			} else {
				continue
			}
		}

		coreWords = append(coreWords, w)
		if len(coreWords) >= 3 {
			break
		}
	}

	ingredient := strings.Join(coreWords, " ")

	// Combine ingredient + dosage + quantity for group key
	parts := []string{}
	if ingredient != "" {
		parts = append(parts, ingredient)
	}
	if dosage != "" {
		parts = append(parts, dosage)
	}
	if quantity != "" {
		parts = append(parts, "x"+quantity)
	}

	if len(parts) > 0 {
		return strings.Join(parts, " ")
	}

	// Last fallback: first 30 chars of normalized title
	if len(t) > 30 {
		return t[:30]
	}
	return t
}

func computeGroupKey(normalizedName, title string) string {
	if normalizedName != "" {
		return extractGroupKey(normalizedName)
	}
	return extractGroupKey(title)
}

// buildGroupId constructs a group ID from component fields: "ingredient::dosage::unit"
func buildGroupId(coreIdentity string, dosageValue float64, dosageUnit string) string {
	if coreIdentity == "" {
		return ""
	}
	parts := []string{strings.TrimSpace(coreIdentity)}
	if dosageValue > 0 && dosageUnit != "" {
		if dosageValue == float64(int(dosageValue)) {
			parts = append(parts, fmt.Sprintf("%d", int(dosageValue)))
		} else {
			parts = append(parts, fmt.Sprintf("%g", dosageValue))
		}
		parts = append(parts, strings.ToLower(dosageUnit))
	}
	return strings.Join(parts, "::")
}

func enrichProductsWithGroupKey(hits []map[string]interface{}) []map[string]interface{} {
	products := make([]map[string]interface{}, 0, len(hits))

	for rank, h := range hits {
		title := getString(h, "title")
		normalizedName := getString(h, "normalizedName")

		// group_key = specific key for strict mode (includes quantity/form)
		// computed_group_id = broad key for normal mode (ingredient + dosage only)
		var groupKey string
		if normalizedName != "" {
			groupKey = extractGroupKey(normalizedName)
		} else {
			groupKey = extractGroupKey(title)
		}
		// Append quantity to make strict key more specific
		qtyVal := getFloat(h, "quantityValue")
		form := getString(h, "form")
		if qtyVal > 0 {
			groupKey += fmt.Sprintf(" x%d", int(qtyVal))
		}
		if form != "" {
			groupKey += " " + strings.ToLower(form)
		}

		// Get dosage info from DB (pre-computed from Product table)
		dosageValue := getFloat(h, "dosageValue")
		dosageUnit := getString(h, "dosageUnit")

		// Build computed_group_id from component fields (coreProductIdentity + dosage)
		coreIdentity := strings.ToLower(getString(h, "coreProductIdentity"))
		computedGroupId := buildGroupId(coreIdentity, dosageValue, dosageUnit)

		// DB stores price in RSD directly (not cents like Meilisearch did)
		price := getFloat(h, "price")
		pid := strings.ReplaceAll(getString(h, "id"), "product_", "")

		product := map[string]interface{}{
			"id":               pid,
			"title":            title,
			"price":            price,
			"vendor_id":        getString(h, "vendorId"),
			"vendor_name":      getString(h, "vendorName"),
			"link":             getString(h, "link"),
			"thumbnail":        getString(h, "thumbnail"),
			"brand_name":       getString(h, "brand"),
			"group_key":        groupKey,
			"normalized_name":  normalizedName,
			"computed_group_id": computedGroupId,
			"dosage_value":     dosageValue,
			"dosage_unit":      dosageUnit,
			"volume_value":     getFloat(h, "volumeValue"),
			"volume_unit":      getString(h, "volumeUnit"),
			"form":             getString(h, "form"),
			"quantity":         getFloat(h, "quantityValue"),
			"rank":             rank,
		}

		products = append(products, product)
	}

	return products
}

// groupQueryScore scores how well a group ID matches the search query.
// Returns 2 if the group ID contains the full query as a substring,
// 1 if all query words appear in the group ID, 0 otherwise.
func groupQueryScore(groupID, query string) int {
	gid := strings.ToLower(strings.ReplaceAll(groupID, "::", " "))
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return 0
	}
	if strings.Contains(gid, q) {
		return 2
	}
	words := strings.Fields(q)
	for _, w := range words {
		if !strings.Contains(gid, w) {
			return 0
		}
	}
	return 1
}

func convertHitsToGroups(hits []map[string]interface{}, query string, db *sql.DB) []map[string]interface{} {
	if len(hits) == 0 {
		return []map[string]interface{}{}
	}

	products := enrichProductsWithGroupKey(hits)

	type groupData struct {
		firstRank int
		products  []map[string]interface{}
	}
	groupMap := make(map[string]*groupData)
	groupOrder := make([]string, 0)

	for _, p := range products {
		// Group by computed_group_id (broad, ML-computed) for backend grouping
		// Frontend re-groups by group_key (strict) or computed_group_id (normal)
		gid := getString(p, "computed_group_id")
		if gid == "" {
			gid = getString(p, "group_key")
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
		prods := gd.products

		sort.Slice(prods, func(i, j int) bool {
			return getFloat(prods[i], "price") < getFloat(prods[j], "price")
		})

		prices := make([]float64, 0, len(prods))
		vendors := make([]string, 0, len(prods))
		for _, p := range prods {
			prices = append(prices, getFloat(p, "price"))
			vendors = append(vendors, getString(p, "vendor_id"))
		}

		minP, maxP := 0.0, 0.0
		if len(prices) > 0 {
			minP, maxP = prices[0], prices[len(prices)-1]
		}

		displayName := gid
		if len(prods) > 0 {
			displayName = getString(prods[0], "title")
		}

		group := map[string]interface{}{
			"id":              gid,
			"normalized_name": displayName,
			"products":        prods,
			"price_range":     map[string]interface{}{"min": minP, "max": maxP},
			"vendor_count":    len(uniqueStrings(vendors)),
			"product_count":   len(prods),
			"dosage_value":    getFloat(prods[0], "dosage_value"),
			"dosage_unit":     getString(prods[0], "dosage_unit"),
			"relevance_rank":  gd.firstRank,
		}

		groups = append(groups, group)
	}

	// Sort: multi-product groups first, then by query match quality, then by relevance rank
	sort.SliceStable(groups, func(i, j int) bool {
		ci := getFloat(groups[i], "product_count")
		cj := getFloat(groups[j], "product_count")
		// Multi-product groups before single-product groups
		if (ci > 1) != (cj > 1) {
			return ci > 1
		}
		// Groups whose ID matches the query sort first
		si := groupQueryScore(getString(groups[i], "id"), query)
		sj := groupQueryScore(getString(groups[j], "id"), query)
		if si != sj {
			return si > sj
		}
		// Within the same tier, sort by relevance rank
		return getFloat(groups[i], "relevance_rank") < getFloat(groups[j], "relevance_rank")
	})
	return groups
}

func toStructPB(v interface{}) (*structpb.Struct, error) {
	switch m := v.(type) {
	case map[string]interface{}:
		return structpb.NewStruct(m)
	default:
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
		limit = 1000
	}
	if limit > 5000 {
		limit = 5000
	}

	hits, err := searchProductsDB(s.db, req.Msg.GetQ(), limit)
	if err != nil {
		return nil, err
	}

	products := enrichProductsWithGroupKey(hits)
	facets := buildFacetsFromHits(hits)

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
		"total":            len(hits),
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

	hits, err := searchProductsDB(s.db, req.Msg.GetQ(), 5000)
	if err != nil {
		return nil, err
	}

	allGroups := convertHitsToGroups(hits, req.Msg.GetQ(), s.db)

	paginatedGroups := allGroups
	if len(allGroups) > groupLimit {
		paginatedGroups = allGroups[:groupLimit]
	}

	data := map[string]interface{}{
		"groups":           paginatedGroups,
		"total":            len(allGroups),
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

	// Check cache first
	cacheKey := strings.ToLower(query)
	cached := s.getSearchCache(cacheKey)

	if cached == nil {
		// Cache miss - fetch all products from PostgreSQL and group them
		hits, err := searchProductsDB(s.db, query, 5000)
		if err != nil {
			return err
		}

		allGroups := convertHitsToGroups(hits, query, s.db)
		facets := buildFacetsFromHits(hits)

		cached = &cachedSearchResult{
			groups:    allGroups,
			facets:    facets,
			totalHits: len(hits),
			cachedAt:  time.Now(),
		}
		s.setSearchCache(cacheKey, cached)
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

// Cache helper methods
func (s *server) getSearchCache(key string) *cachedSearchResult {
	s.searchCacheMu.RLock()
	defer s.searchCacheMu.RUnlock()
	cached, ok := s.searchCache[key]
	if !ok {
		return nil
	}
	// Cache expires after 5 minutes
	if time.Since(cached.cachedAt) > 5*time.Minute {
		return nil
	}
	return cached
}

func (s *server) setSearchCache(key string, result *cachedSearchResult) {
	s.searchCacheMu.Lock()
	defer s.searchCacheMu.Unlock()
	s.searchCache[key] = result
}

func (s *server) cleanupSearchCache() {
	ticker := time.NewTicker(1 * time.Minute)
	for range ticker.C {
		s.searchCacheMu.Lock()
		for key, cached := range s.searchCache {
			if time.Since(cached.cachedAt) > 5*time.Minute {
				delete(s.searchCache, key)
			}
		}
		s.searchCacheMu.Unlock()
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
				Form:        getString(pm, "form"),
				Quantity:    int32(getFloat(pm, "quantity")),
				Rank:        int32(getFloat(pm, "rank")),
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
		// Count vendor names
		if vendor := getString(hit, "vendorName"); vendor != "" {
			if facetCounts["vendorName"] == nil {
				facetCounts["vendorName"] = make(map[string]int)
			}
			facetCounts["vendorName"][vendor]++
		}

		// Count brands
		if brand := getString(hit, "brand"); brand != "" {
			if facetCounts["brand"] == nil {
				facetCounts["brand"] = make(map[string]int)
			}
			facetCounts["brand"][brand]++
		}

		// Count dosage units
		if unit := getString(hit, "dosageUnit"); unit != "" {
			if facetCounts["dosageUnit"] == nil {
				facetCounts["dosageUnit"] = make(map[string]int)
			}
			facetCounts["dosageUnit"][unit]++
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
	hits, err := searchProductsDB(s.db, req.Msg.GetQ(), 5000)
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
	// Handle CLI commands or start ConnectRPC server
	if len(os.Args) >= 2 {
		switch os.Args[1] {
		case "test-search":
			runTestSearch()
			return
		case "help":
			fmt.Println("Usage: pharma-search [command]")
			fmt.Println("")
			fmt.Println("Commands:")
			fmt.Println("  (no args)      Start the ConnectRPC server")
			fmt.Println("  test-search    Test search with query: pharma-search test-search \"query\"")
			fmt.Println("  help           Show this help message")
			return
		}
	}
	runConnectServer()
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
	hits, err := searchProductsDB(db, query, 1000)
	if err != nil {
		log.Fatalf("Search failed: %v", err)
	}
	elapsed := time.Since(start)

	fmt.Printf("PostgreSQL returned %d hits for query: %s (in %v)\n", len(hits), query, elapsed)
	if len(hits) > 0 {
		fmt.Println("\nFirst 5 products:")
		for i := 0; i < 5 && i < len(hits); i++ {
			title := getString(hits[i], "title")
			normalizedName := getString(hits[i], "normalizedName")
			groupKey := computeGroupKey(normalizedName, title)
			fmt.Printf("  %d. %s\n     -> Group: %s (normalized: %s)\n", i+1, title, groupKey, normalizedName)
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

	// Create the Connect handler
	srv := &server{
		db:          db,
		searchCache: make(map[string]*cachedSearchResult),
	}

	// Prefetch featured products on startup
	srv.prefetchFeaturedProducts()

	// Start cache cleanup goroutine
	go srv.cleanupSearchCache()

	path, handler := pbconnect.NewPharmaAPIHandler(srv)

	// Create HTTP mux
	mux := http.NewServeMux()
	mux.Handle(path, handler)

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
