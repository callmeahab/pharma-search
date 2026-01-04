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
	"time"

	"connectrpc.com/connect"
	_ "github.com/lib/pq"
	"github.com/rs/cors"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	"google.golang.org/protobuf/types/known/structpb"

	"github.com/callmeahab/pharma-search/gen/pbconnect"
	pb "github.com/callmeahab/pharma-search/gen"
	meilisearch "github.com/meilisearch/meilisearch-go"
)

type server struct {
	db              *sql.DB
	featuredCache   []FeaturedGroup
	featuredCacheAt time.Time
}

func connectDB() (*sql.DB, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:docker@localhost:5432/pharmagician?sslmode=disable"
	}
	return sql.Open("postgres", dbURL)
}

type meiliClient struct {
	baseURL   string
	indexName string
}

func newMeiliClient() *meiliClient {
	base := os.Getenv("MEILI_URL")
	if base == "" {
		base = "http://127.0.0.1:7700"
	}
	return &meiliClient{baseURL: base, indexName: "products"}
}

type meiliSearchResponse struct {
	Hits             []map[string]interface{} `json:"hits"`
	NbHits           int                      `json:"nbHits"`
	ProcessingTimeMs int                      `json:"processingTimeMs"`
	Facets           map[string]interface{}   `json:"facets"`
}

func (c *meiliClient) search(query string, filters map[string]interface{}, limit int, offset int) (meiliSearchResponse, error) {
	apiKey := os.Getenv("MEILI_API_KEY")
	client := meilisearch.New(c.baseURL, meilisearch.WithAPIKey(apiKey))
	index := client.Index(c.indexName)

	req := &meilisearch.SearchRequest{
		Limit:  int64(limit),
		Offset: int64(offset),
		Facets: []string{"vendorName", "brand", "normalizedName", "dosageUnit"},
	}
	if filters != nil {
		var parts []string
		if v, ok := filters["min_price"].(float64); ok && v != 0 {
			parts = append(parts, "price >= "+strconv.Itoa(int(v*100)))
		}
		if v, ok := filters["max_price"].(float64); ok && v != 0 {
			parts = append(parts, "price <= "+strconv.Itoa(int(v*100)))
		}
		buildOr := func(field string, values []string) string {
			if len(values) == 0 {
				return ""
			}
			row := make([]string, 0, len(values))
			for _, v := range values {
				row = append(row, field+" = \""+strings.ReplaceAll(v, "\"", "\\\"")+"\"")
			}
			return "(" + strings.Join(row, " OR ") + ")"
		}
		if brands, ok := filters["brand_names"].([]string); ok && len(brands) > 0 {
			if s := buildOr("brand", brands); s != "" {
				parts = append(parts, s)
			}
		}
		if cats, ok := filters["categories"].([]string); ok && len(cats) > 0 {
			if s := buildOr("normalizedName", cats); s != "" {
				parts = append(parts, s)
			}
		}
		if forms, ok := filters["forms"].([]string); ok && len(forms) > 0 {
			if s := buildOr("dosageUnit", forms); s != "" {
				parts = append(parts, s)
			}
		}
		if len(parts) > 0 {
			req.Filter = strings.Join(parts, " AND ")
		}
	}

	res, err := index.Search(query, req)
	if err != nil {
		return meiliSearchResponse{}, err
	}

	out := meiliSearchResponse{Facets: map[string]interface{}{}}
	b, _ := json.Marshal(res.Hits)
	_ = json.Unmarshal(b, &out.Hits)
	if res.EstimatedTotalHits > 0 {
		out.NbHits = int(res.EstimatedTotalHits)
	} else if len(out.Hits) > 0 {
		out.NbHits = len(out.Hits)
	}
	out.ProcessingTimeMs = int(res.ProcessingTimeMs)
	if res.FacetDistribution != nil {
		fb, _ := json.Marshal(res.FacetDistribution)
		_ = json.Unmarshal(fb, &out.Facets)
	}
	return out, nil
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

// Regex patterns for extracting dosage - must have number followed by unit
var dosagePattern = regexp.MustCompile(`\b(\d+(?:[.,]\d+)?)\s*(mg|mcg|μg|µg|iu|i\.u\.|i\.j\.|ij|ml|l|g)\b`)

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

	// Extract dosage first (e.g., "2000 iu", "1000 mg")
	dosage := ""
	dosageMatch := ""
	if match := dosagePattern.FindStringSubmatch(t); len(match) >= 3 {
		amount := match[1]
		unit := strings.ToLower(match[2])
		dosageMatch = match[0] // Full match to remove from title
		// Normalize units
		switch unit {
		case "i.u.", "i.j.", "ij":
			unit = "iu"
		case "μg", "µg":
			unit = "mcg"
		}
		dosage = amount + " " + unit
	}

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
	return extractGroupKey(title)
}

