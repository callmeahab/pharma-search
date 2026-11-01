package main

import (
	"database/sql"
	"os"
	"testing"
	"time"
)

// Optional read-only check of the real refreshed catalog. The isolated fixture
// test additionally checks brand/pack separation and exclusion of stale prices.
func TestSnapshotParity(t *testing.T) {
	dsn := os.Getenv("CATALOG_PARITY_DATABASE_URL")
	if dsn == "" {
		t.Skip("set CATALOG_PARITY_DATABASE_URL for real-catalog watch parity")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	actual, err := computeGroupSnapshots(db)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := db.Query(`SELECT sku_id,price FROM "CatalogOffer" WHERE price>0 AND availability<>'unavailable' AND "priceScrapedAt">=$1 AND sku_id IS NOT NULL`, time.Now().Add(-currentOfferMaxAge()))
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	expected := map[string]groupSnapshot{}
	for rows.Next() {
		var key string
		var price float64
		if err = rows.Scan(&key, &price); err != nil {
			t.Fatal(err)
		}
		v := expected[key]
		if v.OfferCount == 0 || price < v.MinPrice {
			v.MinPrice = price
		}
		v.OfferCount++
		expected[key] = v
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(actual) != len(expected) {
		t.Fatal("snapshot population differs", len(actual), len(expected))
	}
	for key, want := range expected {
		got := actual[key]
		if got.MinPrice != want.MinPrice || got.OfferCount != want.OfferCount {
			t.Fatalf("wrong minimum/count for %s: %+v != %+v", key, got, want)
		}
	}
}
