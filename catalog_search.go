package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"
	pb "github.com/callmeahab/pharma-search/gen"
	"github.com/callmeahab/pharma-search/internal/matching"
	"github.com/lib/pq"
)

type catalogFilters struct {
	Brands      []string `json:"brand_names,omitempty"`
	Categories  []string `json:"categories,omitempty"`
	Vendors     []string `json:"vendor_names,omitempty"`
	Forms       []string `json:"forms,omitempty"`
	Quantities  []int    `json:"quantities,omitempty"`
	Dosages     []string `json:"dosages,omitempty"`
	MinPrice    float64  `json:"min_price,omitempty"`
	MaxPrice    float64  `json:"max_price,omitempty"`
	InStockOnly bool     `json:"in_stock_only,omitempty"`
	FamilyID    string   `json:"family_id,omitempty"`
	SKUID       string   `json:"sku_id,omitempty"`
}
type catalogRequest struct {
	Query     string         `json:"query"`
	Filters   catalogFilters `json:"filters"`
	Offset    int            `json:"offset"`
	Limit     int            `json:"limit"`
	Sort      string         `json:"sort"`
	Cursor    string         `json:"cursor,omitempty"`
	AllOffers bool           `json:"all_offers"`
}
type catalogOffer struct {
	ID           string  `json:"id"`
	Title        string  `json:"title"`
	Price        float64 `json:"price"`
	VendorID     string  `json:"vendor_id"`
	VendorName   string  `json:"vendor_name"`
	Link         string  `json:"link"`
	Thumbnail    string  `json:"thumbnail"`
	Brand        string  `json:"brand_name"`
	GroupKey     string  `json:"group_key"`
	Dosage       float64 `json:"dosage_value"`
	DosageUnit   string  `json:"dosage_unit"`
	Form         string  `json:"form"`
	Quantity     int     `json:"quantity"`
	Rank         int     `json:"rank"`
	UpdatedAt    string  `json:"price_updated_at"`
	Category     string  `json:"category"`
	Availability string  `json:"availability"`
	Volume       float64 `json:"volume_value"`
	VolumeUnit   string  `json:"volume_unit"`
	UnitPrice    float64 `json:"unit_price"`
}
type catalogPriceRange struct {
	Min float64 `json:"min"`
	Max float64 `json:"max"`
	Avg float64 `json:"avg"`
}
type catalogGroup struct {
	ID              string            `json:"id"`
	Name            string            `json:"normalized_name"`
	FamilyID        string            `json:"family_id"`
	Comparable      bool              `json:"comparable"`
	MatchMethod     string            `json:"match_method"`
	Brand           string            `json:"brand"`
	Category        string            `json:"category"`
	GTIN            string            `json:"gtin,omitempty"`
	Products        []catalogOffer    `json:"products"`
	Offers          []catalogOffer    `json:"offers,omitempty"`
	PriceRange      catalogPriceRange `json:"price_range"`
	VendorCount     int               `json:"vendor_count"`
	ProductCount    int               `json:"product_count"`
	Dosage          float64           `json:"dosage_value"`
	DosageUnit      string            `json:"dosage_unit"`
	UnitPriceMin    float64           `json:"unit_price_min"`
	UnitLabel       string            `json:"unit_label"`
	UnitQuantity    float64           `json:"-"`
	DetailsComplete bool              `json:"details_complete"`
}
type catalogPage struct {
	Groups         []catalogGroup             `json:"groups"`
	Total          int                        `json:"total"`
	TotalGroups    int                        `json:"total_groups"`
	TotalProducts  int                        `json:"total_products"`
	Offset         int                        `json:"offset"`
	Limit          int                        `json:"limit"`
	Facets         map[string]*pb.FacetValues `json:"-"`
	FacetGrain     string                     `json:"facet_grain"`
	Query          string                     `json:"query"`
	CorrectedQuery string                     `json:"corrected_query,omitempty"`
	NextCursor     string                     `json:"next_cursor,omitempty"`
	CatalogVersion string                     `json:"catalog_version"`
	PriceMin       float64                    `json:"price_min"`
	PriceMax       float64                    `json:"price_max"`
	RequestID      string                     `json:"request_id"`
	ProcessingMS   float64                    `json:"processing_time_ms"`
	SearchType     string                     `json:"search_type_used"`
}
type catalogFlight struct {
	done chan struct{}
	page *catalogPage
	err  error
}
type catalogFlightGroup struct {
	mu    sync.Mutex
	calls map[string]*catalogFlight
}

