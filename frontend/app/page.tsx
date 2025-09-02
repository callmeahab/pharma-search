"use client";

import React, { useState, useEffect } from "react";
import { useWishlist } from "@/contexts/WishlistContext";
import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import ProductList from "@/components/ProductList";
import FlatSearchResults from "@/components/FlatSearchResults";
import { searchProducts, getFeaturedProducts, SearchResult } from "@/lib/api";
import { convertProductGroupToProducts } from "@/types/product";
import { Spinner } from "@/components/ui/spinner";
import { SpinnerInline } from "@/components/ui/spinner";
import Footer from "@/components/Footer";

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const { wishlist } = useWishlist();

  const [searchTerm, setSearchTerm] = useState("");

  // API search state
  const [apiSearchResults, setApiSearchResults] = useState<SearchResult | null>(
    null
  );
  const [featuredProducts, setFeaturedProducts] = useState<SearchResult | null>(
    null
  );
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingFeatured, setIsLoadingFeatured] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [useApiSearch, setUseApiSearch] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const itemsPerPage = 50;

  // Load featured products when no search is active
  const loadFeaturedProducts = async () => {
    setIsLoadingFeatured(true);
    try {
      const featured = await getFeaturedProducts({ limit: 24 });
      
      // Handle both new flat structure and legacy grouped structure
      if (featured && typeof featured === 'object') {
        if (featured.products || featured.groups) {
          setFeaturedProducts(featured);
        } else {
          setFeaturedProducts({ groups: [], total: 0, offset: 0, limit: 24 });
        }
      } else {
        setFeaturedProducts({ groups: [], total: 0, offset: 0, limit: 24 });
      }
    } catch (error) {
      console.error("Failed to load featured products:", error);
      setFeaturedProducts({ groups: [], total: 0, offset: 0, limit: 24 });
    } finally {
      setIsLoadingFeatured(false);
    }
  };

  // Process URL search parameter on load
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
  }, []);

  // Listen for URL search changes from other components
  useEffect(() => {
    const handleUrlSearchChanged = (event: CustomEvent) => {
      const { searchTerm: newSearchTerm } = event.detail;
      if (newSearchTerm !== searchTerm) {
        setSearchTerm(newSearchTerm);
        setUseApiSearch(true);
        handleSearch(newSearchTerm);
      }
    };

    window.addEventListener(
      "urlSearchChanged",
      handleUrlSearchChanged as EventListener
    );

    return () => {
      window.removeEventListener(
        "urlSearchChanged",
        handleUrlSearchChanged as EventListener
      );
    };
  }, [searchTerm]);

  const handleSearch = async (term: string, forceRefresh: boolean = false) => {
    if (!term || !term.trim()) {
      setApiSearchResults(null);
      setUseApiSearch(false);
      setSearchError(null);
      setSearchTerm("");
      // Update URL to remove search parameter
      const url = new URL(window.location.href);
      url.searchParams.delete('q');
      window.history.pushState({}, '', url.toString());
      loadFeaturedProducts();
      return;
    }

    const trimmedTerm = term.trim();
    
    // Skip if same search and not forced refresh
    if (trimmedTerm === searchTerm && apiSearchResults && !forceRefresh) {
      return;
    }
    
    setIsSearching(true);
    setSearchError(null);
    setCurrentPage(1);
    setSearchTerm(trimmedTerm);
    
    // Clear existing results immediately for better UX
    setApiSearchResults(null);
    
    // Update URL with search parameter
    const url = new URL(window.location.href);
    url.searchParams.set('q', trimmedTerm);
    window.history.pushState({}, '', url.toString());

    try {
      const results = await searchProducts(trimmedTerm, { limit: itemsPerPage });
      setApiSearchResults(results);
      setUseApiSearch(true);
    } catch (error) {
      console.error("Search error:", error);
      setSearchError("Greška pri pretraživanju. Pokušajte ponovo.");
      setApiSearchResults(null);
    } finally {
      setIsSearching(false);
    }
  };

  const handleLoadMore = async () => {
    if (!apiSearchResults || !hasMoreResults) return;

    setIsLoadingMore(true);
    try {
      const nextPage = currentPage + 1;
      const offset = (nextPage - 1) * itemsPerPage;

      const moreResults = await searchProducts(searchTerm, {
        limit: itemsPerPage,
        offset,
      });

      // Merge new results with existing ones
      if (moreResults.products && apiSearchResults.products) {
        setApiSearchResults({
          ...moreResults,
          products: [...apiSearchResults.products, ...moreResults.products],
          offset: 0, // Reset offset since we're merging
        });
      } else if (moreResults.groups && apiSearchResults.groups) {
        setApiSearchResults({
          ...moreResults,
          groups: [...apiSearchResults.groups, ...moreResults.groups],
          offset: 0, // Reset offset since we're merging
        });
      }

      setCurrentPage(nextPage);
    } catch (error) {
      console.error("Load more error:", error);
      setSearchError("Greška pri učitavanju dodatnih rezultata.");
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Calculate if there are more results to load
  const hasMoreResults = apiSearchResults && (
    apiSearchResults.products 
      ? apiSearchResults.total > apiSearchResults.products.length
      : apiSearchResults.groups && apiSearchResults.total > apiSearchResults.groups.length
  );

  const totalProductsShown = apiSearchResults
    ? (apiSearchResults.products 
        ? apiSearchResults.products.length
        : apiSearchResults.groups?.flatMap((group) =>
            convertProductGroupToProducts(group)
          ).length || 0
      )
    : 0;

  return (
    <div className="min-h-screen flex flex-col bg-health-gray dark:bg-gray-900 transition-colors duration-200">
      <Navbar />

      <main className="flex-grow container mx-auto px-4 py-8">
        {!searchTerm && <HeroSection />}

        <section>
          <div className="mb-6 flex justify-between items-center">
            <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">
              {searchTerm
                ? `Rezultati za "${searchTerm}"`
                : "Popularni proizvodi"}
            </h2>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {useApiSearch && apiSearchResults ? (
                <>
                  <span>{totalProductsShown} proizvoda prikazano</span>
                  {apiSearchResults.total > totalProductsShown && (
                    <span> od ukupno {apiSearchResults.total}</span>
                  )}
                  {apiSearchResults.search_type_used && (
                    <span className="ml-2 text-xs">
                      (
                      {apiSearchResults.search_type_used === "database"
                        ? "exact"
                        : "smart"}{" "}
                      search)
                    </span>
                  )}
                </>
              ) : featuredProducts ? (
                `${(featuredProducts.products?.length || 
                   featuredProducts.groups?.flatMap((group) =>
                     convertProductGroupToProducts(group)
                   ).length || 0)
                } proizvoda pronađeno`
              ) : (
                ""
              )}
            </div>
          </div>

          {useApiSearch ? (
            isSearching && !isLoadingMore ? (
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
            ) : apiSearchResults && (apiSearchResults.products?.length || apiSearchResults.groups?.length) ? (
              <>
                {apiSearchResults.products ? (
                  <FlatSearchResults
                    products={apiSearchResults.products}
                    total={apiSearchResults.total}
                    loading={false}
                    onSearch={handleSearch}
                  />
                ) : apiSearchResults.groups ? (
                  <ProductList
                    products={apiSearchResults.groups.flatMap((group) =>
                      convertProductGroupToProducts(group)
                    )}
                  />
                ) : null}

                {/* Load More Button */}
                {hasMoreResults && (
                  <div className="mt-8 text-center">
                    <button
                      onClick={handleLoadMore}
                      disabled={isLoadingMore}
                      className="px-6 py-3 bg-health-blue text-white rounded-md hover:bg-health-purple transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isLoadingMore ? (
                        <SpinnerInline size="sm" text="Učitavanje..." />
                      ) : (
                        `Učitaj još (${apiSearchResults.total - totalProductsShown
                        } preostalo)`
                      )}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12">
                <p className="text-lg text-gray-600 dark:text-gray-400">
                  Nema rezultata za vašu pretragu
                </p>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-500">
                  Pokušajte sa drugačijim ključnim rečima
                </p>
              </div>
            )
          ) : (
            <>
              {isLoadingFeatured ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Spinner size="lg" text="Učitavanje popularnih proizvoda..." />
                </div>
              ) : (
                featuredProducts && (
                  featuredProducts.products ? (
                    <FlatSearchResults
                      products={featuredProducts.products}
                      total={featuredProducts.total}
                      loading={false}
                      onSearch={handleSearch}
                    />
                  ) : featuredProducts.groups ? (
                    <ProductList
                      products={featuredProducts.groups.flatMap((group) =>
                        convertProductGroupToProducts(group)
                      )}
                    />
                  ) : null
                )
              )}
            </>
          )}
        </section>
      </main>

      <Footer />
    </div>
  );
}
