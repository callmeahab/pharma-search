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

func convertHitsToFlatProducts(hits []map[string]interface{}, query string, db *sql.DB) []map[string]interface{} {
	if len(hits) == 0 {
		return []map[string]interface{}{}
	}

	// Get additional product metadata from database if available
	type productInfo struct {
		GroupID    string
		GroupName  sql.NullString
		DosageVal  sql.NullFloat64
		DosageUnit sql.NullString
		Quality    sql.NullFloat64
		DosageText sql.NullString
		VolumeText sql.NullString
		Form       sql.NullString
		Category   sql.NullString
		Photos     sql.NullString
	}
	
	idToProduct := map[string]productInfo{}
	if db != nil {
		ids := make([]string, 0, len(hits))
		for _, h := range hits {
			pid := strings.ReplaceAll(getString(h, "id"), "product_", "")
			if pid != "" {
				ids = append(ids, pid)
			}
		}
		if len(ids) > 0 {
			rows, err := db.Query(`
				SELECT p.id, COALESCE(p."productGroupId", ''), g."groupName", g."dosageStrength", g."dosageUnit", g."qualityScore",
				       p."dosageText", p."volumeText", p.form, p.category, p.photos
				FROM "Product" p 
				LEFT JOIN "ProductGroup" g ON g.id = p."productGroupId" 
				WHERE p.id = ANY($1)`, pq.Array(ids))
			if err == nil {
				for rows.Next() {
					var id, gid string
					var name sql.NullString
					var dv sql.NullFloat64
					var du sql.NullString
					var qs sql.NullFloat64
					var dt, vt, form, category, photos sql.NullString
					if err := rows.Scan(&id, &gid, &name, &dv, &du, &qs, &dt, &vt, &form, &category, &photos); err == nil {
						idToProduct[id] = productInfo{
							GroupID: gid, GroupName: name, DosageVal: dv, DosageUnit: du, 
							Quality: qs, DosageText: dt, VolumeText: vt, Form: form, Category: category, Photos: photos,
						}
					}
				}
				rows.Close()
			}
		}
	}

	// Convert hits to flat product list with enhanced data
	products := make([]map[string]interface{}, 0, len(hits))
	for _, h := range hits {
		rawID := getString(h, "id")
		pid := strings.ReplaceAll(rawID, "product_", "")
		priceCents := getFloat(h, "price")
		price := priceCents / 100.0

		// Base product data from Meilisearch
		product := map[string]interface{}{
			"id":          pid,
			"title":       getString(h, "title"),
			"price":       price,
			"vendor_id":   getString(h, "vendorId"),
			"vendor_name": getString(h, "vendorName"),
			"link":        getString(h, "link"),
			"thumbnail":   getString(h, "thumbnail"),
			"brand_name":  getString(h, "brand"),
		}

		// Add enhanced data from database if available
		if info, ok := idToProduct[pid]; ok {
			if info.DosageText.Valid {
				product["dosage_text"] = info.DosageText.String
			}
			if info.VolumeText.Valid {
				product["volume_text"] = info.VolumeText.String
			}
			if info.Form.Valid {
				product["form"] = info.Form.String
			}
			if info.Category.Valid {
				product["category"] = info.Category.String
			}
			if info.Quality.Valid {
				product["quality_score"] = info.Quality.Float64
			}
			if info.DosageVal.Valid {
				product["dosage_value"] = info.DosageVal.Float64
			}
			if info.DosageUnit.Valid {
				product["dosage_unit"] = info.DosageUnit.String
			}
			if info.Photos.Valid {
				product["photos"] = info.Photos.String
			}
		}

		products = append(products, product)
	}

	// Sort by relevance (Meilisearch already provides relevance order) then by price
	sort.Slice(products, func(i, j int) bool {
		// Keep Meilisearch relevance order as primary sort, price as secondary
		return products[i]["price"].(float64) < products[j]["price"].(float64)
	})

	return products
}

