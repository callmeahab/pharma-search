package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	pb "github.com/callmeahab/pharma-search/gen"
	"github.com/callmeahab/pharma-search/internal/matching"
	"github.com/lib/pq"
)

func (s *server) Health(ctx context.Context, req *connect.Request[pb.HealthRequest]) (*connect.Response[pb.HealthResponse], error) {
	if s.db == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("database unavailable"))
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	var ready bool
	if e := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM "CatalogPublication" WHERE id=1)`).Scan(&ready); e != nil || !ready {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("catalog unavailable"))
	}
	return connect.NewResponse(&pb.HealthResponse{Status: "healthy"}), nil
}
func (s *server) Autocomplete(ctx context.Context, req *connect.Request[pb.AutocompleteRequest]) (*connect.Response[pb.AutocompleteResponse], error) {
	response, e := s.catalogAutocomplete(ctx, req.Msg.GetQ(), int(req.Msg.GetLimit()))
	if e != nil {
		return nil, e
	}
	return connect.NewResponse(response), nil
}
func (s *server) SearchGroups(ctx context.Context, req *connect.Request[pb.SearchGroupsRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	return s.catalogGroupsJSON(ctx, catalogRequestFromProto(req.Msg))
}
func (s *server) SearchGroupsStream(ctx context.Context, req *connect.Request[pb.SearchGroupsRequest], stream *connect.ServerStream[pb.ProductGroupChunk]) error {
	page, e := s.catalogSearch(ctx, catalogRequestFromProto(req.Msg))
	if e != nil {
		return e
	}
	return stream.Send(page.proto())
}
func (s *server) GetFeatured(ctx context.Context, req *connect.Request[pb.FeaturedRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	return s.catalogGroupsJSON(ctx, catalogRequest{Limit: int(req.Msg.GetLimit()), Sort: "coverage"})
}
func (s *server) GetFacets(ctx context.Context, req *connect.Request[pb.FacetsRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	page, e := s.catalogSearch(ctx, catalogRequest{Limit: 1})
	if e != nil {
		return nil, e
	}
	data := page.asMap()
	delete(data, "groups")
	value, e := toStructPB(data)
	if e != nil {
		return nil, e
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: value}), nil
}
func (s *server) PriceComparison(ctx context.Context, req *connect.Request[pb.PriceComparisonRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	r := catalogRequest{Query: req.Msg.GetQ(), Limit: 10, AllOffers: true}
	if strings.HasPrefix(r.Query, "sku:v2:") || strings.HasPrefix(r.Query, "offer:v2:") {
		r.Filters.SKUID = r.Query
		r.Query = ""
		r.Limit = 1
	}
	return s.catalogGroupsJSON(ctx, r)
}

func (s *server) Search(ctx context.Context, req *connect.Request[pb.SearchRequest]) (*connect.Response[pb.GenericJsonResponse], error) {
	r := catalogRequest{Query: req.Msg.GetQ(), Limit: 1, Filters: catalogFilters{Brands: req.Msg.GetBrandNames(), Categories: req.Msg.GetCategories(), Forms: req.Msg.GetForms(), MinPrice: req.Msg.GetMinPrice(), MaxPrice: req.Msg.GetMaxPrice(), InStockOnly: req.Msg.GetInStockOnly()}}
	page, e := s.catalogSearch(ctx, r)
	if e != nil {
		return nil, e
	}
	limit := int(req.Msg.GetLimit())
	if limit == 0 {
		limit = 24
	}
	offset := int(req.Msg.GetOffset())
	if limit < 1 || limit > 200 || offset < 0 || offset > 1000000 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid product page"))
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	q := catalogWhere(matching.ParseCatalogQuery(r.Query), r.Filters, "", time.Now().Add(-currentOfferMaxAge()))
	lb := q.bind(limit)
	ob := q.bind(offset)
	rows, e := s.db.QueryContext(ctx, `SELECT p.id,p.title,p.price,p."vendorId",v.name,p.link,coalesce(p.thumbnail,''),s.brand,s.id,s.dosage_value,s.dosage_unit,s.form,s.quantity,p."priceScrapedAt",s.category,p.availability,s.volume_value,s.volume_unit`+q.from()+` ORDER BY p.price,p.id LIMIT `+lb+` OFFSET `+ob, q.args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	products := []catalogOffer{}
	for rows.Next() {
		p := catalogOffer{}
		var date time.Time
		if e = rows.Scan(&p.ID, &p.Title, &p.Price, &p.VendorID, &p.VendorName, &p.Link, &p.Thumbnail, &p.Brand, &p.GroupKey, &p.Dosage, &p.DosageUnit, &p.Form, &p.Quantity, &date, &p.Category, &p.Availability, &p.Volume, &p.VolumeUnit); e != nil {
			return nil, e
		}
		p.UpdatedAt = date.UTC().Format(time.RFC3339)
		products = append(products, p)
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	data := page.asMap()
	delete(data, "groups")
	data["products"] = products
	data["total"] = page.TotalProducts
	data["offset"] = offset
	data["limit"] = limit
	value, e := toStructPB(data)
	if e != nil {
		return nil, e
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: value}), nil
}

func catalogRequestFromProto(r *pb.SearchGroupsRequest) catalogRequest {
	quantities := make([]int, 0, len(r.GetQuantities()))
	for _, n := range r.GetQuantities() {
		quantities = append(quantities, int(n))
	}
	return catalogRequest{Query: r.GetQ(), Offset: int(r.GetOffset()), Limit: int(r.GetLimit()), Sort: r.GetSort(), Cursor: r.GetCursor(), AllOffers: r.GetIncludeAllOffers(), Filters: catalogFilters{Brands: r.GetBrandNames(), Categories: r.GetCategories(), Vendors: r.GetVendorNames(), Forms: r.GetForms(), Quantities: quantities, Dosages: r.GetDosages(), MinPrice: r.GetMinPrice(), MaxPrice: r.GetMaxPrice(), FamilyID: r.GetFamilyId(), SKUID: r.GetSkuId(), InStockOnly: r.GetInStockOnly()}}
}

func (s *server) catalogAutocomplete(ctx context.Context, query string, limit int) (*pb.AutocompleteResponse, error) {
	query = strings.TrimSpace(query)
	if len([]rune(query)) > 256 || limit < 0 || limit > 20 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid autocomplete request"))
	}
	if limit == 0 {
		limit = 8
	}
	plan := matching.ParseCatalogQuery(query)
	response := &pb.AutocompleteResponse{Query: query, Limit: int32(limit), CorrectedQuery: plan.Correction, Suggestions: []*pb.AutocompleteSuggestion{}}
	if len([]rune(query)) < 2 {
		return response, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if s.db == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("catalog unavailable"))
	}
	var generation string
	if err := s.db.QueryRowContext(ctx, `SELECT run_id FROM "CatalogPublication" WHERE id=1`).Scan(&generation); err != nil {
		return nil, err
	}
	key := "catalog-ac:" + generation + ":" + plan.Text + ":" + strconv.Itoa(limit)
	if values, ok := s.autocompleteCache.get(key); ok {
		response.Suggestions = values
		return response, nil
	}
	// Prefix lexemes are indexed separately, so two/three-character keystrokes do
	// not calculate trigram distance over tens of thousands of offers.
	words := strings.Fields(matching.NormalizeText(plan.Text))
	if len(words) == 0 {
		return response, nil
	}
	prefix := words[len(words)-1]
	prefixTokens := []string{}
	rows, err := s.db.QueryContext(ctx, `SELECT term FROM "CatalogLexeme" WHERE term LIKE $1 ORDER BY term LIMIT 200`, escapeLikePattern(prefix)+"%")
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var term string
		if err = rows.Scan(&term); err != nil {
			rows.Close()
			return nil, err
		}
		prefixTokens = append(prefixTokens, term)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if len(prefixTokens) == 0 {
		return response, nil
	}
	previous := matching.ParseCatalogQuery(strings.Join(words[:len(words)-1], " ")).Required
	if size := matching.DiaperSize(query); size != "" {
		previous = append(previous, "size:"+size)
	}
	if previous == nil {
		previous = []string{}
	}
	candidateSQL := `
	 SELECT s.id,s.display_name,s.normalized_title FROM "CatalogSku" s WHERE s.search_tokens && $1::text[] AND s.search_tokens @> $2::text[]
	 AND EXISTS(SELECT 1 FROM "CatalogOffer" p WHERE p.sku_id=s.id AND p.price>0 AND p.availability<>'unavailable' AND p."priceScrapedAt">=$3)
	 ORDER BY CASE WHEN s.normalized_title LIKE $4 THEN 0 ELSE 1 END,s.normalized_title,s.id LIMIT 120`
	if len(previous) == 0 {
		candidateSQL = `SELECT x.sku_id AS id,x.display_name,x.normalized_title FROM "CatalogSuggestion" x WHERE x.term=ANY($1::text[]) AND cardinality($2::text[])=0 GROUP BY x.sku_id,x.display_name,x.normalized_title
 ORDER BY CASE WHEN x.normalized_title LIKE $4 THEN 0 ELSE 1 END,max(x.vendor_count) DESC,x.normalized_title,x.sku_id LIMIT 120`
	}
	rows, err = s.db.QueryContext(ctx, `WITH candidates AS MATERIALIZED (`+candidateSQL+`
	), offers AS (SELECT c.id,c.display_name,c.normalized_title,min(p.price) AS price,count(DISTINCT p."vendorId") AS vendors
	 FROM candidates c JOIN "CatalogOffer" p ON p.sku_id=c.id WHERE p.price>0 AND p.availability<>'unavailable' AND p."priceScrapedAt">=$3 GROUP BY c.id,c.display_name,c.normalized_title)
	 SELECT o.id,o.display_name,o.price,(SELECT v.name FROM "CatalogOffer" p JOIN "Vendor" v ON v.id=p."vendorId" WHERE p.sku_id=o.id AND p.price=o.price AND p.availability<>'unavailable' AND p."priceScrapedAt">=$3 ORDER BY p.id LIMIT 1)
	 FROM offers o ORDER BY CASE WHEN o.normalized_title LIKE $4 THEN 0 ELSE 1 END,o.vendors DESC,o.normalized_title,o.id LIMIT $5`, pq.Array(prefixTokens), pq.Array(previous), time.Now().Add(-currentOfferMaxAge()), escapeLikePattern(plan.Text)+"%", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		v := &pb.AutocompleteSuggestion{}
		if err = rows.Scan(&v.Id, &v.Title, &v.Price, &v.VendorName); err != nil {
			return nil, err
		}
		response.Suggestions = append(response.Suggestions, v)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	s.autocompleteCache.put(key, response.Suggestions)
	return response, nil
}

func catalogRequestFromURL(r *http.Request) catalogRequest {
	q := r.URL.Query()
	limit, err := strconv.Atoi(q.Get("limit"))
	if err != nil && q.Has("limit") {
		limit = -1
	}
	offset, err := strconv.Atoi(q.Get("offset"))
	if err != nil && q.Has("offset") {
		offset = -1
	}
	minPrice, err := strconv.ParseFloat(q.Get("minPrice"), 64)
	if err != nil && q.Has("minPrice") {
		minPrice = math.NaN()
	}
	maxPrice, err := strconv.ParseFloat(q.Get("maxPrice"), 64)
	if err != nil && q.Has("maxPrice") {
		maxPrice = math.NaN()
	}
	values := func(key string) []string { return q[key] }
	quantities := []int{}
	for _, v := range values("quantity") {
		n, e := strconv.Atoi(v)
		if e != nil {
			n = -1
		}
		quantities = append(quantities, n)
	}
	return catalogRequest{Query: q.Get("q"), Offset: offset, Limit: limit, Sort: q.Get("sort"), Cursor: q.Get("cursor"), AllOffers: q.Get("allOffers") == "1", Filters: catalogFilters{Brands: values("brand"), Categories: values("category"), Vendors: values("vendor"), Forms: values("form"), Quantities: quantities, Dosages: values("dosage"), MinPrice: minPrice, MaxPrice: maxPrice, FamilyID: q.Get("family"), SKUID: q.Get("sku"), InStockOnly: q.Get("stock") == "available"}}
}

func catalogHTTPError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	if connect.CodeOf(err) == connect.CodeInvalidArgument {
		status = http.StatusBadRequest
	}
	if connect.CodeOf(err) == connect.CodeUnavailable {
		status = http.StatusServiceUnavailable
	}
	if errors.Is(err, context.DeadlineExceeded) {
		status = http.StatusGatewayTimeout
	}
	writeErr(w, status, err.Error())
}

func (s *server) registerCatalogRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/catalog/events", func(w http.ResponseWriter, r *http.Request) {
		var event struct {
			Kind        string   `json:"kind"`
			RequestID   string   `json:"request_id"`
			Rank        *int     `json:"rank"`
			ResultCount *int     `json:"result_count"`
			OfferCount  *int     `json:"offer_count"`
			Latency     *float64 `json:"latency_ms"`
			FilterCount *int     `json:"filter_count"`
			Corrected   *bool    `json:"corrected"`
		}
		r.Body = http.MaxBytesReader(w, r.Body, 2048)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if e := decoder.Decode(&event); e != nil || len(event.RequestID) > 64 {
			writeErr(w, 400, "invalid event")
			return
		}
		if event.Kind != "search_complete" && event.Kind != "product_click" && event.Kind != "store_click" {
			writeErr(w, 400, "invalid event kind")
			return
		}
		for _, n := range []*int{event.Rank, event.ResultCount, event.OfferCount, event.FilterCount} {
			if n != nil && (*n < 0 || *n > 1000000) {
				writeErr(w, 400, "invalid event value")
				return
			}
		}
		if s.db == nil {
			writeErr(w, 503, "measurement unavailable")
			return
		}
		if event.Latency != nil && (math.IsNaN(*event.Latency) || math.IsInf(*event.Latency, 0) || *event.Latency < 0 || *event.Latency > 120000) {
			writeErr(w, 400, "invalid latency")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if _, e := s.db.ExecContext(ctx, `INSERT INTO "CatalogEvent"(kind,request_id,rank,result_count,offer_count,latency_ms,filter_count,corrected) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, event.Kind, event.RequestID, event.Rank, event.ResultCount, event.OfferCount, event.Latency, event.FilterCount, event.Corrected); e != nil {
			writeErr(w, 503, "measurement unavailable")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/catalog/autocomplete", func(w http.ResponseWriter, r *http.Request) {
		limit, e := strconv.Atoi(r.URL.Query().Get("limit"))
		if e != nil && r.URL.Query().Get("limit") != "" {
			writeErr(w, 400, "invalid limit")
			return
		}
		response, e := s.catalogAutocomplete(r.Context(), r.URL.Query().Get("q"), limit)
		if e != nil {
			catalogHTTPError(w, e)
			return
		}
		writeJSON(w, 200, map[string]any{"suggestions": response.Suggestions, "query": response.Query, "limit": response.Limit, "corrected_query": response.CorrectedQuery})
	})
	mux.HandleFunc("GET /api/catalog/search", func(w http.ResponseWriter, r *http.Request) {
		page, e := s.catalogSearch(r.Context(), catalogRequestFromURL(r))
		if e != nil {
			catalogHTTPError(w, e)
			return
		}
		writeJSON(w, 200, page.asMap())
	})
	mux.HandleFunc("GET /api/catalog/status", s.handleCatalogStatus)
	mux.HandleFunc("GET /api/catalog/skus/{id}", func(w http.ResponseWriter, r *http.Request) {
		request := catalogRequestFromURL(r)
		request.Query = ""
		request.Filters.SKUID = r.PathValue("id")
		request.Offset = 0
		request.Cursor = ""
		request.Limit = 1
		request.AllOffers = true
		page, e := s.catalogSearch(r.Context(), request)
		if e != nil {
			catalogHTTPError(w, e)
			return
		}
		if len(page.Groups) > 0 {
			writeJSON(w, 200, map[string]any{"group": page.Groups[0], "catalog_version": page.CatalogVersion})
			return
		}
		// Archived products retain a real, stable URL; no stale offer is presented
		// as a current best price. This also keeps old saved links reviewable.
		var id, name, brand, category, family string
		var comparable bool
		e = s.db.QueryRowContext(r.Context(), `SELECT id,display_name,brand,category,family_id,comparable FROM "CatalogSku" WHERE id=$1`, request.Filters.SKUID).Scan(&id, &name, &brand, &category, &family, &comparable)
		if errors.Is(e, sql.ErrNoRows) {
			writeErr(w, 404, "Proizvod nije pronađen.")
			return
		}
		if e != nil {
			catalogHTTPError(w, e)
			return
		}
		writeJSON(w, 200, map[string]any{"group": catalogGroup{ID: id, Name: name, Brand: brand, Category: category, FamilyID: family, Comparable: comparable, Products: []catalogOffer{}, DetailsComplete: true}, "archived": true})
	})
	mux.HandleFunc("GET /api/catalog/sitemap", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
		defer cancel()
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		if page < 0 || page > 100 {
			writeErr(w, 400, "invalid page")
			return
		}
		rows, e := s.db.QueryContext(ctx, `SELECT s.id,max(p."priceScrapedAt") FROM "CatalogSku" s JOIN "CatalogOffer" p ON p.sku_id=s.id WHERE p.price>0 AND p.availability<>'unavailable' AND p."priceScrapedAt">=$1 GROUP BY s.id ORDER BY s.id LIMIT 40000 OFFSET $2`, time.Now().Add(-currentOfferMaxAge()), page*40000)
		if e != nil {
			catalogHTTPError(w, e)
			return
		}
		defer rows.Close()
		items := []map[string]string{}
		for rows.Next() {
			var id string
			var date time.Time
			if e = rows.Scan(&id, &date); e != nil {
				catalogHTTPError(w, e)
				return
			}
			items = append(items, map[string]string{"id": id, "updated_at": date.UTC().Format(time.RFC3339)})
		}
		if e = rows.Err(); e != nil {
			catalogHTTPError(w, e)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items})
	})
}

func catalogJSON(page *catalogPage) (*connect.Response[pb.GenericJsonResponse], error) {
	data, e := toStructPB(page.asMap())
	if e != nil {
		return nil, e
	}
	return connect.NewResponse(&pb.GenericJsonResponse{Data: data}), nil
}

// JSON facade used by native clients and server-rendered pages shares the same
// engine, identity and freshness rules as both Connect endpoints.
func (s *server) catalogGroupsJSON(ctx context.Context, request catalogRequest) (*connect.Response[pb.GenericJsonResponse], error) {
	page, e := s.catalogSearch(ctx, request)
	if e != nil {
		return nil, e
	}
	return catalogJSON(page)
}

func catalogMarshalGroup(group catalogGroup) map[string]any {
	data, _ := json.Marshal(group)
	out := map[string]any{}
	_ = json.Unmarshal(data, &out)
	return out
}
