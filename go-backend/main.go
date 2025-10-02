package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/smtp"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/lib/pq"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
	"google.golang.org/protobuf/types/known/structpb"

	pb "github.com/callmeahab/pharma-search/go-backend/proto"
	meilisearch "github.com/meilisearch/meilisearch-go"
)

type server struct {
	pb.UnimplementedPharmaAPIServer
	db *sql.DB
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
		Facets: []string{"brandFacet", "categoryFacet", "formFacet", "priceRange", "volumeRange"},
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
			if s := buildOr("brandFacet", brands); s != "" {
				parts = append(parts, s)
			}
		}
		if cats, ok := filters["categories"].([]string); ok && len(cats) > 0 {
			if s := buildOr("categoryFacet", cats); s != "" {
				parts = append(parts, s)
			}
		}
		if forms, ok := filters["forms"].([]string); ok && len(forms) > 0 {
			if s := buildOr("formFacet", forms); s != "" {
				parts = append(parts, s)
			}
		}
		if inStock, ok := filters["in_stock_only"].(bool); ok && inStock {
			parts = append(parts, "inStock = true")
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

func normalizeTitleForGrouping(title string) string {
	t := strings.ToLower(title)
	noise := []string{"®", "™", "©", ",", ".", "(", ")", "[", "]", "/", "\\"}
	for _, n := range noise {
		t = strings.ReplaceAll(t, n, " ")
	}
	t = strings.Join(strings.Fields(t), " ")
	return t
}

func convertHitsToGroups(hits []map[string]interface{}, query string, db *sql.DB) []map[string]interface{} {
	if len(hits) == 0 {
		return []map[string]interface{}{}
	}

	type groupInfo struct {
		GroupID    string
		GroupName  sql.NullString
		DosageVal  sql.NullFloat64
		DosageUnit sql.NullString
		Quality    sql.NullFloat64
	}
	idToGroup := map[string]groupInfo{}
	if db != nil {
		ids := make([]string, 0, len(hits))
		for _, h := range hits {
			pid := strings.ReplaceAll(getString(h, "id"), "product_", "")
			if pid != "" {
				ids = append(ids, pid)
			}
		}
		if len(ids) > 0 {
			rows, err := db.Query(`SELECT p.id, COALESCE(p."productGroupId", ''), g."groupName", g."dosageStrength", g."dosageUnit", g."qualityScore" FROM "Product" p LEFT JOIN "ProductGroup" g ON g.id = p."productGroupId" WHERE p.id = ANY($1)`, pq.Array(ids))
			if err == nil {
				for rows.Next() {
					var id, gid string
					var name sql.NullString
					var dv sql.NullFloat64
					var du sql.NullString
					var qs sql.NullFloat64
					if err := rows.Scan(&id, &gid, &name, &dv, &du, &qs); err == nil {
						idToGroup[id] = groupInfo{GroupID: gid, GroupName: name, DosageVal: dv, DosageUnit: du, Quality: qs}
					}
				}
				rows.Close()
			}
		}
	}

	// Group products using enhanced grouping
	engine := NewEnhancedGroupingEngine()
	byGroup := map[string][]map[string]interface{}{}

	for _, h := range hits {
		rawID := getString(h, "id")
		pid := strings.ReplaceAll(rawID, "product_", "")
		title := getString(h, "title")

		// Use enhanced grouping to generate group key
		signature := engine.ExtractSignature(title)
		gid := engine.GroupKey(signature)

		// Fallback: check if product has productGroupId in database
		if gi, ok := idToGroup[pid]; ok && gi.GroupID != "" {
			gid = gi.GroupID
		}

		// Last resort fallback
		if gid == "" {
			gid = normalizeTitleForGrouping(title)
		}

		byGroup[gid] = append(byGroup[gid], h)
	}

	groups := make([]map[string]interface{}, 0, len(byGroup))
	queryLower := strings.ToLower(query)
	queryWords := strings.Fields(queryLower)

	for gid, products := range byGroup {
		var groupRelevanceScore *float64 // Store the relevance score for this group

		// Calculate relevance score for this group based on query match
		if query != "" && len(queryWords) > 0 {
			groupScore := 0.0

			// Filter query words (>2 chars only)
			validWords := []string{}
			for _, word := range queryWords {
				if len(word) > 2 {
					validWords = append(validWords, word)
				}
			}

			// If no valid words after filtering, skip scoring
			if len(validWords) == 0 {
				continue
			}

			for _, p := range products {
				title := strings.ToLower(getString(p, "title"))
				productScore := 0.0

				// Check for exact phrase match (highest priority)
				if strings.Contains(title, queryLower) {
					productScore += 100.0
				}

				// Check for all valid query words present
				allWordsPresent := true
				for _, word := range validWords {
					if !strings.Contains(title, word) {
						allWordsPresent = false
						break
					}
				}
				if allWordsPresent {
					productScore += 50.0
				}

				// Count individual word matches (lower priority)
				for _, word := range validWords {
					if strings.Contains(title, word) {
						productScore += 10.0
					}
				}

				groupScore += productScore
			}

			// Average score per product in group
			avgScore := groupScore / float64(len(products))

			// Skip groups with low relevance
			// Groups need at least 30 points avg (e.g., 3 word matches or 1 partial match)
			if avgScore < 30.0 {
				continue
			}

			// Store score in a variable (not in products array since it will be sorted)
			groupRelevanceScore = &avgScore
		}

		sort.Slice(products, func(i, j int) bool { return getFloat(products[i], "price") < getFloat(products[j], "price") })
		prices := make([]float64, 0, len(products))
		vendors := make([]string, 0, len(products))
		formatted := make([]map[string]interface{}, 0, len(products))
		for _, p := range products {
			priceCents := getFloat(p, "price")
			price := priceCents / 100.0
			prices = append(prices, price)
			vendors = append(vendors, getString(p, "vendorId"))
			pid := strings.ReplaceAll(getString(p, "id"), "product_", "")
			formatted = append(formatted, map[string]interface{}{
				"id":          pid,
				"title":       getString(p, "title"),
				"price":       price,
				"vendor_id":   getString(p, "vendorId"),
				"vendor_name": getString(p, "vendorName"),
				"link":        getString(p, "link"),
				"thumbnail":   getString(p, "thumbnail"),
				"brand_name":  getString(p, "brand"),
			})
		}
		minP, maxP := 0.0, 0.0
		if len(prices) > 0 {
			minP, maxP = prices[0], prices[len(prices)-1]
		}

		// Optional group metadata from DB
		displayName := gid
		var dosageVal interface{}
		var dosageUnit interface{}
		var quality interface{}
		if len(products) > 0 {
			firstPid := strings.ReplaceAll(getString(products[0], "id"), "product_", "")
			if gi, ok := idToGroup[firstPid]; ok {
				if gi.GroupName.Valid {
					displayName = gi.GroupName.String
				}
				if gi.DosageVal.Valid {
					dosageVal = gi.DosageVal.Float64
				}
				if gi.DosageUnit.Valid {
					dosageUnit = gi.DosageUnit.String
				}
				if gi.Quality.Valid {
					quality = gi.Quality.Float64
				}
			}
		}

		groupData := map[string]interface{}{
			"id":              gid,
			"normalized_name": displayName,
			"products":        formatted,
			"price_range":     map[string]interface{}{"min": minP, "max": maxP},
			"vendor_count":    len(uniqueStrings(vendors)),
			"product_count":   len(products),
			"dosage_value":    dosageVal,
			"dosage_unit":     dosageUnit,
			"quality_score":   quality,
		}

		// Add relevance score if calculated
		if groupRelevanceScore != nil {
			groupData["relevance_score"] = *groupRelevanceScore
		}

		// When query is present, only include groups with relevance scores
		if query != "" && len(queryWords) > 0 {
			if _, hasScore := groupData["relevance_score"]; !hasScore {
				continue // Skip groups without relevance scores when searching
			}
		}

		groups = append(groups, groupData)
	}
	sort.Slice(groups, func(i, j int) bool {
		// Sort by relevance score first (if available)
		if query != "" {
			scoreI, hasI := groups[i]["relevance_score"].(float64)
			scoreJ, hasJ := groups[j]["relevance_score"].(float64)
			if hasI && hasJ && scoreI != scoreJ {
				return scoreI > scoreJ // Higher score first
			}
		}

		// Then by product count
		pi := groups[i]["product_count"].(int)
		pj := groups[j]["product_count"].(int)
		if pi != pj {
			return pi > pj
		}

		// Finally by price
		mi := groups[i]["price_range"].(map[string]interface{})["min"].(float64)
		mj := groups[j]["price_range"].(map[string]interface{})["min"].(float64)
		return mi < mj
	})
	return groups
}

func toStructPB(v interface{}) (*structpb.Struct, error) {
	// Convert map[string]interface{} to Struct. If not a map, marshal then unmarshal.
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

func (s *server) Health(ctx context.Context, req *pb.HealthRequest) (*pb.HealthResponse, error) {
	return &pb.HealthResponse{Status: "healthy"}, nil
}

func (s *server) Autocomplete(ctx context.Context, req *pb.AutocompleteRequest) (*pb.AutocompleteResponse, error) {
	client := newMeiliClient()
	out, err := client.search(req.GetQ(), nil, int(req.GetLimit()), 0)
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
	return &pb.AutocompleteResponse{Suggestions: suggestions, Query: req.GetQ(), Limit: req.GetLimit()}, nil
}

func (s *server) Search(ctx context.Context, req *pb.SearchRequest) (*pb.GenericJsonResponse, error) {
	client := newMeiliClient()
	filters := map[string]interface{}{}
	if req.GetMinPrice() != 0 {
		filters["min_price"] = float64(req.GetMinPrice())
	}
	if req.GetMaxPrice() != 0 {
		filters["max_price"] = float64(req.GetMaxPrice())
	}
	if len(req.GetBrandNames()) > 0 {
		filters["brand_names"] = req.GetBrandNames()
	}
	if len(req.GetCategories()) > 0 {
		filters["categories"] = req.GetCategories()
	}
	if len(req.GetForms()) > 0 {
		filters["forms"] = req.GetForms()
	}
	if req.GetInStockOnly() {
		filters["in_stock_only"] = true
	}
	res, err := client.search(req.GetQ(), filters, int(req.GetLimit()), int(req.GetOffset()))
	if err != nil {
		return nil, err
	}
	groups := convertHitsToGroups(res.Hits, req.GetQ(), s.db)
	data := map[string]interface{}{
		"groups":             groups,
		"total":              res.NbHits,
		"offset":             req.GetOffset(),
		"limit":              req.GetLimit(),
		"search_type_used":   "meilisearch",
		"processing_time_ms": res.ProcessingTimeMs,
		"facets":             res.Facets,
	}

	// Ensure data is JSON-serializable by marshaling and unmarshaling
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
	return &pb.GenericJsonResponse{Data: st}, nil
}

func (s *server) SearchGroups(ctx context.Context, req *pb.SearchGroupsRequest) (*pb.GenericJsonResponse, error) {
	client := newMeiliClient()
	res, err := client.search(req.GetQ(), nil, int(req.GetLimit()), 0)
	if err != nil {
		return nil, err
	}
	groups := convertHitsToGroups(res.Hits, req.GetQ(), s.db)
	data := map[string]interface{}{
		"groups":           groups,
		"total":            len(groups),
		"offset":           0,
		"limit":            req.GetLimit(),
		"search_type_used": "precomputed_groups",
	}
	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return &pb.GenericJsonResponse{Data: st}, nil
}

func (s *server) GetFacets(ctx context.Context, req *pb.FacetsRequest) (*pb.GenericJsonResponse, error) {
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
	return &pb.GenericJsonResponse{Data: st}, nil
}

func (s *server) PriceComparison(ctx context.Context, req *pb.PriceComparisonRequest) (*pb.GenericJsonResponse, error) {
	client := newMeiliClient()
	res, err := client.search(req.GetQ(), nil, 10, 0)
	if err != nil {
		return nil, err
	}
	groups := convertHitsToGroups(res.Hits, req.GetQ(), s.db)
	data := map[string]interface{}{
		"query":              req.GetQ(),
		"groups":             groups,
		"total_groups":       len(groups),
		"message":            "Price comparison using Meilisearch",
		"processing_time_ms": res.ProcessingTimeMs,
	}
	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return &pb.GenericJsonResponse{Data: st}, nil
}

func (s *server) Contact(ctx context.Context, req *pb.ContactRequest) (*pb.GenericJsonResponse, error) {
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
		return &pb.GenericJsonResponse{Data: st}, nil
	}

	// Compose email
	from := "Pharmagician <no-reply@pharmagician.rs>"
	to := []string{contactEmail}
	subject := fmt.Sprintf("Kontakt forma: %s", req.GetName())
	body := fmt.Sprintf("Ime: %s\nEmail: %s\n\nPoruka:\n%s", req.GetName(), req.GetEmail(), req.GetMessage())

	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nReply-To: %s\r\nSubject: %s\r\n\r\n%s",
		from, contactEmail, req.GetEmail(), subject, body)

	// Send email
	auth := smtp.PlainAuth("", smtpUser, smtpPass, smtpHost)
	addr := fmt.Sprintf("%s:%s", smtpHost, smtpPort)

	err := smtp.SendMail(addr, auth, smtpUser, to, []byte(msg))
	if err != nil {
		data := map[string]interface{}{"ok": false, "error": err.Error()}
		st, err := toStructPB(data)
		if err != nil {
			return nil, err
		}
		return &pb.GenericJsonResponse{Data: st}, nil
	}

	data := map[string]interface{}{"ok": true}
	st, err := toStructPB(data)
	if err != nil {
		return nil, err
	}
	return &pb.GenericJsonResponse{Data: st}, nil
}

