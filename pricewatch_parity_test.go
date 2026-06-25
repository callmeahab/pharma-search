package main

import (
	"database/sql"
	"os"
	"testing"

	_ "github.com/lib/pq"
)

// referenceSnapshot reproduces the OLD map-based pipeline but, like the search path,
// includes canonicalIdentity — i.e. the semantics the lean computeGroupSnapshots must
// match. Uses the production enrich + fold helpers as the source of truth.
func referenceSnapshot(db *sql.DB) (map[string]groupSnapshot, error) {
	rows, err := db.Query(`
		SELECT p.id, p.title, p.price, p."vendorId", v.name,
		       p.link, COALESCE(p.thumbnail,''), COALESCE(p."extractedBrand",''),
		       COALESCE(p."normalizedName",''), COALESCE(p."coreProductIdentity",''),
		       COALESCE(p."canonicalIdentity",''),
		       p."dosageValue", COALESCE(p."dosageUnit",''),
		       p."volumeValue", COALESCE(p."volumeUnit",''),
		       COALESCE(p.form,''), p."quantityValue"
		FROM "Product" p JOIN "Vendor" v ON v.id = p."vendorId"
		WHERE p.price > 0`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var hits []map[string]any
	for rows.Next() {
		var id, title, vendorID, vendorName, link, thumbnail string
		var brand, normName, core, canon, dosageUnit, volumeUnit, form string
		var price, dosageValue, volumeValue sql.NullFloat64
		var qty sql.NullInt64
		if err := rows.Scan(&id, &title, &price, &vendorID, &vendorName, &link, &thumbnail,
			&brand, &normName, &core, &canon, &dosageValue, &dosageUnit,
			&volumeValue, &volumeUnit, &form, &qty); err != nil {
			return nil, err
		}
		hits = append(hits, map[string]any{
			"id": id, "title": title, "price": price.Float64, "vendorId": vendorID,
			"vendorName": vendorName, "link": link, "thumbnail": thumbnail, "brand": brand,
			"normalizedName": normName, "coreProductIdentity": core, "canonicalIdentity": canon,
			"dosageValue": dosageValue.Float64, "dosageUnit": dosageUnit,
			"volumeValue": volumeValue.Float64, "volumeUnit": volumeUnit,
			"form": form, "quantityValue": float64(qty.Int64),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	products := enrichProductsWithGroupKey(hits)
	attachSizelessToLines(products)
	attachFormlessToDominantForm(products)
	snap := map[string]groupSnapshot{}
	for _, p := range products {
		gk := getString(p, "group_key")
		if gk == "" {
			continue
		}
		price := getFloat(p, "price")
		if price <= 0 {
			continue
		}
		cur, ok := snap[gk]
		if !ok {
			snap[gk] = groupSnapshot{MinPrice: price, Vendor: getString(p, "vendor_name"), OfferCount: 1}
			continue
		}
		cur.OfferCount++
		if price < cur.MinPrice {
			cur.MinPrice = price
			cur.Vendor = getString(p, "vendor_name")
		}
		snap[gk] = cur
	}
	return snap, nil
}

func TestSnapshotParity(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("no DATABASE_URL")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	ref, err := referenceSnapshot(db)
	if err != nil {
		t.Fatal(err)
	}
	got, err := computeGroupSnapshots(db)
	if err != nil {
		t.Fatal(err)
	}

	if len(ref) != len(got) {
		t.Errorf("group COUNT differs: ref=%d lean=%d", len(ref), len(got))
	}
	// MinPrice + OfferCount are order-independent; Vendor can differ only on a price
	// tie (benign, order-dependent in both old and new code) so it is logged, not failed.
	priceCountMismatch, missing, vendorTieDiff := 0, 0, 0
	for k, rv := range ref {
		gv, ok := got[k]
		if !ok {
			missing++
			if missing <= 10 {
				t.Errorf("key only in ref: %q (%+v)", k, rv)
			}
			continue
		}
		if gv.MinPrice != rv.MinPrice || gv.OfferCount != rv.OfferCount {
			priceCountMismatch++
			if priceCountMismatch <= 10 {
				t.Errorf("price/count mismatch %q: ref=%+v lean=%+v", k, rv, gv)
			}
		} else if gv.Vendor != rv.Vendor {
			vendorTieDiff++
		}
	}
	extra := 0
	for k := range got {
		if _, ok := ref[k]; !ok {
			extra++
			if extra <= 10 {
				t.Errorf("key only in lean: %q", k)
			}
		}
	}
	t.Logf("PARITY: ref=%d lean=%d groups | missing=%d extra=%d price/count_mismatch=%d vendor_tie_diff=%d",
		len(ref), len(got), missing, extra, priceCountMismatch, vendorTieDiff)
}
