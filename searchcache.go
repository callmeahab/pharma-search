package main

import (
	"container/list"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	pb "github.com/callmeahab/pharma-search/gen"
)

// cachedSearchResult is a fully grouped + filtered search result, ready to paginate.
// The same entry is shared (read-only) by the unary and streaming handlers.
type cachedSearchResult struct {
	groups    []map[string]any
	facets    map[string]*pb.FacetValues
	totalHits int
	products  int // member products held by this entry (the cache's memory unit)
	cachedAt  time.Time
}

// searchResultCache is a bounded, TTL'd LRU of grouped search results.
//
// It is capped by the TOTAL number of member products held across all entries, NOT by
// entry count: one broad query ("vitamin") can hold ~5000 products while a narrow one
// holds a handful, so a product budget bounds real memory regardless of that skew. This
// is the safety property that matters on the 2GB box — without it, a burst of DISTINCT
// queries (autocomplete firing per keystroke, a crawler, many varied users) would each
// cache a full grouped result and balloon the heap within the TTL window. LRU eviction
// keeps the hottest queries and discards the cold ones once the budget is hit.
type searchResultCache struct {
	mu          sync.Mutex
	ll          *list.List // front = most-recently used
	items       map[string]*list.Element
	curProducts int
	maxProducts int
	ttl         time.Duration
	hits        atomic.Uint64
	misses      atomic.Uint64
}

type cacheItem struct {
	key string
	res *cachedSearchResult
}

func newSearchResultCache(maxProducts int, ttl time.Duration) *searchResultCache {
	return &searchResultCache{
		ll:          list.New(),
		items:       make(map[string]*list.Element),
		maxProducts: maxProducts,
		ttl:         ttl,
	}
}

// get returns a fresh (non-expired) entry and marks it most-recently-used, or nil.
func (c *searchResultCache) get(key string) *cachedSearchResult {
	if c == nil || c.ttl <= 0 {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	el, ok := c.items[key]
	if !ok {
		c.misses.Add(1)
		return nil
	}
	it := el.Value.(*cacheItem)
	if time.Since(it.res.cachedAt) > c.ttl {
		c.removeElement(el)
		c.misses.Add(1)
		return nil
	}
	c.ll.MoveToFront(el)
	c.hits.Add(1)
	return it.res
}

// put inserts/updates an entry and evicts least-recently-used entries until the total
// product budget is satisfied (always keeping the entry just inserted).
func (c *searchResultCache) put(key string, res *cachedSearchResult) {
	if c == nil || c.ttl <= 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.items[key]; ok {
		old := el.Value.(*cacheItem)
		c.curProducts += res.products - old.res.products
		old.res = res
		c.ll.MoveToFront(el)
	} else {
		el := c.ll.PushFront(&cacheItem{key: key, res: res})
		c.items[key] = el
		c.curProducts += res.products
	}
	for c.curProducts > c.maxProducts && c.ll.Len() > 1 {
		c.removeElement(c.ll.Back())
	}
}

// removeElement unlinks el and decrements the product budget. Caller holds c.mu.
func (c *searchResultCache) removeElement(el *list.Element) {
	it := el.Value.(*cacheItem)
	c.ll.Remove(el)
	delete(c.items, it.key)
	c.curProducts -= it.res.products
}

// sweepExpired drops every entry past its TTL (called periodically so cold expired
// entries don't sit on the heap until they happen to be looked up).
func (c *searchResultCache) sweepExpired() {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for el := c.ll.Back(); el != nil; {
		prev := el.Prev()
		if time.Since(el.Value.(*cacheItem).res.cachedAt) > c.ttl {
			c.removeElement(el)
		}
		el = prev
	}
}

type cacheStats struct {
	hits, misses     uint64
	entries, products int
}

func (c *searchResultCache) stats() cacheStats {
	c.mu.Lock()
	entries, products := c.ll.Len(), c.curProducts
	c.mu.Unlock()
	return cacheStats{hits: c.hits.Load(), misses: c.misses.Load(), entries: entries, products: products}
}

func getEnvInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