func enrichProductsWithGroupKey(hits []map[string]interface{}) []map[string]interface{} {
	products := make([]map[string]interface{}, 0, len(hits))

	for rank, h := range hits {
		title := getString(h, "title")
		normalizedName := getString(h, "normalizedName")
		groupKey := computeGroupKey(normalizedName, title)

		// Get dosage info from index (pre-computed from ProductStandardization)
		dosageValue := getFloat(h, "dosageValue")
		dosageUnit := getString(h, "dosageUnit")

		priceCents := getFloat(h, "price")
		price := priceCents / 100.0
		pid := strings.ReplaceAll(getString(h, "id"), "product_", "")

		product := map[string]interface{}{
			"id":           pid,
			"title":        title,
			"price":        price,
			"vendor_id":    getString(h, "vendorId"),
			"vendor_name":  getString(h, "vendorName"),
			"link":         getString(h, "link"),
			"thumbnail":    getString(h, "thumbnail"),
			"brand_name":   getString(h, "brand"),
			"group_key":    groupKey,
			"dosage_value": dosageValue,
			"dosage_unit":  dosageUnit,
			"rank":         rank, // Meilisearch relevance rank
		}

		products = append(products, product)
	}

	return products
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
		gid := getString(p, "group_key")
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

	_ = query
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
	client := newMeiliClient()
	out, err := client.search(req.Msg.GetQ(), nil, int(req.Msg.GetLimit()), 0)
	if err != nil {
		return nil, err
	}
	suggestions := make([]*pb.AutocompleteSuggestion, 0, len(out.Hits))
	for _, h := range out.Hits {
		title := getString(h, "title")
		price := getFloat(h, "price") / 100.0 // Convert from cents to RSD
		vendorName := getString(h, "vendorName")
		id := getString(h, "id")

		if title != "" {
			suggestions = append(suggestions, &pb.AutocompleteSuggestion{
				Id:         id,
				Title:      title,
				Price:      price,
				VendorName: vendorName,
			})
		}
	}
	return connect.NewResponse(&pb.AutocompleteResponse{Suggestions: suggestions, Query: req.Msg.GetQ(), Limit: req.Msg.GetLimit()}), nil
}

