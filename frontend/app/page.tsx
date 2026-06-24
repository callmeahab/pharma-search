"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import ProductList from "@/components/ProductList";
import { searchGroupsStreaming, fetchGroupsPage, getFeaturedProducts, SearchResult, StreamingSearchResult } from "@/lib/api";
import { convertBackendProductToProduct, convertProductGroupToProducts, ProductGroup } from "@/types/product";
import { Spinner } from "@/components/ui/spinner";
import Footer from "@/components/Footer";
import { FilterSidebar, FilterState, defaultFilters, Facets } from "@/components/FilterSidebar";
import { FilterChips } from "@/components/FilterChips";
import { ResultsToolbar } from "@/components/ResultsToolbar";
import { Button } from "@/components/ui/button";
import { Filter, Loader2 } from "lucide-react";

export const dynamic = 'force-dynamic';

const GROUPING_PREFS_KEY = "pharma-search-grouping-prefs";
const PAGE_SIZE = 24;

export default function HomePage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [accumulatedGroups, setAccumulatedGroups] = useState<ProductGroup[]>([]);
  const [totalGroups, setTotalGroups] = useState(0);
  const [totalProducts, setTotalProducts] = useState(0);
  const [facets, setFacets] = useState<Facets | undefined>(undefined);
  const [featuredProducts, setFeaturedProducts] = useState<SearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isLoadingFeatured, setIsLoadingFeatured] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [useApiSearch, setUseApiSearch] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [currentOffset, setCurrentOffset] = useState(0);

  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  // Ref for infinite scroll detection
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const currentSearchTermRef = useRef<string>("");
  // Brand + category filter applied SERVER-SIDE (so it filters the whole result
  // set, not just loaded pages). Kept in a ref so handleSearch/loadMore always read
  // the latest values without changing their identity.
  const backendFiltersRef = useRef<{ brandNames: string[]; categories: string[] }>({
    brandNames: [],
    categories: [],
  });
  backendFiltersRef.current = { brandNames: filters.brands, categories: filters.categories };

  // Load display mode preference from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(GROUPING_PREFS_KEY);
      if (saved) {
        const prefs = JSON.parse(saved);
        setFilters(prev => ({
          ...prev,
          groupSimilar: prefs.groupSimilar ?? prev.groupSimilar,
        }));
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Save display mode preference to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem(GROUPING_PREFS_KEY, JSON.stringify({
        groupSimilar: filters.groupSimilar,
      }));
    } catch {
      // Ignore localStorage errors
    }
  }, [filters.groupSimilar]);

  const loadFeaturedProducts = useCallback(async () => {
    setIsLoadingFeatured(true);
    try {
      const featured = await getFeaturedProducts({ limit: 24 });
      if (featured && typeof featured === 'object' && Array.isArray(featured.groups)) {
        setFeaturedProducts(featured);
      } else {
        console.warn("Featured products response has unexpected structure:", featured);
        setFeaturedProducts({ groups: [], total: 0, offset: 0, limit: 24 });
      }
    } catch (error) {
      console.error("Failed to load featured products:", error);
      setFeaturedProducts({ groups: [], total: 0, offset: 0, limit: 24 });
    } finally {
      setIsLoadingFeatured(false);
    }
  }, []);

  const handleSearch = useCallback(async (term: string) => {
    if (!term || !term.trim()) {
      setAccumulatedGroups([]);
      setTotalGroups(0);
      setTotalProducts(0);
      setFacets(undefined);
      setUseApiSearch(false);
      setSearchError(null);
      setHasMore(false);
      setCurrentOffset(0);
      currentSearchTermRef.current = "";
      loadFeaturedProducts();
      return;
    }

    // Reset state for new search
    setIsSearching(true);
    setSearchError(null);
    setAccumulatedGroups([]);
    setCurrentOffset(0);
    setHasMore(false);
    currentSearchTermRef.current = term;

    try {
      await searchGroupsStreaming(term, (result) => {
        setAccumulatedGroups(result.groups);
        setTotalGroups(result.totalGroups);
        setTotalProducts(result.totalProducts);
        setFacets(result.facets as Facets | undefined);
        setUseApiSearch(true);
        setCurrentOffset(result.groups.length);
        setHasMore(result.groups.length < result.totalGroups);

        // Stop showing loading spinner once we have results
        if (result.groups.length > 0) {
          setIsSearching(false);
        }
      }, {
        offset: 0,
        limit: PAGE_SIZE,
        brandNames: backendFiltersRef.current.brandNames,
        categories: backendFiltersRef.current.categories,
      });
    } catch (error) {
      console.error("Search error:", error);
      setSearchError("Greška pri pretraživanju. Pokušajte ponovo.");
      setAccumulatedGroups([]);
    } finally {
      setIsSearching(false);
    }
  }, [loadFeaturedProducts]);

  // Load more groups when scrolling
  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || !currentSearchTermRef.current) return;

    setIsLoadingMore(true);
    // Signature of the search context this page was requested for; if the term or
    // filters change while the request is in flight, discard the stale page.
    const reqSig = (term: string, f: { brandNames: string[]; categories: string[] }) =>
      `${term}|${f.brandNames.join(",")}|${f.categories.join(",")}`;
    const sig = reqSig(currentSearchTermRef.current, backendFiltersRef.current);
    try {
      const result = await fetchGroupsPage(
        currentSearchTermRef.current,
        currentOffset,
        PAGE_SIZE,
        {
          brandNames: backendFiltersRef.current.brandNames,
          categories: backendFiltersRef.current.categories,
        }
      );

      // Drop the result if a new search/filter superseded this request.
      if (reqSig(currentSearchTermRef.current, backendFiltersRef.current) !== sig) {
        return;
      }

      if (result.groups.length > 0) {
        const nextOffset = currentOffset + result.groups.length;
        setAccumulatedGroups(prev => [...prev, ...result.groups]);
        setCurrentOffset(nextOffset);
        setHasMore(nextOffset < result.totalGroups);

        // Update facets if not already set
        if (!facets && result.facets) {
          setFacets(result.facets as Facets | undefined);
        }
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error("Error loading more results:", error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, currentOffset, facets]);

  // Reset filters when a NEW search term runs — a brand/category/vendor facet from
  // one query doesn't apply to another, and stale server-side brand/category filters
  // would otherwise silently over-restrict the new results. Clears the server-filter
  // ref INLINE so the immediately-following search uses the cleared values, and flags
  // the filter effect to skip the redundant re-search the state change would trigger.
  const skipNextServerFilterSearchRef = useRef(false);
  const resetServerFilters = useCallback(() => {
    backendFiltersRef.current = { brandNames: [], categories: [] };
    setFilters(prev => {
      if (prev.brands.length || prev.categories.length) {
        skipNextServerFilterSearchRef.current = true;
      }
      return { ...defaultFilters, groupSimilar: prev.groupSimilar };
    });
  }, []);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore && !isSearching) {
          loadMore();
        }
      },
      { threshold: 0.1, rootMargin: "200px" }
    );

    const currentRef = loadMoreRef.current;
    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, [hasMore, isLoadingMore, isSearching, loadMore]);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const urlSearchTerm = searchParams.get("q");
    if (urlSearchTerm && urlSearchTerm.trim()) {
      setSearchTerm(urlSearchTerm);
      setUseApiSearch(true);
      resetServerFilters();
      handleSearch(urlSearchTerm);
    } else {
      loadFeaturedProducts();
    }
  }, [handleSearch, loadFeaturedProducts, resetServerFilters]);

  useEffect(() => {
    const handleUrlSearchChanged = (event: CustomEvent) => {
      const { searchTerm: newSearchTerm } = event.detail;
      if (newSearchTerm !== searchTerm) {
        setSearchTerm(newSearchTerm);
        setUseApiSearch(true);
        resetServerFilters();
        handleSearch(newSearchTerm);
      }
    };

    window.addEventListener("urlSearchChanged", handleUrlSearchChanged as EventListener);
    return () => {
      window.removeEventListener("urlSearchChanged", handleUrlSearchChanged as EventListener);
    };
  }, [searchTerm, handleSearch, resetServerFilters]);

  // Re-run the search when the SERVER-SIDE filters (brand / category) change, so
  // the filter applies across the whole catalog instead of only the loaded pages.
  // A mount guard prevents a duplicate search on initial load (the q-from-URL
  // effect already kicks off the first search synchronously).
  const backendBrandsKey = filters.brands.join("|");
  const backendCategoriesKey = filters.categories.join("|");
  const serverFiltersInitRef = useRef(false);
  useEffect(() => {
    if (!serverFiltersInitRef.current) {
      serverFiltersInitRef.current = true;
      return;
    }
    // Skip the re-search caused by resetServerFilters() on a new term — the term
    // handler already kicked off the search with the cleared filters.
    if (skipNextServerFilterSearchRef.current) {
      skipNextServerFilterSearchRef.current = false;
      return;
    }
    if (currentSearchTermRef.current) {
      handleSearch(currentSearchTermRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendBrandsKey, backendCategoriesKey]);

  // Calculate actual price range from accumulated groups
  const priceRange = useMemo(() => {
    if (!accumulatedGroups.length) return { min: 0, max: 50000 };
    const allPrices = accumulatedGroups.flatMap(g => g.products.map(p => p.price));
    if (allPrices.length === 0) return { min: 0, max: 50000 };
    return {
      min: Math.floor(Math.min(...allPrices) / 100) * 100,
      max: Math.ceil(Math.max(...allPrices) / 100) * 100,
    };
  }, [accumulatedGroups]);

  const filteredGroups = useMemo(() => {
    if (!accumulatedGroups.length) return [];

    let groups = [...accumulatedGroups];

    // Brand + category are filtered SERVER-SIDE (see backendFiltersRef); the
    // accumulated groups are already restricted to them. Remaining filters below
    // are applied client-side over the loaded pages.

    if (filters.vendors.length > 0) {
      groups = groups.filter(group =>
        group.products.some(p => filters.vendors.includes(p.vendor_name))
      );
    }

    if (filters.minPrice > priceRange.min || filters.maxPrice < priceRange.max) {
      groups = groups.filter(group => {
        const minGroupPrice = Math.min(...group.products.map(p => p.price));
        const maxGroupPrice = Math.max(...group.products.map(p => p.price));
        return maxGroupPrice >= filters.minPrice && minGroupPrice <= filters.maxPrice;
      });
    }

    if (filters.dosages.length > 0) {
      groups = groups.filter(group =>
        group.products.some(p => filters.dosages.includes(p.dosage_unit || ''))
      );
    }

    if (filters.forms.length > 0) {
      groups = groups.filter(group =>
        group.products.some(p => filters.forms.includes((p.form || "").trim()))
      );
    }

    if (filters.quantities.length > 0) {
      groups = groups.filter(group =>
        group.products.some((p) => {
          const quantity = p.quantity ? String(p.quantity) : "";
          return filters.quantities.includes(quantity);
        })
      );
    }

    return groups;
  }, [accumulatedGroups, filters, priceRange]);

  const displayProducts = useMemo(() => {
    if (filters.groupSimilar) {
      return filteredGroups.flatMap((group) => convertProductGroupToProducts(group));
    }

    return filteredGroups.flatMap((group) =>
      group.products.map((product) => convertBackendProductToProduct(product, group))
    );
  }, [filteredGroups, filters.groupSimilar]);

  const hasActiveFilters = filters.minPrice > priceRange.min ||
    filters.maxPrice < priceRange.max ||
    filters.categories.length > 0 ||
    filters.brands.length > 0 ||
    filters.vendors.length > 0 ||
    filters.dosages.length > 0 ||
    filters.quantities.length > 0 ||
    filters.forms.length > 0;

  const activeFilterCount =
    filters.categories.length +
    filters.brands.length +
    filters.vendors.length +
    filters.dosages.length +
    filters.quantities.length +
    filters.forms.length +
    (filters.minPrice > priceRange.min || filters.maxPrice < priceRange.max ? 1 : 0);

  return (
    <div className="min-h-screen flex flex-col bg-health-gray dark:bg-gray-900 transition-colors duration-200">
      <Navbar />

      <main className="flex-grow container mx-auto px-4 py-8">
        {!searchTerm && <HeroSection />}

        <section>
          <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 dark:text-gray-100 break-words">
              {searchTerm ? `Rezultati za "${searchTerm}"` : "Popularni proizvodi"}
            </h2>
            {useApiSearch && (
              <Button
                variant="outline"
                size="sm"
                className="lg:hidden"
                onClick={() => setShowMobileFilters(true)}
              >
                <Filter className="h-4 w-4 mr-2" />
                Filteri
                {hasActiveFilters && (
                  <span className="ml-2 bg-health-primary text-white text-xs px-1.5 py-0.5 rounded-full">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            )}
          </div>

          {useApiSearch && (
            <>
              <ResultsToolbar
                groupSimilar={filters.groupSimilar}
                onGroupSimilarChange={(value) => setFilters(prev => ({ ...prev, groupSimilar: value }))}
                totalGroups={totalGroups}
                totalProducts={totalProducts}
                loadedGroups={accumulatedGroups.length}
                className="mb-4"
              />
              <FilterChips
                filters={filters}
                onFiltersChange={setFilters}
                facets={facets}
                className="mb-4"
              />
            </>
          )}

          {useApiSearch ? (
            <div className="flex gap-6">
              <aside className="hidden lg:block w-64 flex-shrink-0">
                <div className="sticky top-4">
                  <FilterSidebar
                    filters={filters}
                    onFiltersChange={setFilters}
                    facets={facets}
                    priceRange={priceRange}
                  />
                </div>
              </aside>

              <div className="flex-1 min-w-0">
                {isSearching ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <Spinner size="xl" text="Pretraživanje proizvoda..." />
                    <p className="mt-4 text-gray-600 dark:text-gray-400 text-center max-w-md">
                      Pretražujemo bazu proizvoda i pronalazimo najbolje rezultate za vašu pretragu
                    </p>
                  </div>
                ) : searchError ? (
                  <div className="text-center py-12">
                    <p className="text-lg text-red-600">Greška pri pretraživanju</p>
                    <p className="text-sm text-red-500 mt-2">{searchError}</p>
                  </div>
                ) : displayProducts.length > 0 ? (
                  <>
                    <ProductList products={displayProducts} />
                    {/* Infinite scroll trigger */}
                    <div ref={loadMoreRef} className="h-10" />
                    {isLoadingMore && (
                      <div className="flex justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-health-primary" />
                        <span className="ml-2 text-gray-600 dark:text-gray-400">Učitavanje više proizvoda...</span>
                      </div>
                    )}
                    {!hasMore && accumulatedGroups.length > 0 && (
                      <div className="text-center py-6 text-gray-500 dark:text-gray-400">
                        Prikazano {displayProducts.length} {filters.groupSimilar ? "grupa" : "ponuda"}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-lg text-gray-600 dark:text-gray-400">
                      {hasActiveFilters ? "Nema rezultata sa ovim filterima" : "Nema rezultata za vašu pretragu"}
                    </p>
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-500">
                      {hasActiveFilters ? "Pokušajte da uklonite neke filtere" : "Pokušajte sa drugačijim ključnim rečima"}
                    </p>
                    {hasActiveFilters && (
                      <Button
                        variant="outline"
                        className="mt-4"
                        onClick={() => setFilters(defaultFilters)}
                      >
                        Obriši sve filtere
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {isLoadingFeatured ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Spinner size="lg" text="Učitavanje popularnih proizvoda..." />
                </div>
              ) : (
                featuredProducts?.groups && (
                  <ProductList
                    products={featuredProducts.groups.flatMap(group => convertProductGroupToProducts(group))}
                  />
                )
              )}
            </>
          )}
        </section>
      </main>

      {showMobileFilters && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50 animate-in fade-in duration-200"
            onClick={() => setShowMobileFilters(false)}
          />
          <div className="absolute right-0 top-0 h-full w-full max-w-[400px] bg-white dark:bg-gray-900 overflow-y-auto shadow-xl animate-in slide-in-from-right duration-300">
            <div className="p-4">
              <FilterSidebar
                filters={filters}
                onFiltersChange={setFilters}
                facets={facets}
                priceRange={priceRange}
                onClose={() => setShowMobileFilters(false)}
                className="border-0"
              />
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}
