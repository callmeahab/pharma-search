"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import ProductList from "@/components/ProductList";
import { searchGroupsStreaming, fetchGroupsPage, getFeaturedProducts, SearchResult, StreamingSearchResult } from "@/lib/api";
import { convertProductGroupToProducts, ProductGroup, BackendProduct, groupProductsByKey } from "@/types/product";
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

  // Load grouping preferences from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(GROUPING_PREFS_KEY);
      if (saved) {
        const prefs = JSON.parse(saved);
        setFilters(prev => ({
          ...prev,
          groupSimilar: prefs.groupSimilar ?? prev.groupSimilar,
          groupingMode: prefs.groupingMode ?? prev.groupingMode,
          sortGroupsBy: prefs.sortGroupsBy ?? prev.sortGroupsBy,
        }));
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Save grouping preferences to localStorage when they change
  useEffect(() => {
    try {
      const prefs = {
        groupSimilar: filters.groupSimilar,
        groupingMode: filters.groupingMode,
        sortGroupsBy: filters.sortGroupsBy,
      };
      localStorage.setItem(GROUPING_PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Ignore localStorage errors
    }
  }, [filters.groupSimilar, filters.groupingMode, filters.sortGroupsBy]);

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
      }, { offset: 0, limit: PAGE_SIZE });
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
    try {
      const result = await fetchGroupsPage(
        currentSearchTermRef.current,
        currentOffset,
        PAGE_SIZE
      );

      if (result.groups.length > 0) {
        setAccumulatedGroups(prev => [...prev, ...result.groups]);
        setCurrentOffset(prev => prev + result.groups.length);
        setHasMore(currentOffset + result.groups.length < result.totalGroups);

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
      handleSearch(urlSearchTerm);
    } else {
      loadFeaturedProducts();
    }
  }, [handleSearch, loadFeaturedProducts]);

  useEffect(() => {
    const handleUrlSearchChanged = (event: CustomEvent) => {
      const { searchTerm: newSearchTerm } = event.detail;
      if (newSearchTerm !== searchTerm) {
        setSearchTerm(newSearchTerm);
        setUseApiSearch(true);
        handleSearch(newSearchTerm);
      }
    };

    window.addEventListener("urlSearchChanged", handleUrlSearchChanged as EventListener);
    return () => {
      window.removeEventListener("urlSearchChanged", handleUrlSearchChanged as EventListener);
    };
  }, [searchTerm, handleSearch]);

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

  // Re-group products based on the selected grouping mode
  const regroupedData = useMemo(() => {
    if (!accumulatedGroups.length) return [];

    // Extract all products from accumulated groups
    const allProducts: BackendProduct[] = accumulatedGroups.flatMap(g => g.products);

    // Re-group based on the selected grouping mode
    return groupProductsByKey(allProducts, filters.groupingMode);
  }, [accumulatedGroups, filters.groupingMode]);

  const filteredAndSortedGroups = useMemo(() => {
    if (!regroupedData.length) return [];

    let groups = [...regroupedData];

    if (filters.brands.length > 0) {
      groups = groups.filter(group =>
        group.products.some(p => filters.brands.includes(p.brand_name || ''))
      );
    }

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

    // Sort groups
    switch (filters.sortGroupsBy) {
      case "price_asc":
        groups.sort((a, b) => a.price_range.min - b.price_range.min);
        break;
      case "price_desc":
        groups.sort((a, b) => b.price_range.min - a.price_range.min);
        break;
      case "savings":
        groups.sort((a, b) => {
          const savingsA = a.price_range.max > 0 ? (a.price_range.max - a.price_range.min) / a.price_range.max : 0;
          const savingsB = b.price_range.max > 0 ? (b.price_range.max - b.price_range.min) / b.price_range.max : 0;
          return savingsB - savingsA;
        });
        break;
      case "vendors":
        groups.sort((a, b) => b.vendor_count - a.vendor_count);
        break;
      case "products":
        groups.sort((a, b) => (b.product_count || 0) - (a.product_count || 0));
        break;
      default:
        // relevance - keep original order from search
        break;
    }

    // Sort products within each group
    if (filters.sortBy !== "relevance") {
      groups = groups.map(group => {
        const sortedProducts = [...group.products];
        switch (filters.sortBy) {
          case "price_asc":
            sortedProducts.sort((a, b) => a.price - b.price);
            break;
          case "price_desc":
            sortedProducts.sort((a, b) => b.price - a.price);
            break;
          case "vendors":
            // Products don't have vendor count, keep price order
            sortedProducts.sort((a, b) => a.price - b.price);
            break;
          default:
            break;
        }
        return { ...group, products: sortedProducts };
      });
    }

    return groups;
  }, [regroupedData, filters, priceRange]);

  const displayGroups = filters.groupSimilar
    ? filteredAndSortedGroups
    : filteredAndSortedGroups.flatMap((g, groupIdx) =>
        g.products.map((p, productIdx) => ({
          ...g,
          // Use combination of indices and vendor to guarantee uniqueness
          id: `${p.id}-${p.vendor_id}-${groupIdx}-${productIdx}`,
          products: [p],
          vendor_count: 1,
          product_count: 1,
          price_range: { min: p.price, max: p.price, avg: p.price }
        } as ProductGroup))
      );

  // Count actual products within all groups, not the converted display products
  const totalProductsShown = displayGroups.reduce((sum, group) => sum + group.products.length, 0);

  const hasActiveFilters = filters.minPrice > priceRange.min ||
    filters.maxPrice < priceRange.max ||
    filters.brands.length > 0 ||
    filters.vendors.length > 0 ||
    filters.dosages.length > 0 ||
    filters.quantities.length > 0;

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
                    {filters.brands.length + filters.vendors.length + filters.dosages.length +
                     (filters.minPrice > 0 || filters.maxPrice < 50000 ? 1 : 0)}
                  </span>
                )}
              </Button>
            )}
          </div>

          {useApiSearch && (
            <>
              <ResultsToolbar
                groupSimilar={filters.groupSimilar}
                groupingMode={filters.groupingMode}
                sortGroupsBy={filters.sortGroupsBy}
                onGroupSimilarChange={(value) => setFilters(prev => ({ ...prev, groupSimilar: value }))}
                onGroupingModeChange={(value) => setFilters(prev => ({ ...prev, groupingMode: value }))}
                onSortGroupsByChange={(value) => setFilters(prev => ({ ...prev, sortGroupsBy: value }))}
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
                ) : displayGroups.length > 0 ? (
                  <>
                    <ProductList
                      products={displayGroups.flatMap(group => convertProductGroupToProducts(group))}
                    />
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
                        Prikazano svih {totalGroups} grupa proizvoda
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