func (g *catalogFlightGroup) do(ctx context.Context, key string, fn func() (*catalogPage, error)) (*catalogPage, error) {
	g.mu.Lock()
	if g.calls == nil {
		g.calls = map[string]*catalogFlight{}
	}
	if c := g.calls[key]; c != nil {
		g.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-c.done:
			return c.page, c.err
		}
	}
	c := &catalogFlight{done: make(chan struct{})}
	g.calls[key] = c
	g.mu.Unlock()
	defer func() { g.mu.Lock(); delete(g.calls, key); close(c.done); g.mu.Unlock() }()
	c.page, c.err = fn()
	return c.page, c.err
}

func catalogHash(v any) string {
	data, _ := json.Marshal(v)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:16])
}

func escapeLikePattern(value string) string {
	return strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(value)
}
func cleanFilter(values []string, canonical func(string) string) []string {
	set := map[string]bool{}
	for _, v := range values {
		v = strings.TrimSpace(v)
		if canonical != nil {
			v = canonical(v)
		}
		if v != "" {
			set[v] = true
		}
	}
	out := make([]string, 0, len(set))
	for v := range set {
		out = append(out, v)
	}
	sort.Strings(out)
	return out
}
func normalizeCatalogRequest(r catalogRequest) (catalogRequest, error) {
	r.Query = strings.TrimSpace(r.Query)
	if len([]rune(r.Query)) > 256 {
		return r, connect.NewError(connect.CodeInvalidArgument, errors.New("query exceeds 256 characters"))
	}
	if r.Offset < 0 || r.Offset > 1000000 || r.Limit < 0 || r.Limit > 60 {
		return r, connect.NewError(connect.CodeInvalidArgument, errors.New("offset must be non-negative and limit at most 60"))
	}
	if r.Limit == 0 {
		r.Limit = 24
	}
	if math.IsNaN(r.Filters.MinPrice) || math.IsNaN(r.Filters.MaxPrice) || math.IsInf(r.Filters.MinPrice, 0) || math.IsInf(r.Filters.MaxPrice, 0) || r.Filters.MinPrice < 0 || r.Filters.MaxPrice < 0 || (r.Filters.MaxPrice > 0 && r.Filters.MinPrice > r.Filters.MaxPrice) {
		return r, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid price range"))
	}
	r.Filters.Brands = cleanFilter(r.Filters.Brands, matching.CanonicalBrand)
	r.Filters.Categories = cleanFilter(r.Filters.Categories, nil)
	r.Filters.Vendors = cleanFilter(r.Filters.Vendors, nil)
	r.Filters.Forms = cleanFilter(r.Filters.Forms, matching.NormalizeSKUForm)
	r.Filters.Dosages = cleanFilter(r.Filters.Dosages, strings.ToLower)
	for _, list := range [][]string{r.Filters.Brands, r.Filters.Categories, r.Filters.Vendors, r.Filters.Forms, r.Filters.Dosages} {
		if len(list) > 30 {
			return r, connect.NewError(connect.CodeInvalidArgument, errors.New("too many filter values"))
		}
		for _, v := range list {
			if len(v) > 128 {
				return r, connect.NewError(connect.CodeInvalidArgument, errors.New("filter value too long"))
			}
		}
	}
	if len(r.Filters.Quantities) > 30 {
		return r, connect.NewError(connect.CodeInvalidArgument, errors.New("too many quantities"))
	}
	for _, q := range r.Filters.Quantities {
		if q <= 0 {
			return r, connect.NewError(connect.CodeInvalidArgument, errors.New("quantity must be positive"))
		}
	}
	sort.Ints(r.Filters.Quantities)
	if r.Sort == "" {
		r.Sort = "relevance"
	}
	switch r.Sort {
	case "relevance", "price_asc", "price_desc", "coverage", "newest":
	default:
		return r, connect.NewError(connect.CodeInvalidArgument, errors.New("unknown sort"))
	}
	if len(r.Cursor) > 1024 || len(r.Filters.FamilyID) > 100 || len(r.Filters.SKUID) > 100 {
		return r, connect.NewError(connect.CodeInvalidArgument, errors.New("identifier too long"))
	}
	return r, nil
}

type catalogSQL struct {
	args    []any
	clauses []string
}