func (s *server) ProcessProducts(ctx context.Context, req *pb.ProcessRequest) (*pb.GenericJsonResponse, error) {
	if s.db == nil {
		return nil, fmt.Errorf("database not connected")
	}

	batchSize := int(req.GetBatchSize())
	if batchSize <= 0 {
		batchSize = 100
	}

	// Select a batch of unprocessed products and lock them to avoid races
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

	// Build meilisearch documents
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

	// Index into Meilisearch
	client := meilisearch.New(os.Getenv("MEILI_URL"), meilisearch.WithAPIKey(os.Getenv("MEILI_API_KEY")))
	index := client.Index("products")
	_, _ = client.CreateIndex(&meilisearch.IndexConfig{Uid: "products", PrimaryKey: "id"})
	if len(docs) > 0 {
		pk := "id"
		if _, err := index.AddDocuments(docs, &pk); err != nil {
			return nil, err
		}
	}

	// Mark processed
	if len(ids) > 0 {
		// Build parameterized IN clause
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
	return &pb.GenericJsonResponse{Data: st}, nil
}

func (s *server) ReprocessAll(ctx context.Context, req *pb.ReprocessAllRequest) (*pb.GenericJsonResponse, error) {
	if s.db == nil {
		return nil, fmt.Errorf("database not connected")
	}

	// Reset processedAt
	if _, err := s.db.Exec(`UPDATE "Product" SET "processedAt" = NULL`); err != nil {
		return nil, err
	}

	// Recreate Meilisearch index
	client := meilisearch.New(os.Getenv("MEILI_URL"), meilisearch.WithAPIKey(os.Getenv("MEILI_API_KEY")))
	_, _ = client.DeleteIndex("products")
	_, _ = client.CreateIndex(&meilisearch.IndexConfig{Uid: "products", PrimaryKey: "id"})

	// Rebuild index in batches
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
		pk := "id"
		if _, err := index.AddDocuments(docs, &pk); err != nil {
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
	return &pb.GenericJsonResponse{Data: st}, nil
}

func (s *server) RebuildIndex(ctx context.Context, req *pb.RebuildIndexRequest) (*pb.GenericJsonResponse, error) {
	if s.db == nil {
		return nil, fmt.Errorf("database not connected")
	}

	client := meilisearch.New(os.Getenv("MEILI_URL"), meilisearch.WithAPIKey(os.Getenv("MEILI_API_KEY")))
	index := client.Index("products")
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
		pk := "id"
		if _, err := index.AddDocuments(docs, &pk); err != nil {
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
	return &pb.GenericJsonResponse{Data: st}, nil
}

func (s *server) ProcessingAnalysis(ctx context.Context, req *pb.ProcessingAnalysisRequest) (*pb.GenericJsonResponse, error) {
	if s.db == nil {
		data := map[string]interface{}{"status": "error", "message": "Database not connected"}
		st, err := toStructPB(data)
		if err != nil {
			return nil, err
		}
		return &pb.GenericJsonResponse{Data: st}, nil
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
		return &pb.GenericJsonResponse{Data: st}, nil
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
	return &pb.GenericJsonResponse{Data: st}, nil
}

func main() {
	// Handle CLI commands or start gRPC server
	if len(os.Args) < 2 {
		runOriginalGRPCServer()
		return
	}

	command := os.Args[1]
	switch command {
	case "stats":
		runStatsFromMain()
	case "analyze":
		runAnalyzeFromMain()
	case "process":
		runProcessProductsFromMain()
	case "index":
		runIndexToMeilisearchFromMain()
	case "test-search":
		runTestSearchFromMain()
	default:
		runOriginalGRPCServer()
	}
}

func runStatsFromMain() {
	db, err := connectDB()
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	processor := NewProductProcessor(db)
	ctx := context.Background()

	log.Println("📊 Processing Statistics")
	log.Println("=" + strings.Repeat("=", 49))
	
	stats, err := processor.AnalyzeProcessingEffectiveness(ctx)
	if err != nil {
		log.Fatalf("❌ Failed to get stats: %v", err)
	}

	log.Printf("Progress Overview:")
	if stats.TotalProducts > 0 {
		processed := float64(stats.ProcessedProducts) / float64(stats.TotalProducts) * 100
		log.Printf("  Processed: %.1f%% (%d/%d)", processed, stats.ProcessedProducts, stats.TotalProducts)
	}
}

func runAnalyzeFromMain() {
	db, err := connectDB()
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	processor := NewProductProcessor(db)
	ctx := context.Background()

	log.Println("📊 Analyzing Grouping Effectiveness")
	log.Println("=" + strings.Repeat("=", 49))
	
	_, err = processor.AnalyzeGroupingEffectiveness(ctx)
	if err != nil {
		log.Fatalf("❌ Analysis failed: %v", err)
	}
}

func runProcessProductsFromMain() {
	db, err := connectDB()
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	processor := NewProductProcessor(db)
	ctx := context.Background()

	log.Println("🔄 Processing Products with Enhanced Grouping")
	log.Println("=" + strings.Repeat("=", 49))

	err = processor.ProcessProducts(ctx, 1000)
	if err != nil {
		log.Fatalf("❌ Processing failed: %v", err)
	}

	log.Println("✅ Processing completed successfully!")
}

func runIndexToMeilisearchFromMain() {
	db, err := connectDB()
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	processor := NewProductProcessor(db)
	ctx := context.Background()

	meiliURL := os.Getenv("MEILI_URL")
	if meiliURL == "" {
		meiliURL = "http://127.0.0.1:7700"
	}

	log.Println("📊 Indexing Products to Meilisearch")
	log.Println("=" + strings.Repeat("=", 49))
	log.Printf("Meilisearch URL: %s", meiliURL)

	err = processor.IndexToMeilisearch(ctx, meiliURL, 1000)
	if err != nil {
		log.Fatalf("❌ Indexing failed: %v", err)
	}

	log.Println("✅ Indexing completed successfully!")
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
	// Fetch more hits to ensure we get enough products for grouping
	res, err := client.search(query, nil, 200, 0)
	if err != nil {
		log.Fatalf("Search failed: %v", err)
	}

	fmt.Printf("Meilisearch returned %d hits for query: %s\n", len(res.Hits), query)
	if len(res.Hits) > 0 {
		fmt.Println("\nFirst 5 product titles from Meilisearch:")
		engine := NewEnhancedGroupingEngine()
		for i := 0; i < 5 && i < len(res.Hits); i++ {
			title := getString(res.Hits[i], "title")
			sig := engine.ExtractSignature(title)
			gid := engine.GroupKey(sig)
			fmt.Printf("  %d. %s\n     → Group: %s (ingredient: %s)\n", i+1, title, gid, sig.CoreIngredient)
		}
	}

	// Convert hits to groups (this is where relevance scoring happens)
	groups := convertHitsToGroups(res.Hits, query, db)

	// Display results
	fmt.Printf("\n🔍 Search Results for \"%s\":\n\n", query)
	fmt.Printf("Total groups found: %d\n\n", len(groups))
	fmt.Println("Rank | Product Name                                      | Relevance | Products")
	fmt.Println("-----|---------------------------------------------------|-----------|----------")

	maxDisplay := 10
	if len(groups) < maxDisplay {
		maxDisplay = len(groups)
	}

	for i := 0; i < maxDisplay; i++ {
		g := groups[i]
		name := g["normalized_name"]
		score := g["relevance_score"]
		products := g["product_count"]

		scoreStr := "N/A"
		if score != nil {
			scoreStr = fmt.Sprintf("%.1f", score)
		}

		fmt.Printf("%-4d | %-49s | %9s | %v\n", i+1, name, scoreStr, products)
	}

	if len(groups) > maxDisplay {
		fmt.Printf("\n... and %d more groups\n", len(groups)-maxDisplay)
	}
	fmt.Println()
}

func runOriginalGRPCServer() {
	// Connect to database
	db, err := connectDB()
	if err != nil {
		log.Printf("Warning: Failed to connect to database: %v", err)
		db = nil // Set to nil so methods can handle gracefully
	} else {
		log.Println("Database connected successfully")
		defer db.Close()
	}

	lis, err := net.Listen("tcp", ":50051")
	if err != nil {
		log.Fatalf("Failed to listen: %v", err)
	}
	s := grpc.NewServer()
	reflection.Register(s)
	pb.RegisterPharmaAPIServer(s, &server{db: db})
	log.Printf("gRPC server listening at %v", lis.Addr())
	if err := s.Serve(lis); err != nil {
		log.Fatalf("Failed to serve: %v", err)
	}
}