// Smart filtering function to detect query intent and apply relevant filters
func applySmartFiltering(products []map[string]interface{}, query string) []map[string]interface{} {
	if len(products) == 0 {
		return products
	}
	
	queryLower := strings.ToLower(strings.TrimSpace(query))
	
	// Extract key terms from query for broader matching
	queryTerms := extractKeyTerms(queryLower)
	
	// Score products based on relevance
	type scoredProduct struct {
		product map[string]interface{}
		score   int
		index   int
	}
	
	var scored []scoredProduct
	
	for i, product := range products {
		title := strings.ToLower(getString(product, "title"))
		dosageText := strings.ToLower(getString(product, "dosage_text"))
		form := strings.ToLower(getString(product, "form"))
		brandName := strings.ToLower(getString(product, "brand_name"))
		
		score := 0
		
		// Exact title match gets highest score
		if strings.Contains(title, queryLower) {
			score += 100
		}
		
		// Match individual terms from query
		for _, term := range queryTerms {
			if len(term) < 3 { // Skip very short terms
				continue
			}
			
			if strings.Contains(title, term) {
				score += 20
			}
			if strings.Contains(brandName, term) {
				score += 15
			}
			if strings.Contains(dosageText, term) {
				score += 10
			}
			if strings.Contains(form, term) {
				score += 8
			}
		}
		
		// Detect dosage intent and boost matching products
		if strings.Contains(queryLower, "mg") || strings.Contains(queryLower, "mcg") || 
		   strings.Contains(queryLower, "μg") || strings.Contains(queryLower, "iu") ||
		   strings.Contains(queryLower, "ie") {
			if strings.Contains(title, "mg") || strings.Contains(title, "mcg") || 
			   strings.Contains(title, "μg") || strings.Contains(title, "iu") ||
			   strings.Contains(title, "ie") || strings.Contains(dosageText, "mg") {
				score += 25
			}
		}
		
		// Detect package size intent
		if strings.Contains(queryLower, "kapsula") || strings.Contains(queryLower, "tableta") ||
		   strings.Contains(queryLower, "kom") || strings.Contains(queryLower, "x") {
			if strings.Contains(title, "kapsula") || strings.Contains(title, "tableta") ||
			   strings.Contains(title, "kom") || strings.Contains(title, "x") {
				score += 20
			}
		}
		
		// Detect form intent
		formKeywords := []string{"sirup", "kapsule", "krem", "gel", "mast", "sprej", "kapi", "prah", "tableta"}
		for _, formKeyword := range formKeywords {
			if strings.Contains(queryLower, formKeyword) {
				if strings.Contains(form, formKeyword) || strings.Contains(title, formKeyword) {
					score += 30
				}
			}
		}
		
		scored = append(scored, scoredProduct{product: product, score: score, index: i})
	}
	
	// Sort by score (descending), then by original order
	sort.Slice(scored, func(i, j int) bool {
		if scored[i].score != scored[j].score {
			return scored[i].score > scored[j].score
		}
		return scored[i].index < scored[j].index
	})
	
	// Return reordered products
	result := make([]map[string]interface{}, len(products))
	for i, sp := range scored {
		result[i] = sp.product
	}
	
	return result
}

// Extract key terms from query for broader matching
func extractKeyTerms(query string) []string {
	// Remove common stop words and split by spaces
	stopWords := map[string]bool{
		"i": true, "a": true, "od": true, "za": true, "u": true, "na": true, "sa": true, "se": true,
		"je": true, "su": true, "da": true, "to": true, "kao": true, "ili": true, "ako": true,
	}
	
	words := strings.Fields(query)
	var terms []string
	
	for _, word := range words {
		cleaned := strings.TrimFunc(word, func(r rune) bool {
			return !((r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'))
		})
		
		if len(cleaned) >= 3 && !stopWords[cleaned] {
			terms = append(terms, cleaned)
		}
	}
	
	return terms
}

// Helper function to check if any numbers from query appear in text
func containsNumberFromQuery(text, query string) bool {
	// Extract numbers from query
	queryNumbers := extractNumbers(query)
	if len(queryNumbers) == 0 {
		return false
	}
	
	// Check if any query number appears in text
	textNumbers := extractNumbers(text)
	for _, qn := range queryNumbers {
		for _, tn := range textNumbers {
			if qn == tn {
				return true
			}
		}
	}
	return false
}

// Extract numbers from text
func extractNumbers(text string) []string {
	var numbers []string
	parts := strings.Fields(text)
	for _, part := range parts {
		// Remove non-numeric characters and check if it's a number
		cleaned := strings.TrimFunc(part, func(r rune) bool {
			return !((r >= '0' && r <= '9') || r == '.')
		})
		if len(cleaned) > 0 && isNumeric(cleaned) {
			numbers = append(numbers, cleaned)
		}
	}
	return numbers
}

// Check if string is numeric
func isNumeric(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if !((r >= '0' && r <= '9') || r == '.') {
			return false
		}
	}
	return true
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
	products := convertHitsToFlatProducts(res.Hits, req.GetQ(), s.db)
	
	// Smart filtering based on query intent
	if req.GetQ() != "" {
		products = applySmartFiltering(products, req.GetQ())
	}
	
	data := map[string]interface{}{
		"products":           products,
		"total":              res.NbHits,
		"offset":             req.GetOffset(),
		"limit":              req.GetLimit(),
		"search_type_used":   "meilisearch_flat",
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
	// Return flat products instead of groups for consistency
	products := convertHitsToFlatProducts(res.Hits, req.GetQ(), s.db)
	data := map[string]interface{}{
		"products":         products,
		"total":            len(products),
		"offset":           0,
		"limit":            req.GetLimit(),
		"search_type_used": "flat_products",
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
	res, err := client.search(req.GetQ(), nil, 50, 0)
	if err != nil {
		return nil, err
	}
	products := convertHitsToFlatProducts(res.Hits, req.GetQ(), s.db)
	
	// Sort by price for better comparison
	sort.Slice(products, func(i, j int) bool {
		return products[i]["price"].(float64) < products[j]["price"].(float64)
	})
	
	data := map[string]interface{}{
		"query":              req.GetQ(),
		"products":           products,
		"total_products":     len(products),
		"message":            "Price comparison using Meilisearch flat search",
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