func (q *catalogSQL) bind(v any) string {
	q.args = append(q.args, v)
	return fmt.Sprintf("$%d", len(q.args))
}
func catalogWhere(plan matching.QueryPlan, f catalogFilters, except string, cutoff time.Time) catalogSQL {
	q := catalogSQL{}
	q.clauses = []string{"p.price>0", "p.availability<>'unavailable'", "p.\"priceScrapedAt\">=" + q.bind(cutoff), "s.identity_version=" + q.bind(matching.CatalogIdentityVersion)}
	if len(plan.Required) > 0 {
		q.clauses = append(q.clauses, "s.search_tokens @> "+q.bind(pq.Array(plan.Required))+"::text[]")
	} else if plan.Original != "" {
		q.clauses = append(q.clauses, "false")
	}
	for _, field := range []struct {
		name, column string
		values       []string
	}{{"brand", "s.brand", f.Brands}, {"category", "s.category", f.Categories}, {"vendorName", "v.name", f.Vendors}, {"form", "s.form", f.Forms}} {
		if len(field.values) > 0 && except != field.name {
			q.clauses = append(q.clauses, field.column+"=ANY("+q.bind(pq.Array(field.values))+"::text[]) ")
		}
	}
	if len(f.Quantities) > 0 && except != "quantity" {
		q.clauses = append(q.clauses, "s.quantity=ANY("+q.bind(pq.Array(f.Quantities))+"::int[])")
	}
	if len(f.Dosages) > 0 && except != "dosage" && except != "dosageUnit" {
		b := q.bind(pq.Array(f.Dosages))
		q.clauses = append(q.clauses, "(s.dosage_unit=ANY("+b+"::text[]) OR (s.dosage_value::text||' '||s.dosage_unit)=ANY("+b+"::text[]))")
	}
	if except != "price" {
		if f.MinPrice > 0 {
			q.clauses = append(q.clauses, "p.price>="+q.bind(f.MinPrice))
		}
		if f.MaxPrice > 0 {
			q.clauses = append(q.clauses, "p.price<="+q.bind(f.MaxPrice))
		}
	}
	if f.InStockOnly {
		q.clauses = append(q.clauses, "p.availability='available'")
	}
	if f.FamilyID != "" {
		q.clauses = append(q.clauses, "s.family_id="+q.bind(f.FamilyID))
	}
	if f.SKUID != "" {
		q.clauses = append(q.clauses, "s.id="+q.bind(f.SKUID))
	}
	return q
}
func (q catalogSQL) from() string {
	return ` FROM "CatalogOffer" p JOIN "CatalogSku" s ON s.id=p.sku_id JOIN "Vendor" v ON v.id=p."vendorId" WHERE ` + strings.Join(q.clauses, " AND ")
}

type catalogCursor struct {
	Generation string `json:"g"`
	Signature  string `json:"s"`
	Offset     int    `json:"o"`
}

func requestSignature(r catalogRequest) string {
	r.Query = matching.ParseCatalogQuery(r.Query).Text
	r.Offset = 0
	r.Limit = 0
	r.Cursor = ""
	return catalogHash(r)
}
func decodeCatalogCursor(value, generation, signature string) (int, error) {
	data, e := base64.RawURLEncoding.DecodeString(value)
	var c catalogCursor
	if e != nil || json.Unmarshal(data, &c) != nil || c.Generation != generation || c.Signature != signature || c.Offset < 0 || c.Offset > 1000000 {
		return 0, connect.NewError(connect.CodeInvalidArgument, errors.New("results changed; restart pagination"))
	}
	return c.Offset, nil
}

func (s *server) catalogSearch(ctx context.Context, request catalogRequest) (*catalogPage, error) {
	started := time.Now()
	r, err := normalizeCatalogRequest(request)
	if err != nil {
		return nil, err
	}
	if s.db == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("catalog unavailable"))
	}
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	var generation string
	if err = s.db.QueryRowContext(ctx, `SELECT run_id FROM "CatalogPublication" WHERE id=1`).Scan(&generation); err != nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("catalog is being prepared"))
	}
	signature := requestSignature(r)
	if r.Cursor != "" {
		r.Offset, err = decodeCatalogCursor(r.Cursor, generation, signature)
		if err != nil {
			return nil, err
		}
	}
	plan := matching.ParseCatalogQuery(r.Query)
	cacheRequest := r
	cacheRequest.Query = plan.Text
	cacheRequest.Cursor = ""
	key := "catalog:" + generation + ":" + catalogHash(cacheRequest)
	if cached := s.searchCache.get(key); cached != nil && cached.catalog != nil {
		return catalogResponse(cached.catalog, r, plan, started), nil
	}
	page, err := s.catalogFlights.do(ctx, key, func() (*catalogPage, error) {
		if cached := s.searchCache.get(key); cached != nil && cached.catalog != nil {
			return cached.catalog, nil
		}
		page, e := s.buildCatalogPage(ctx, r, plan, generation)
		if e != nil {
			return nil, e
		}
		if page.Offset+len(page.Groups) < page.TotalGroups {
			data, _ := json.Marshal(catalogCursor{generation, signature, page.Offset + len(page.Groups)})
			page.NextCursor = base64.RawURLEncoding.EncodeToString(data)
		}
		memory := 0
		for _, g := range page.Groups {
			memory += len(g.Products) + len(g.Offers)
		}
		s.searchCache.put(key, &cachedSearchResult{catalog: page, products: max(1, memory), cachedAt: time.Now()})
		return page, nil
	})
	if err != nil {
		return nil, err
	}
	return catalogResponse(page, r, plan, started), nil
}

