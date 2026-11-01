package main

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	pb "github.com/callmeahab/pharma-search/gen"
	"github.com/lib/pq"
)

func TestCatalogEndToEnd(t *testing.T) {
	dsn := os.Getenv("CATALOG_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set CATALOG_TEST_DATABASE_URL for isolated PostgreSQL integration tests")
	}
	ctx := context.Background()
	admin, e := sql.Open("postgres", dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer admin.Close()
	schema := fmt.Sprintf("catalog_test_%d", time.Now().UnixNano())
	if _, e = admin.Exec(`CREATE SCHEMA ` + pq.QuoteIdentifier(schema)); e != nil {
		t.Fatal(e)
	}
	defer admin.Exec(`DROP SCHEMA ` + pq.QuoteIdentifier(schema) + ` CASCADE`)
	u, e := url.Parse(dsn)
	if e != nil {
		t.Fatal(e)
	}
	q := u.Query()
	q.Set("search_path", schema+",public")
	u.RawQuery = q.Encode()
	db, e := sql.Open("postgres", u.String())
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	_, e = db.Exec(`CREATE TABLE "Vendor"(id text PRIMARY KEY,name text NOT NULL);
	 CREATE TABLE "Product"(id text PRIMARY KEY,"vendorId" text,title text,price float8,link text,thumbnail text,"extractedBrand" text,"coreProductIdentity" text,"canonicalIdentity" text,"dosageValue" float8,"dosageUnit" text,"volumeValue" float8,"volumeUnit" text,"quantityValue" int,form text,"canonicalCategory" text,"priceScrapedAt" timestamptz);
	 CREATE TABLE "Watch"(id text PRIMARY KEY,"userId" text,"groupKey" text,"lastPrice" float8);
	 INSERT INTO "Vendor" VALUES ('a','Shop A'),('b','Shop B'),('c','Shop C');`)
	if e != nil {
		t.Fatal(e)
	}
	migration, e := os.ReadFile("migrations/018_catalog_skus.sql")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(string(migration)); e != nil {
		t.Fatal(e)
	}
	for _, file := range []string{"migrations/019_catalog_events.sql", "migrations/020_catalog_offer_snapshots.sql", "migrations/021_catalog_suggestions.sql"} {
		data, e := os.ReadFile(file)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = db.Exec(string(data)); e != nil {
			t.Fatal(e)
		}
	}
	fixtures := []struct {
		id, title, brand, vendor string
		price                    float64
		age                      string
	}{
		{"z1", "Solgar Cink 22mg 30 tableta", "Solgar", "a", 1600, "1 hour"},
		{"z2", "Solgar Cink 22mg 30 tableta akcija", "Solgar", "a", 1700, "1 hour"},
		{"z3", "Solgar Cink 22mg 30 tableta", "Solgar", "b", 1800, "1 hour"},
		{"z4", "Solevita Cink 22mg 30 tableta", "Solevita", "c", 89, "1 hour"},
		{"stale", "Solgar Cink 22mg 30 tableta", "Solgar", "c", 50, "40 days"},
		{"pack", "Solgar Cink 22mg 60 tableta", "Solgar", "a", 2200, "1 hour"},
		{"citrate", "Solgar Magnezijum citrat 200mg 60 tableta", "Solgar", "a", 1300, "1 hour"},
		{"bisglycinate", "Solgar Magnezijum bisglicinat 200mg 60 tableta", "Solgar", "a", 1900, "1 hour"},
		{"fervex", "Fervex Phyto 20 lozenge", "Fervex", "a", 650, "1 hour"},
		{"size2weight4", "Pampers Premium Care, veličina 2, 46 kom, 4kg-8kg", "Pampers", "a", 999, "1 hour"},
		{"size1", "Pampers Premium Care 1 1 pelena", "Pampers", "a", 29, "1 hour"},
		{"size4", "Pampers Premium Care 4 20 pelena", "Pampers", "a", 800, "1 hour"},
		{"unknown1", "Solgar Cink", "Solgar", "a", 900, "1 hour"},
		{"unknown2", "Solgar Cink", "Solgar", "b", 950, "1 hour"},
	}
	for _, f := range fixtures {
		_, e = db.Exec(`INSERT INTO "Product"(id,title,"extractedBrand","vendorId",price,link,thumbnail,"canonicalCategory","priceScrapedAt") VALUES ($1,$2,$3,$4,$5,'https://example.test/'||$1,'','Supplements & Vitamins',now()-$6::interval)`, f.id, f.title, f.brand, f.vendor, f.price, f.age)
		if e != nil {
			t.Fatal(e)
		}
	}
	if e = rebuildCatalog(ctx, db); e != nil {
		t.Fatal(e)
	}
	s := &server{db: db, searchCache: newSearchResultCache(50000, time.Minute), autocompleteCache: newAutocompleteCache(100, time.Minute)}
	search := func(r catalogRequest) *catalogPage {
		t.Helper()
		p, e := s.catalogSearch(ctx, r)
		if e != nil {
			t.Fatal(e)
		}
		return p
	}
	zinc := search(catalogRequest{Query: "cink", AllOffers: true, Filters: catalogFilters{Brands: []string{"Solgar"}}})
	var exact catalogGroup
	for _, g := range zinc.Groups {
		for _, p := range g.Products {
			if p.Brand != "Solgar" {
				t.Fatalf("brand filter leaked %s", p.Brand)
			}
			if p.ID == "z1" {
				exact = g
			}
		}
	}
	if exact.ID == "" || exact.PriceRange.Min != 1600 || exact.ProductCount != 3 || len(exact.Products) != 2 || len(exact.Offers) != 3 {
		t.Fatalf("incorrect exact comparison: %+v", exact)
	}
	snapshots, e := computeGroupSnapshots(db)
	if e != nil {
		t.Fatal(e)
	}
	if snapshots[exact.ID].MinPrice != exact.PriceRange.Min {
		t.Fatal("watch minimum differs from exact product", snapshots[exact.ID], exact.PriceRange)
	}
	for _, q := range []string{"magnezijum citrat", "magnezijum bisglicinat"} {
		p := search(catalogRequest{Query: q})
		if p.TotalGroups != 1 || !strings.Contains(strings.ToLower(p.Groups[0].Name), strings.Fields(q)[1]) {
			t.Fatalf("lost formulation %s: %+v", q, p)
		}
	}
	p := search(catalogRequest{Query: "pampers premium care 4"})
	if p.TotalGroups != 1 || p.Groups[0].PriceRange.Min != 800 {
		t.Fatal("size constraint lost", p)
	}
	p = search(catalogRequest{Query: "ferveks"})
	if p.TotalGroups != 1 || p.CorrectedQuery != "fervex" {
		t.Fatal("typo correction failed", p)
	}
	p = search(catalogRequest{Query: "cink", Limit: 1, Sort: "price_asc"})
	if p.NextCursor == "" {
		t.Fatal("missing cursor")
	}
	next := search(catalogRequest{Query: "cink", Limit: 1, Sort: "price_asc", Cursor: p.NextCursor})
	if next.Groups[0].ID == p.Groups[0].ID {
		t.Fatal("page repeated")
	}
	if _, e = s.SearchGroups(ctx, connect.NewRequest(&pb.SearchGroupsRequest{Limit: -1})); connect.CodeOf(e) != connect.CodeInvalidArgument {
		t.Fatal("negative limit must be rejected", e)
	}
	p = search(catalogRequest{Query: "cink", Filters: catalogFilters{Vendors: []string{"Shop B"}, MinPrice: 1700, Forms: []string{"tablete"}, Quantities: []int{30}}})
	if p.TotalGroups != 1 || p.Groups[0].PriceRange.Min != 1800 || p.Groups[0].VendorCount != 1 {
		t.Fatal("full-result offer filters failed", p)
	}
	var history int
	if e = db.QueryRow(`SELECT count(*) FROM "CatalogPriceHistory"`).Scan(&history); e != nil || history == 0 {
		t.Fatal("catalog history must exist without watches", e)
	}
	var observation int
	if e = db.QueryRow(`SELECT count(*) FROM "OfferPriceObservation" WHERE title=$1`, fixtures[0].title).Scan(&observation); e != nil || observation != 3 {
		t.Fatal("source observations were lost", observation, e)
	}
	// Importing source rows must not change the current publication's prices.
	if _, e = db.Exec(`UPDATE "Product" SET price=5 WHERE id='z1'`); e != nil {
		t.Fatal(e)
	}
	published := search(catalogRequest{Filters: catalogFilters{SKUID: exact.ID}, Limit: 1, AllOffers: true})
	if published.Groups[0].PriceRange.Min != 1600 {
		t.Fatal("unpublished source import leaked into search")
	}
	if _, e = db.Exec(`UPDATE "Product" SET price=1600 WHERE id='z1'`); e != nil {
		t.Fatal(e)
	}
	// More than the old retrieval cap: totals and paging must remain complete.
	_, e = db.Exec(`INSERT INTO "Product"(id,title,"extractedBrand","vendorId",price,link,thumbnail,"canonicalCategory","priceScrapedAt") SELECT 'bulk-'||i,'Synthetic item '||i||' 30 tableta','Synthetic','a',i+10,'https://example.test/bulk/'||i,'','Supplements & Vitamins',now() FROM generate_series(1,5101)i`)
	if e != nil {
		t.Fatal(e)
	}
	if e = rebuildCatalog(ctx, db); e != nil {
		t.Fatal(e)
	}
	p = search(catalogRequest{Query: "synthetic", Offset: 5100, Limit: 1, Sort: "price_asc"})
	if p.TotalGroups != 5101 || len(p.Groups) != 1 {
		t.Fatalf("retrieval cap truncated result: %d %d", p.TotalGroups, len(p.Groups))
	}
}
