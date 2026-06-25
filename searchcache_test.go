package main

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

func mkRes(products int, age time.Duration) *cachedSearchResult {
	return &cachedSearchResult{products: products, cachedAt: time.Now().Add(-age)}
}

// The whole point of the cache: it must NOT grow without bound. Adding past the product
// budget evicts the least-recently-used entries.
func TestSearchCacheBudgetEviction(t *testing.T) {
	c := newSearchResultCache(100, time.Minute)
	c.put("a", mkRes(50, 0))
	c.put("b", mkRes(50, 0)) // total 100, fits
	c.put("c", mkRes(50, 0)) // total 150 > 100 -> evict LRU (a)
	if c.get("a") != nil {
		t.Error("a should have been evicted (LRU) when the budget was exceeded")
	}
	if c.get("b") == nil || c.get("c") == nil {
		t.Error("b and c should still be present")
	}
	if st := c.stats(); st.products > 100 {
		t.Errorf("product budget exceeded: %d > 100", st.products)
	}
}

func TestSearchCacheLRUOrder(t *testing.T) {
	c := newSearchResultCache(100, time.Minute)
	c.put("a", mkRes(50, 0))
	c.put("b", mkRes(50, 0)) // [b, a]
	c.get("a")               // touch a -> [a, b]; b is now LRU
	c.put("c", mkRes(50, 0)) // 150 > 100 -> evict LRU (b)
	if c.get("b") != nil {
		t.Error("b should be evicted (it was least-recently-used)")
	}
	if c.get("a") == nil {
		t.Error("a should survive (recently used)")
	}
}

func TestSearchCacheTTL(t *testing.T) {
	c := newSearchResultCache(100, time.Minute)
	c.put("x", mkRes(10, 2*time.Minute)) // already older than TTL
	if c.get("x") != nil {
		t.Error("expired entry must be a miss")
	}
	c.put("y", mkRes(10, 0))
	if c.get("y") == nil {
		t.Error("fresh entry must hit")
	}
	// sweepExpired drops cold expired entries proactively
	c.put("z", mkRes(10, 2*time.Minute))
	c.sweepExpired()
	if st := c.stats(); st.entries != 1 {
		t.Errorf("after sweep only the fresh entry should remain, got %d", st.entries)
	}
}

func TestSearchCacheDisabled(t *testing.T) {
	c := newSearchResultCache(100, 0) // ttl<=0 disables the cache
	c.put("x", mkRes(10, 0))
	if c.get("x") != nil {
		t.Error("a disabled cache must store nothing")
	}
}

func TestSearchCacheStats(t *testing.T) {
	c := newSearchResultCache(100, time.Minute)
	c.put("a", mkRes(10, 0))
	c.get("a")
	c.get("a")
	c.get("missing")
	st := c.stats()
	if st.hits != 2 || st.misses != 1 {
		t.Errorf("hits=%d misses=%d, want 2/1", st.hits, st.misses)
	}
}

func TestSearchCacheUpdateBudget(t *testing.T) {
	c := newSearchResultCache(100, time.Minute)
	c.put("a", mkRes(30, 0))
	c.put("a", mkRes(70, 0)) // update same key: budget should track the new size, not sum
	if st := c.stats(); st.products != 70 || st.entries != 1 {
		t.Errorf("updating a key must replace (not add): products=%d entries=%d", st.products, st.entries)
	}
}

// Run with -race: concurrent get/put must stay within budget and not corrupt the LRU.
func TestSearchCacheConcurrent(t *testing.T) {
	c := newSearchResultCache(1000, time.Minute)
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 200; j++ {
				k := fmt.Sprintf("k%d", (i+j)%40)
				if c.get(k) == nil {
					c.put(k, mkRes(10, 0))
				}
			}
		}(i)
	}
	wg.Wait()
	if st := c.stats(); st.products > 1000 {
		t.Errorf("budget exceeded under concurrency: %d > 1000", st.products)
	}
}
