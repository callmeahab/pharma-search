package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/callmeahab/pharma-search/internal/matching"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

// Read-only replay of the audited catalog queries. Fixture precision is tested
// separately; these operational checks do not claim measured global accuracy.
func runCatalogEvaluation() error {
	db, e := connectDB()
	if e != nil {
		return e
	}
	defer db.Close()
	s := &server{db: db, searchCache: newSearchResultCache(50000, time.Minute), autocompleteCache: newAutocompleteCache(2000, time.Minute)}
	var baseline struct {
		Queries []struct {
			Query string `json:"query"`
		} `json:"local_queries"`
	}
	data, e := os.ReadFile("evaluation-baseline.json")
	if e != nil {
		return e
	}
	if e = json.Unmarshal(data, &baseline); e != nil {
		return e
	}
	report := map[string]any{"evaluated_at": time.Now().UTC(), "build_version": buildVersion, "limitations": []string{"Synthetic query replay and concurrency sample, not user traffic or a global precision estimate.", "Conservative unmatched offers remain separate until identity evidence improves."}}
	cases := []map[string]any{}
	failures := []string{}
	for _, c := range baseline.Queries {
		start := time.Now()
		p, err := s.catalogSearch(context.Background(), catalogRequest{Query: c.Query, Limit: 10})
		if err != nil {
			failures = append(failures, c.Query+": "+err.Error())
			continue
		}
		top := p.Groups[:min(3, len(p.Groups))]
		cases = append(cases, map[string]any{"query": c.Query, "groups": p.TotalGroups, "offers": p.TotalProducts, "first_request_ms": float64(time.Since(start).Microseconds()) / 1000, "top": top, "corrected_query": p.CorrectedQuery})
	}
	// Concrete failure regressions from the original audit.
	for _, r := range []catalogRequest{{Query: "cink", Filters: catalogFilters{Brands: []string{"Solgar"}}}, {Query: "pampers premium care 4"}, {Query: "magnezijum citrat"}, {Query: "magnezijum bisglicinat"}, {Query: "ferveks"}} {
		r.Limit = 60
		p, err := s.catalogSearch(context.Background(), r)
		if err != nil {
			return err
		}
		for _, g := range p.Groups {
			if len(r.Filters.Brands) > 0 && g.Brand != "Solgar" {
				failures = append(failures, "Solgar brand filter leaked: "+g.Name)
			}
			if strings.Contains(r.Query, "bisglicinat") && !strings.Contains(strings.ToLower(g.Name), "bisg") {
				failures = append(failures, "lost bisglycinate constraint: "+g.Name)
			}
			if r.Query == "magnezijum citrat" && !strings.Contains(strings.ToLower(g.Name), "citr") {
				failures = append(failures, "lost citrate constraint: "+g.Name)
			}
			if size := matching.DiaperSize(r.Query); size != "" && matching.DiaperSize(g.Name) != size {
				failures = append(failures, "wrong diaper size: "+g.Name)
			}
			if r.Query == "ferveks" && !strings.Contains(strings.ToLower(g.Name), "fervex") {
				failures = append(failures, "typo matched wrong product: "+g.Name)
			}
		}
	}
	snapshot, e := computeGroupSnapshots(db)
	if e != nil {
		return e
	}
	for _, q := range []string{"magnezijum", "protein", "solgar cink", "pampers premium care 4"} {
		p, err := s.catalogSearch(context.Background(), catalogRequest{Query: q, Limit: 60})
		if err != nil {
			return err
		}
		for _, g := range p.Groups {
			if snap, ok := snapshot[g.ID]; !ok || snap.MinPrice != g.PriceRange.Min {
				failures = append(failures, "watch/search mismatch: "+g.ID)
			}
		}
	}
	auto := []map[string]any{}
	for _, q := range []string{"vi", "vit", "magn", "solg", "pamp", "ferveks"} {
		start := time.Now()
		r, err := s.catalogAutocomplete(context.Background(), q, 8)
		if err != nil {
			failures = append(failures, "autocomplete "+q+": "+err.Error())
			continue
		}
		auto = append(auto, map[string]any{"query": q, "first_request_ms": float64(time.Since(start).Microseconds()) / 1000, "count": len(r.Suggestions)})
	}
	var mu sync.Mutex
	latencies := []float64{}
	var wg sync.WaitGroup
	for worker := 0; worker < 4; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 8; i++ {
				start := time.Now()
				_, err := s.catalogSearch(context.Background(), catalogRequest{Query: []string{"magnezijum", "protein", "vitamin d", "pampers"}[i%4], Limit: 24})
				mu.Lock()
				latencies = append(latencies, float64(time.Since(start).Microseconds())/1000)
				if err != nil {
					failures = append(failures, err.Error())
				}
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	sort.Float64s(latencies)
	var offers, skus, comparable, multi, ambiguous int
	if e = db.QueryRow(`SELECT count(*),count(DISTINCT p.sku_id),count(*) FILTER(WHERE s.comparable) FROM "CatalogOffer" p JOIN "CatalogSku" s ON s.id=p.sku_id`).Scan(&offers, &skus, &comparable); e != nil {
		return e
	}
	db.QueryRow(`SELECT count(*) FROM(SELECT p.sku_id FROM "CatalogOffer" p JOIN "CatalogSku" s ON s.id=p.sku_id WHERE s.comparable GROUP BY p.sku_id HAVING count(DISTINCT p."vendorId")>1) x`).Scan(&multi)
	db.QueryRow(`SELECT count(*) FROM "CatalogIdentityAlias" WHERE candidate_count>1`).Scan(&ambiguous)
	report["catalog"] = map[string]int{"offers": offers, "skus": skus, "offers_with_confirmed_identity": comparable, "multivendor_skus": multi, "legacy_keys_split_into_multiple_skus": ambiguous}
	report["queries"] = cases
	report["autocomplete"] = auto
	report["concurrency_sample"] = map[string]any{"workers": 4, "requests": len(latencies), "median_ms": latencies[len(latencies)/2], "p95_ms": latencies[(len(latencies)*95-1)/100], "max_ms": latencies[len(latencies)-1]}
	report["failures"] = failures
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if e = enc.Encode(report); e != nil {
		return e
	}
	if len(failures) > 0 {
		return fmt.Errorf("%d evaluation checks failed", len(failures))
	}
	return nil
}
