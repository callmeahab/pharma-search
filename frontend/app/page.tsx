"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import ProductList from "@/components/ProductList";
import { searchProducts, getFeaturedProducts, SearchResult } from "@/lib/api";
import { convertProductGroupToProducts, ProductGroup } from "@/types/product";
import { Spinner } from "@/components/ui/spinner";
import Footer from "@/components/Footer";
import { FilterSidebar, FilterState, defaultFilters, Facets } from "@/components/FilterSidebar";
import { FilterChips } from "@/components/FilterChips";
import { Button } from "@/components/ui/button";
import { Filter } from "lucide-react";

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [apiSearchResults, setApiSearchResults] = useState<SearchResult | null>(null);
  const [featuredProducts, setFeaturedProducts] = useState<SearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingFeatured, setIsLoadingFeatured] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [useApiSearch, setUseApiSearch] = useState(false);

  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

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
      setApiSearchResults(null);
      setUseApiSearch(false);
      setSearchError(null);
      loadFeaturedProducts();
      return;
    }

    setIsSearching(true);
    setSearchError(null);

    try {
      const results = await searchProducts(term);
      setApiSearchResults(results);
      setUseApiSearch(true);
    } catch (error) {
      console.error("Search error:", error);
      setSearchError("Greška pri pretraživanju. Pokušajte ponovo.");
      setApiSearchResults(null);
    } finally {
      setIsSearching(false);
    }
  }, [loadFeaturedProducts]);

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

  const facets: Facets | undefined = apiSearchResults?.facets as Facets | undefined;

  // Calculate actual price range from search results
  const priceRange = useMemo(() => {
    if (!apiSearchResults?.groups?.length) return { min: 0, max: 50000 };
    const allPrices = apiSearchResults.groups.flatMap(g => g.products.map(p => p.price));
    if (allPrices.length === 0) return { min: 0, max: 50000 };
    return {
      min: Math.floor(Math.min(...allPrices) / 100) * 100,
      max: Math.ceil(Math.max(...allPrices) / 100) * 100,
    };
  }, [apiSearchResults?.groups]);

  const filteredAndSortedGroups = useMemo(() => {
    if (!apiSearchResults?.groups) return [];

    let groups = [...apiSearchResults.groups];

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

    switch (filters.sortBy) {
      case "price_asc":
        groups.sort((a, b) => {
          const minA = Math.min(...a.products.map(p => p.price));
          const minB = Math.min(...b.products.map(p => p.price));
          return minA - minB;
        });
        break;
      case "price_desc":
        groups.sort((a, b) => {
          const minA = Math.min(...a.products.map(p => p.price));
          const minB = Math.min(...b.products.map(p => p.price));
          return minB - minA;
        });
        break;
      case "savings":
        groups.sort((a, b) => {
          const savingsA = a.price_range.max - a.price_range.min;
          const savingsB = b.price_range.max - b.price_range.min;
          return savingsB - savingsA;
        });
        break;
      case "vendors":
        groups.sort((a, b) => b.vendor_count - a.vendor_count);
        break;
      default:
        break;
    }

    return groups;
  }, [apiSearchResults?.groups, filters, priceRange]);

  const displayGroups = filters.groupSimilar
    ? filteredAndSortedGroups
    : filteredAndSortedGroups.flatMap(g =>
        g.products.map(p => ({
          ...g,
          id: p.id,
          products: [p],
          vendor_count: 1,
          product_count: 1,
          price_range: { min: p.price, max: p.price, avg: p.price }
        } as ProductGroup))
      );

  const totalProductsShown = displayGroups.flatMap(group =>
    convertProductGroupToProducts(group)
  ).length;

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
            <div className="flex items-center gap-4">
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
              <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                {useApiSearch && apiSearchResults ? (
                  <>
                    <span>{totalProductsShown} proizvoda</span>
                    {apiSearchResults.total > totalProductsShown && (
                      <span className="hidden sm:inline"> od ukupno {apiSearchResults.total}</span>
                    )}
                  </>
                ) : featuredProducts?.groups ? (
                  `${featuredProducts.groups.flatMap(group => convertProductGroupToProducts(group)).length} proizvoda`
                ) : ""}
              </div>
            </div>
          </div>

          {useApiSearch && (
            <FilterChips
              filters={filters}
              onFiltersChange={setFilters}
              facets={facets}
              className="mb-4"
            />
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
                  <ProductList
                    products={displayGroups.flatMap(group => convertProductGroupToProducts(group))}
                  />
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
