// Command groupdump computes BuildGroupKey for every product and reports
// multi-product groups, sorted to surface over-merge suspects (a brand-independent
// "prod::" group spanning many distinct brands, or any group mixing very different
// titles). QA tool for the grouping redesign.
//
//	go run ./cmd/groupdump            # human report of top suspects
//	go run ./cmd/groupdump -json out  # full machine-readable dump
package main

import (
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"

	_ "github.com/lib/pq"

	"github.com/callmeahab/pharma-search/internal/matching"
)

type group struct {
	Key      string   `json:"key"`
	Method   string   `json:"method"`
	Display  string   `json:"display"`
	Products int      `json:"products"`
	Vendors  int      `json:"vendors"`
	Brands   []string `json:"brands"`
	Samples  []string `json:"samples"`
	vendset  map[string]struct{}
	brandset map[string]struct{}
}

func main() {
	jsonOut := flag.String("json", "", "write full JSON dump to this file")
	csvOut := flag.String("csv", "", "write per-product rows (id,vendor,key,method,display,groupSize,form,brand,core,title) to this file")
	flag.Parse()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:docker@localhost:5432/pharma_search?sslmode=disable"
	}
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		panic(err)
	}
	defer db.Close()

	rows, err := db.Query(`
		SELECT p.id, p.title, COALESCE(p."extractedBrand",''), COALESCE(p."coreProductIdentity",''),
		       p."dosageValue", COALESCE(p."dosageUnit",''), p."volumeValue", COALESCE(p."volumeUnit",''),
		       p."quantityValue", COALESCE(p.form,''), p."vendorId", COALESCE(p."canonicalIdentity",'')
		FROM "Product" p WHERE p.price > 0`)
	if err != nil {
		panic(err)
	}
	defer rows.Close()

	type prec struct{ id, vendor, key, method, display, form, brand, core, title string }
	var recs []prec
	groups := map[string]*group{}
	total := 0
	for rows.Next() {
		var id, title, brand, core, dunit, vunit, form, vendor, canonical string
		var dval, vval sql.NullFloat64
		var qval sql.NullInt64
		if err := rows.Scan(&id, &title, &brand, &core, &dval, &dunit, &vval, &vunit, &qval, &form, &vendor, &canonical); err != nil {
			panic(err)
		}
		total++
		gk := matching.BuildGroupKey(matching.GroupKeyInput{
			Core: core, CanonicalIdentity: canonical, Brand: brand, Title: title, ProductID: id,
			DosageValue: dval.Float64, DosageUnit: dunit,
			VolumeValue: vval.Float64, VolumeUnit: vunit,
			Quantity: float64(qval.Int64), Form: form,
		})
		g := groups[gk.Key]
		if g == nil {
			g = &group{Key: gk.Key, Method: gk.Method, Display: gk.DisplayName,
				vendset: map[string]struct{}{}, brandset: map[string]struct{}{}}
			groups[gk.Key] = g
		}
		g.Products++
		g.vendset[vendor] = struct{}{}
		if b := strings.TrimSpace(brand); b != "" {
			g.brandset[b] = struct{}{}
		}
		if len(g.Samples) < 4 {
			g.Samples = append(g.Samples, title)
		}
		if *csvOut != "" {
			recs = append(recs, prec{id, vendor, gk.Key, gk.Method, gk.DisplayName, form, brand, core, title})
		}
	}

	all := make([]*group, 0, len(groups))
	byMethod := map[string]int{}
	multi := 0
	for _, g := range groups {
		g.Vendors = len(g.vendset)
		for b := range g.brandset {
			g.Brands = append(g.Brands, b)
		}
		sort.Strings(g.Brands)
		byMethod[g.Method]++
		if g.Products > 1 {
			multi++
		}
		all = append(all, g)
	}

	fmt.Printf("products=%d  groups=%d  multi-product=%d\n", total, len(groups), multi)
	fmt.Printf("by method: %v\n\n", byMethod)

	// Over-merge suspects: a brand-independent prod:: group covering >=2 distinct
	// brands is a candidate wrong-merge; sku:: should never span >1 brand.
	suspects := make([]*group, 0)
	for _, g := range all {
		if (g.Method == "brand-line" && len(g.Brands) >= 2) || (g.Method == "brand-sku" && len(g.Brands) >= 2) {
			suspects = append(suspects, g)
		}
	}
	sort.Slice(suspects, func(i, j int) bool {
		if len(suspects[i].Brands) != len(suspects[j].Brands) {
			return len(suspects[i].Brands) > len(suspects[j].Brands)
		}
		return suspects[i].Products > suspects[j].Products
	})

	fmt.Printf("=== OVER-MERGE SUSPECTS (multi-brand prod::/sku:: groups): %d ===\n", len(suspects))
	for i, g := range suspects {
		if i >= 40 {
			fmt.Printf("... and %d more\n", len(suspects)-40)
			break
		}
		fmt.Printf("[%s] %s  prod=%d brands=%d %v\n    e.g. %s\n",
			g.Method, g.Key, g.Products, len(g.Brands), truncBrands(g.Brands),
			strings.Join(g.Samples[:min(2, len(g.Samples))], " || "))
	}

	if *csvOut != "" {
		f, _ := os.Create(*csvOut)
		defer f.Close()
		w := csv.NewWriter(f)
		_ = w.Write([]string{"id", "vendor", "key", "method", "display", "groupSize", "form", "brand", "core", "title"})
		for _, r := range recs {
			gs := 0
			if g := groups[r.key]; g != nil {
				gs = g.Products
			}
			_ = w.Write([]string{r.id, r.vendor, r.key, r.method, r.display, fmt.Sprintf("%d", gs), r.form, r.brand, r.core, r.title})
		}
		w.Flush()
		fmt.Printf("\nper-product csv -> %s (%d rows)\n", *csvOut, len(recs))
	}

	if *jsonOut != "" {
		sort.Slice(all, func(i, j int) bool { return all[i].Products > all[j].Products })
		f, _ := os.Create(*jsonOut)
		defer f.Close()
		enc := json.NewEncoder(f)
		enc.SetIndent("", " ")
		_ = enc.Encode(all)
		fmt.Printf("\nfull dump -> %s (%d groups)\n", *jsonOut, len(all))
	}
}

func truncBrands(b []string) []string {
	if len(b) > 6 {
		return append(b[:6:6], "...")
	}
	return b
}