func (s *server) Search(ctx context.Context, req *connect.Request[pb.SearchRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	client := newMeiliClient()
	filters := map[string]interface{}{}
	if req.Msg.GetMinPrice() != 0 {
		filters["min_price"] = float64(req.Msg.GetMinPrice())
	}
	if req.Msg.GetMaxPrice() != 0 {
		filters["max_price"] = float64(req.Msg.GetMaxPrice())
	}
	if len(req.Msg.GetBrandNames()) > 0 {
		filters["brand_names"] = req.Msg.GetBrandNames()
	}
	if len(req.Msg.GetCategories()) > 0 {
		filters["categories"] = req.Msg.GetCategories()
	}
	if len(req.Msg.GetForms()) > 0 {
		filters["forms"] = req.Msg.GetForms()
	}
	if req.Msg.GetInStockOnly() {
		filters["in_stock_only"] = true
	}

	limit := int(req.Msg.GetLimit())
	if limit == 0 {
		limit = 1000
	}
	if limit > 1000 {
		limit = 1000
	}
	offset := int(req.Msg.GetOffset())

	res, err := client.search(req.Msg.GetQ(), filters, limit, offset)
	if err != nil {
		return nil, err
	}

	products := enrichProductsWithGroupKey(res.Hits)

	data := map[string]interface{}{
		"products":           products,
		"total":              res.NbHits,
		"offset":             offset,
		"limit":              limit,
		"search_type_used":   "meilisearch",
		"processing_time_ms": res.ProcessingTimeMs,
		"facets":             res.Facets,
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
	client := newMeiliClient()

	groupLimit := int(req.Msg.GetLimit())
	if groupLimit == 0 {
		groupLimit = 20
	}

	res, err := client.search(req.Msg.GetQ(), nil, 1000, 0)
	if err != nil {
		return nil, err
	}

	allGroups := convertHitsToGroups(res.Hits, req.Msg.GetQ(), s.db)

	paginatedGroups := allGroups
	if len(allGroups) > groupLimit {
		paginatedGroups = allGroups[:groupLimit]
	}

	data := map[string]interface{}{
		"groups":           paginatedGroups,
		"total":            len(allGroups),
		"offset":           0,
		"limit":            groupLimit,
		"search_type_used": "precomputed_groups",
	}
	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
}

func (s *server) GetFacets(ctx context.Context, req *connect.Request[pb.FacetsRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	client := newMeiliClient()
	res, err := client.search("", nil, 0, 0)
	if err != nil {
		return nil, err
	}
	data := map[string]interface{}{"facets": res.Facets, "status": "success"}
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
	client := newMeiliClient()
	res, err := client.search(req.Msg.GetQ(), nil, 500, 0)
	if err != nil {
		return nil, err
	}
	allGroups := convertHitsToGroups(res.Hits, req.Msg.GetQ(), s.db)

	groups := allGroups
	if len(allGroups) > 10 {
		groups = allGroups[:10]
	}

	data := map[string]interface{}{
		"query":              req.Msg.GetQ(),
		"groups":             groups,
		"total_groups":       len(allGroups),
		"message":            "Price comparison using Meilisearch",
		"processing_time_ms": res.ProcessingTimeMs,
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

func (s *server) ProcessProducts(ctx context.Context, req *connect.Request[pb.ProcessRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	if s.db == nil {
		return nil, fmt.Errorf("database not connected")
	}

	batchSize := int(req.Msg.GetBatchSize())
	if batchSize <= 0 {
		batchSize = 100
	}

	rows, err := s.db.Query(
		`SELECT p.id, p.title, p.price, p."vendorId", v.name as vendor_name, p.link, p.thumbnail, b.name as brand_name
		  FROM "Product" p
		  JOIN "Vendor" v ON v.id = p."vendorId"
		  LEFT JOIN "Brand" b ON b.id = p."brandId"
		  WHERE p."processedAt" IS NULL
		  ORDER BY p.id
		  LIMIT $1`, batchSize,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	docs := make([]map[string]interface{}, 0, batchSize)
	ids := make([]string, 0, batchSize)
	for rows.Next() {
		var id, title, vendorId, vendorName, link, thumbnail string
		var brandName sql.NullString
		var price sql.NullFloat64
		if err := rows.Scan(&id, &title, &price, &vendorId, &vendorName, &link, &thumbnail, &brandName); err != nil {
			return nil, err
		}
		cents := int(0)
		if price.Valid {
			cents = int(price.Float64 * 100.0)
		}
		doc := map[string]interface{}{
			"id":         "product_" + id,
			"title":      title,
			"price":      cents,
			"vendorId":   vendorId,
			"vendorName": vendorName,
			"link":       link,
			"thumbnail":  thumbnail,
			"brand": func() string {
				if brandName.Valid {
					return brandName.String
				}
				return ""
			}(),
		}
		docs = append(docs, doc)
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	client := meilisearch.New(os.Getenv("MEILI_URL"), meilisearch.WithAPIKey(os.Getenv("MEILI_API_KEY")))
	index := client.Index("products")
	_, _ = client.CreateIndex(&meilisearch.IndexConfig{Uid: "products", PrimaryKey: "id"})
	if len(docs) > 0 {
		if _, err := index.AddDocuments(docs, nil); err != nil {
			return nil, err
		}
	}

	if len(ids) > 0 {
		params := make([]interface{}, 0, len(ids)+1)
		placeholders := make([]string, 0, len(ids))
		for i, pid := range ids {
			params = append(params, pid)
			placeholders = append(placeholders, "$"+strconv.Itoa(i+1))
		}
		query := `UPDATE "Product" SET "processedAt" = $` + strconv.Itoa(len(ids)+1) + ` WHERE id IN (` + strings.Join(placeholders, ",") + `)`
		params = append(params, time.Now())
		if _, err := s.db.Exec(query, params...); err != nil {
			return nil, err
		}
	}

	data := map[string]interface{}{"status": "completed", "indexed_count": len(docs)}
	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
}

func (s *server) ReprocessAll(ctx context.Context, req *connect.Request[pb.ReprocessAllRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	if s.db == nil {
		return nil, fmt.Errorf("database not connected")
	}

	if _, err := s.db.Exec(`UPDATE "Product" SET "processedAt" = NULL`); err != nil {
		return nil, err
	}

	client := meilisearch.New(os.Getenv("MEILI_URL"), meilisearch.WithAPIKey(os.Getenv("MEILI_API_KEY")))
	_, _ = client.DeleteIndex("products")
	_, _ = client.CreateIndex(&meilisearch.IndexConfig{Uid: "products", PrimaryKey: "id"})

	batch := 1000
	offset := 0
	indexed := 0
	for {
		rows, err := s.db.Query(
			`SELECT p.id, p.title, p.price, p."vendorId", v.name as vendor_name, p.link, p.thumbnail, b.name as brand_name
			  FROM "Product" p
			  JOIN "Vendor" v ON v.id = p."vendorId"
			  LEFT JOIN "Brand" b ON b.id = p."brandId"
			  ORDER BY p.id
			  LIMIT $1 OFFSET $2`, batch, offset,
		)
		if err != nil {
			return nil, err
		}
		docs := make([]map[string]interface{}, 0, batch)
		for rows.Next() {
			var id, title, vendorId, vendorName, link, thumbnail string
			var brandName sql.NullString
			var price sql.NullFloat64
			if err := rows.Scan(&id, &title, &price, &vendorId, &vendorName, &link, &thumbnail, &brandName); err != nil {
				rows.Close()
				return nil, err
			}
			cents := int(0)
			if price.Valid {
				cents = int(price.Float64 * 100.0)
			}
			docs = append(docs, map[string]interface{}{
				"id":         "product_" + id,
				"title":      title,
				"price":      cents,
				"vendorId":   vendorId,
				"vendorName": vendorName,
				"link":       link,
				"thumbnail":  thumbnail,
				"brand": func() string {
					if brandName.Valid {
						return brandName.String
					}
					return ""
				}(),
			})
		}
		rows.Close()
		if len(docs) == 0 {
			break
		}
		index := client.Index("products")
		if _, err := index.AddDocuments(docs, nil); err != nil {
			return nil, err
		}
		indexed += len(docs)
		offset += batch
	}

	data := map[string]interface{}{"status": "completed", "indexed_count": indexed}
	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
}

func (s *server) RebuildIndex(ctx context.Context, req *connect.Request[pb.RebuildIndexRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	if s.db == nil {
		return nil, fmt.Errorf("database not connected")
	}

	meiliURL := os.Getenv("MEILI_URL")
	if meiliURL == "" {
		meiliURL = "http://localhost:7700"
	}
	client := meilisearch.New(meiliURL, meilisearch.WithAPIKey(os.Getenv("MEILI_API_KEY")))
	index := client.Index("products")
	_, _ = client.CreateIndex(&meilisearch.IndexConfig{Uid: "products", PrimaryKey: "id"})

	batch := 1000
	offset := 0
	indexed := 0
	for {
		rows, err := s.db.Query(
			`SELECT p.id, p.title, p.price, p."vendorId", v.name as vendor_name, p.link, COALESCE(p.thumbnail, '') as thumbnail
			  FROM "Product" p
			  JOIN "Vendor" v ON v.id = p."vendorId"
			  WHERE p."processedAt" IS NOT NULL
			  ORDER BY p.id
			  LIMIT $1 OFFSET $2`, batch, offset,
		)
		if err != nil {
			return nil, err
		}
		docs := make([]map[string]interface{}, 0, batch)
		for rows.Next() {
			var id, title, vendorId, vendorName, link, thumbnail string
			var price sql.NullFloat64
			if err := rows.Scan(&id, &title, &price, &vendorId, &vendorName, &link, &thumbnail); err != nil {
				rows.Close()
				return nil, err
			}
			cents := int(0)
			if price.Valid {
				cents = int(price.Float64 * 100.0)
			}
			docs = append(docs, map[string]interface{}{
				"id":         "product_" + id,
				"title":      title,
				"price":      cents,
				"vendorId":   vendorId,
				"vendorName": vendorName,
				"link":       link,
				"thumbnail":  thumbnail,
			})
		}
		rows.Close()
		if len(docs) == 0 {
			break
		}
		if _, err := index.AddDocuments(docs, nil); err != nil {
			return nil, err
		}
		indexed += len(docs)
		offset += batch
	}

	data := map[string]interface{}{"status": "completed", "indexed_count": indexed}
	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: st}), nil
}

func (s *server) RebuildIndexWithStandardization(ctx context.Context, req *connect.Request[pb.RebuildIndexRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	if s.db == nil {
		return nil, fmt.Errorf("database not connected")
	}

	log.Println("Starting Meilisearch rebuild with standardization...")

	meiliURL := os.Getenv("MEILI_URL")
	if meiliURL == "" {
		meiliURL = "http://localhost:7700"
	}
	client := meilisearch.New(meiliURL, meilisearch.WithAPIKey(os.Getenv("MEILI_API_KEY")))

	_, _ = client.DeleteIndex("products")
	_, err := client.CreateIndex(&meilisearch.IndexConfig{Uid: "products", PrimaryKey: "id"})
	if err != nil {
		log.Printf("Warning: Could not create index: %v", err)
	}

	index := client.Index("products")

	settings := meilisearch.Settings{
		SearchableAttributes: []string{"title", "standardizedTitle", "normalizedName", "brand", "vendorName"},
		FilterableAttributes: []string{"vendorId", "vendorName", "brand", "price", "normalizedName", "dosageUnit"},
		SortableAttributes:   []string{"price", "title"},
	}
	_, _ = index.UpdateSettings(&settings)

	batch := 1000
	offset := 0
	indexed := 0
	standardized := 0

	for {
		rows, err := s.db.Query(`
			SELECT
				p.id,
				p.title,
				p.price,
				p."vendorId",
				v.name as vendor_name,
				p.link,
				COALESCE(p.thumbnail, '') as thumbnail,
				ps.title as standardized_title,
				ps."normalizedName",
				ps."dosageValue",
				ps."dosageUnit",
				ps."quantityValue",
				ps."brandName" as std_brand
			FROM "Product" p
			JOIN "Vendor" v ON v.id = p."vendorId"
			LEFT JOIN "ProductStandardization" ps ON LOWER(ps."originalTitle") = LOWER(p.title)
			WHERE p."processedAt" IS NOT NULL
			ORDER BY p.id
			LIMIT $1 OFFSET $2`, batch, offset,
		)
		if err != nil {
			return nil, fmt.Errorf("query error: %w", err)
		}

		docs := make([]map[string]interface{}, 0, batch)
		for rows.Next() {
			var id, title, vendorId, vendorName, link, thumbnail string
			var stdTitle, normalizedName, dosageUnit, stdBrand sql.NullString
			var price, dosageValue sql.NullFloat64
			var quantityValue sql.NullInt64

			if err := rows.Scan(&id, &title, &price, &vendorId, &vendorName, &link, &thumbnail,
				&stdTitle, &normalizedName, &dosageValue, &dosageUnit, &quantityValue, &stdBrand); err != nil {
				rows.Close()
				return nil, fmt.Errorf("scan error: %w", err)
			}

			cents := 0
			if price.Valid {
				cents = int(price.Float64 * 100.0)
			}

			displayTitle := title
			if stdTitle.Valid && stdTitle.String != "" {
				displayTitle = stdTitle.String
				standardized++
			}

			brand := ""
			if stdBrand.Valid && stdBrand.String != "" {
				brand = stdBrand.String
			}

			normName := ""
			if normalizedName.Valid && normalizedName.String != "" {
				normName = normalizedName.String
			}

			doc := map[string]interface{}{
				"id":                "product_" + id,
				"title":             displayTitle,
				"originalTitle":     title,
				"standardizedTitle": stdTitle.String,
				"price":             cents,
				"vendorId":          vendorId,
				"vendorName":        vendorName,
				"link":              link,
				"thumbnail":         thumbnail,
				"brand":             brand,
				"normalizedName":    normName,
				"dosageValue":       dosageValue.Float64,
				"dosageUnit":        dosageUnit.String,
			}

			docs = append(docs, doc)
		}
		rows.Close()

		if len(docs) == 0 {
			break
		}

		if _, err := index.AddDocuments(docs, nil); err != nil {
			return nil, fmt.Errorf("index error: %w", err)
		}

		indexed += len(docs)
		offset += batch
		log.Printf("Indexed %d products (%d with standardization)...", indexed, standardized)
	}

	log.Printf("Rebuild complete: %d products indexed, %d with standardized names", indexed, standardized)

	data := map[string]interface{}{
		"status":            "completed",
		"indexed_count":     indexed,
		"standardized_count": standardized,
		"message":           fmt.Sprintf("Indexed %d products, %d with standardized names from XLSX", indexed, standardized),
	}
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
			runTestSearchFromMain()
			return
		case "rebuild-index":
			runRebuildIndexWithStandardization()
			return
		case "help":
			fmt.Println("Usage: pharma-search [command]")
			fmt.Println("")
			fmt.Println("Commands:")
			fmt.Println("  (no args)      Start the ConnectRPC server")
			fmt.Println("  test-search    Test search with query: pharma-search test-search \"query\"")
			fmt.Println("  rebuild-index  Rebuild Meilisearch index with standardized names from XLSX")
			fmt.Println("  help           Show this help message")
			return
		}
	}
	runConnectServer()
}

// runRebuildIndexWithStandardization runs the index rebuild from CLI
func runRebuildIndexWithStandardization() {
	db, err := connectDB()
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	s := &server{db: db}
	ctx := context.Background()

	resp, err := s.RebuildIndexWithStandardization(ctx, nil)
	if err != nil {
		log.Fatalf("Rebuild failed: %v", err)
	}

	// Print result
	if resp.Msg.Data != nil {
		jsonData := resp.Msg.Data.AsMap()
		fmt.Printf("\n✅ Index rebuild complete!\n")
		fmt.Printf("   Total indexed: %v\n", jsonData["indexed_count"])
		fmt.Printf("   With standardization: %v\n", jsonData["standardized_count"])
		fmt.Printf("   Status: %v\n", jsonData["status"])
	}
}

func runTestSearchFromMain() {
	db, err := connectDB()
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	query := "v-vein"
	if len(os.Args) > 2 {
		query = os.Args[2]
	}

	// Search with Meilisearch
	client := newMeiliClient()
	// Fetch 1000 products to get enough groups
	res, err := client.search(query, nil, 1000, 0)
	if err != nil {
		log.Fatalf("Search failed: %v", err)
	}

	fmt.Printf("Meilisearch returned %d hits for query: %s\n", len(res.Hits), query)
	if len(res.Hits) > 0 {
		fmt.Println("\nFirst 5 product titles from Meilisearch:")
		for i := 0; i < 5 && i < len(res.Hits); i++ {
			title := getString(res.Hits[i], "title")
			normalizedName := getString(res.Hits[i], "normalizedName")
			groupKey := computeGroupKey(normalizedName, title)
			fmt.Printf("  %d. %s\n     → Group: %s (normalized: %s)\n", i+1, title, groupKey, normalizedName)
		}
	}

	// Convert hits to groups (this is where relevance scoring happens)
	groups := convertHitsToGroups(res.Hits, query, db)

	// Display results
	fmt.Printf("\n🔍 Search Results for \"%s\":\n\n", query)
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
	srv := &server{db: db}

	// Prefetch featured products on startup
	srv.prefetchFeaturedProducts()

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
