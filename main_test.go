package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"math"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestCatalogRejectsInvalidInputBeforeAccessingDatabase(t *testing.T) {
	for _, r := range []catalogRequest{{Limit: -1}, {Offset: -1}, {Limit: 10000}, {Query: strings.Repeat("q", 257)}, {Sort: "arbitrary sql"}, {Filters: catalogFilters{MinPrice: 20, MaxPrice: 10}}, {Filters: catalogFilters{MinPrice: math.NaN()}}, {Filters: catalogFilters{Quantities: []int{-1}}}} {
		s := &server{}
		if _, err := s.catalogSearch(context.Background(), r); err == nil {
			t.Fatalf("invalid input accepted: %+v", r)
		}
	}
}

func TestCatalogCursorBindsQueryFiltersAndGeneration(t *testing.T) {
	r, _ := normalizeCatalogRequest(catalogRequest{Query: "Magnezijum", Filters: catalogFilters{Brands: []string{"Solgar"}}, Limit: 24})
	signature := requestSignature(r)
	data, _ := json.Marshal(catalogCursor{Generation: "first", Signature: signature, Offset: 24})
	cursor := base64.RawURLEncoding.EncodeToString(data)
	if n, e := decodeCatalogCursor(cursor, "first", signature); e != nil || n != 24 {
		t.Fatal(n, e)
	}
	if _, e := decodeCatalogCursor(cursor, "second", signature); e == nil {
		t.Fatal("cursor survived catalog refresh")
	}
	r.Filters.Brands = []string{"Now Foods"}
	if _, e := decodeCatalogCursor(cursor, "first", requestSignature(r)); e == nil {
		t.Fatal("cursor survived filter change")
	}
	r.Query = "магнезијум"
	r.Filters.Brands = []string{"Solgar"}
	if requestSignature(r) != signature {
		t.Fatal("equivalent language queries have different normalized plans")
	}
}

func TestConcurrentCatalogMissesShareWork(t *testing.T) {
	g := catalogFlightGroup{}
	var runs atomic.Int32
	var wait sync.WaitGroup
	start := make(chan struct{})
	for range 10 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			_, e := g.do(context.Background(), "same", func() (*catalogPage, error) {
				runs.Add(1)
				time.Sleep(30 * time.Millisecond)
				return &catalogPage{}, nil
			})
			if e != nil {
				t.Error(e)
			}
		}()
	}
	close(start)
	wait.Wait()
	if runs.Load() != 1 {
		t.Fatalf("duplicate work: %d", runs.Load())
	}
}

func TestEmptySearchesCannotGrowCacheWithoutBound(t *testing.T) {
	c := newSearchResultCache(50000, time.Minute)
	for i := range 1000 {
		c.put(string(rune(i)), &cachedSearchResult{cachedAt: time.Now()})
	}
	if c.stats().entries > 256 {
		t.Fatal("empty-query cache is unbounded")
	}
}