func catalogResponse(page *catalogPage, r catalogRequest, plan matching.QueryPlan, started time.Time) *catalogPage {
	copy := *page
	copy.Query = r.Query
	copy.CorrectedQuery = plan.Correction
	copy.RequestID = randomToken()[:16]
	copy.ProcessingMS = float64(time.Since(started).Microseconds()) / 1000
	return &copy
}

func (s *server) buildCatalogPage(ctx context.Context, r catalogRequest, plan matching.QueryPlan, generation string) (*catalogPage, error) {
	start := time.Now()
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var actual string
	if err = tx.QueryRowContext(ctx, `SELECT run_id FROM "CatalogPublication" WHERE id=1`).Scan(&actual); err != nil {
		return nil, err
	}
	if actual != generation {
		return nil, connect.NewError(connect.CodeAborted, errors.New("catalog changed; retry search"))
	}
	page := &catalogPage{Groups: []catalogGroup{}, Offset: r.Offset, Limit: r.Limit, Query: r.Query, CorrectedQuery: plan.Correction, CatalogVersion: generation, FacetGrain: "sku", RequestID: randomToken()[:16], SearchType: "postgresql-sku"}
	cutoff := time.Now().Add(-currentOfferMaxAge())
	where := catalogWhere(plan, r.Filters, "", cutoff)
	err = tx.QueryRowContext(ctx, `SELECT count(DISTINCT s.id),count(*)`+where.from(), where.args...).Scan(&page.TotalGroups, &page.TotalProducts)
	if err != nil {
		return nil, err
	}
	page.Total = page.TotalGroups
	bounds := catalogWhere(plan, r.Filters, "price", cutoff)
	if err = tx.QueryRowContext(ctx, `SELECT coalesce(min(p.price),0),coalesce(max(p.price),0)`+bounds.from(), bounds.args...).Scan(&page.PriceMin, &page.PriceMax); err != nil {
		return nil, err
	}
	q := where
	order := "st.vendors DESC,st.min_price,s.id"
	if plan.Text != "" && r.Sort == "relevance" {
		queryBind := q.bind(plan.Text)
		order = `CASE WHEN s.normalized_title=` + queryBind + ` THEN 2 WHEN s.normalized_title LIKE ` + queryBind + `||'%' THEN 1 ELSE 0 END DESC, GREATEST(similarity(s.normalized_title,` + queryBind + `),word_similarity(` + queryBind + `,s.normalized_title)) DESC, st.vendors DESC, st.min_price, s.id`
	}
	if plan.Text == "" || r.Sort == "coverage" {
		order = "st.vendors DESC,st.min_price,s.id"
	}
	if r.Sort == "price_asc" {
		order = "st.min_price,s.id"
	}
	if r.Sort == "price_desc" {
		order = "st.min_price DESC,s.id"
	}
	if r.Sort == "newest" {
		order = "st.newest DESC,s.id"
	}
	limitBind := q.bind(r.Limit)
	offsetBind := q.bind(r.Offset)
	query := `WITH eligible AS MATERIALIZED (SELECT s.id,p.price,p."vendorId",p."priceScrapedAt"` + where.from() + `), st AS (SELECT id,count(DISTINCT "vendorId") AS vendors,min(price) AS min_price,max("priceScrapedAt") AS newest FROM eligible GROUP BY id)
	 SELECT s.id,s.display_name,s.family_id,s.brand,s.category,s.comparable,s.match_method,s.dosage_value,s.dosage_unit,s.unit_quantity,s.unit_label,s.gtin
	 FROM st JOIN "CatalogSku" s ON s.id=st.id ORDER BY ` + order + ` LIMIT ` + limitBind + ` OFFSET ` + offsetBind
	rows, err := tx.QueryContext(ctx, query, q.args...)
	if err != nil {
		return nil, err
	}
	ids := []string{}
	for rows.Next() {
		g := catalogGroup{}
		if err = rows.Scan(&g.ID, &g.Name, &g.FamilyID, &g.Brand, &g.Category, &g.Comparable, &g.MatchMethod, &g.Dosage, &g.DosageUnit, &g.UnitQuantity, &g.UnitLabel, &g.GTIN); err != nil {
			rows.Close()
			return nil, err
		}
		g.Products = []catalogOffer{}
		page.Groups = append(page.Groups, g)
		ids = append(ids, g.ID)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	if len(ids) > 0 {
		if err = loadCatalogOffers(ctx, tx, page.Groups, plan, r.Filters, cutoff, r.AllOffers); err != nil {
			return nil, err
		}
	}
	// Facets are counted at SKU grain, over the complete query result, excluding
	// only their own selected values so multi-select options remain usable.
	facetKey := "catalog-facets:" + generation + ":" + signatureForFacets(r)
	if c := s.searchCache.get(facetKey); c != nil {
		page.Facets = c.facets
	} else {
		page.Facets = map[string]*pb.FacetValues{}
		for _, facet := range []struct{ name, value string }{{"brand", "s.brand"}, {"category", "s.category"}, {"vendorName", "v.name"}, {"form", "s.form"}, {"quantity", "NULLIF(s.quantity,0)::text"}, {"dosage", "CASE WHEN s.dosage_value>0 THEN s.dosage_value::text||' '||s.dosage_unit ELSE '' END"}, {"dosageUnit", "s.dosage_unit"}} {
			f := catalogWhere(plan, r.Filters, facet.name, cutoff)
			rs, e := tx.QueryContext(ctx, `SELECT `+facet.value+` AS value,count(DISTINCT s.id)`+f.from()+` GROUP BY 1 HAVING `+facet.value+` IS NOT NULL AND `+facet.value+`<>'' ORDER BY 2 DESC,1 LIMIT 300`, f.args...)
			if e != nil {
				return nil, e
			}
			values := map[string]int32{}
			for rs.Next() {
				var value string
				var count int32
				if e = rs.Scan(&value, &count); e != nil {
					rs.Close()
					return nil, e
				}
				values[value] = count
			}
			e = rs.Err()
			rs.Close()
			if e != nil {
				return nil, e
			}
			page.Facets[facet.name] = &pb.FacetValues{Values: values}
		}
		s.searchCache.put(facetKey, &cachedSearchResult{facets: page.Facets, products: 1, cachedAt: time.Now()})
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	page.ProcessingMS = float64(time.Since(start).Microseconds()) / 1000
	return page, nil
}
func signatureForFacets(r catalogRequest) string {
	r.Offset = 0
	r.Limit = 0
	r.Cursor = ""
	r.AllOffers = false
	r.Sort = ""
	r.Query = matching.ParseCatalogQuery(r.Query).Text
	return catalogHash(r)
}

func loadCatalogOffers(ctx context.Context, tx *sql.Tx, groups []catalogGroup, plan matching.QueryPlan, f catalogFilters, cutoff time.Time, all bool) error {
	byID := map[string]*catalogGroup{}
	ids := []string{}
	for i := range groups {
		byID[groups[i].ID] = &groups[i]
		ids = append(ids, groups[i].ID)
	}
	q := catalogWhere(plan, f, "", cutoff)
	q.clauses = append(q.clauses, "s.id=ANY("+q.bind(pq.Array(ids))+"::text[])")
	rows, e := tx.QueryContext(ctx, `SELECT p.id,p.title,p.price,p."vendorId",v.name,p.link,coalesce(p.thumbnail,''),s.brand,s.id,s.dosage_value,s.dosage_unit,s.form,s.quantity,p."priceScrapedAt",s.category,p.availability,s.volume_value,s.volume_unit`+q.from()+` ORDER BY p.price,p."vendorId",p.id`, q.args...)
	if e != nil {
		return e
	}
	defer rows.Close()
	raw := map[string][]catalogOffer{}
	for rows.Next() {
		p := catalogOffer{}
		var observed time.Time
		if e = rows.Scan(&p.ID, &p.Title, &p.Price, &p.VendorID, &p.VendorName, &p.Link, &p.Thumbnail, &p.Brand, &p.GroupKey, &p.Dosage, &p.DosageUnit, &p.Form, &p.Quantity, &observed, &p.Category, &p.Availability, &p.Volume, &p.VolumeUnit); e != nil {
			return e
		}
		p.UpdatedAt = observed.UTC().Format(time.RFC3339)
		g := byID[p.GroupKey]
		if g.UnitQuantity > 0 {
			p.UnitPrice = math.Round(p.Price/g.UnitQuantity*100) / 100
		}
		raw[p.GroupKey] = append(raw[p.GroupKey], p)
	}
	if e = rows.Err(); e != nil {
		return e
	}
	for i := range groups {
		g := &groups[i]
		offers := raw[g.ID]
		vendors := map[string]bool{}
		dedup := []catalogOffer{}
		for _, p := range offers {
			if !vendors[p.VendorID] {
				vendors[p.VendorID] = true
				p.Rank = len(dedup)
				dedup = append(dedup, p)
			}
		}
		g.ProductCount = len(offers)
		g.VendorCount = len(dedup)
		if len(dedup) > 0 {
			g.PriceRange.Min = dedup[0].Price
			g.PriceRange.Max = dedup[len(dedup)-1].Price
			total := 0.0
			for _, p := range dedup {
				total += p.Price
			}
			g.PriceRange.Avg = total / float64(len(dedup))
			g.UnitPriceMin = dedup[0].UnitPrice
		}
		g.DetailsComplete = all || (len(dedup) <= 3 && len(offers) == len(dedup))
		g.Products = dedup
		if !all && len(g.Products) > 3 {
			g.Products = g.Products[:3]
		}
		if all {
			g.Offers = offers
		}
	}
	return nil
}

func (p *catalogPage) asMap() map[string]any {
	data, _ := json.Marshal(p)
	out := map[string]any{}
	_ = json.Unmarshal(data, &out)
	facets := map[string]any{}
	for k, v := range p.Facets {
		facets[k] = v.Values
	}
	out["facets"] = facets
	return out
}
func (p *catalogPage) proto() *pb.ProductGroupChunk {
	groups := make([]*pb.ProductGroup, 0, len(p.Groups))
	convert := func(items []catalogOffer) []*pb.Product {
		out := make([]*pb.Product, 0, len(items))
		for _, v := range items {
			out = append(out, &pb.Product{Id: v.ID, Title: v.Title, Price: v.Price, VendorId: v.VendorID, VendorName: v.VendorName, Link: v.Link, Thumbnail: v.Thumbnail, BrandName: v.Brand, GroupKey: v.GroupKey, DosageValue: v.Dosage, DosageUnit: v.DosageUnit, Form: v.Form, Quantity: int32(v.Quantity), Rank: int32(v.Rank), PriceUpdatedAt: v.UpdatedAt, Category: v.Category, Availability: v.Availability, VolumeValue: v.Volume, VolumeUnit: v.VolumeUnit, UnitPrice: v.UnitPrice})
		}
		return out
	}
	for _, g := range p.Groups {
		groups = append(groups, &pb.ProductGroup{Id: g.ID, NormalizedName: g.Name, Products: convert(g.Products), Offers: convert(g.Offers), PriceRange: &pb.PriceRange{Min: g.PriceRange.Min, Max: g.PriceRange.Max, Avg: g.PriceRange.Avg}, VendorCount: int32(g.VendorCount), ProductCount: int32(g.ProductCount), DosageValue: g.Dosage, DosageUnit: g.DosageUnit, FamilyId: g.FamilyID, Comparable: g.Comparable, MatchMethod: g.MatchMethod, UnitPriceMin: g.UnitPriceMin, UnitLabel: g.UnitLabel, DetailsComplete: g.DetailsComplete, Category: g.Category, Brand: g.Brand})
	}
	return &pb.ProductGroupChunk{Groups: groups, IsComplete: true, Metadata: &pb.SearchMetadata{TotalGroups: int32(p.TotalGroups), TotalProducts: int32(p.TotalProducts), Facets: p.Facets, SearchTypeUsed: p.SearchType, CorrectedQuery: p.CorrectedQuery, OriginalQuery: p.Query, NextCursor: p.NextCursor, CatalogVersion: p.CatalogVersion, PriceMin: p.PriceMin, PriceMax: p.PriceMax, FacetGrain: p.FacetGrain, RequestId: p.RequestID, ProcessingTimeMs: p.ProcessingMS}}
}
