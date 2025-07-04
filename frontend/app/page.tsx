"use client";

import React, { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Navbar from "../components/Navbar";
import ProductList from "../components/ProductList";
import SearchResults from "../components/SearchResults";
import Footer from "../components/Footer";
import CategoryFilter from "../components/CategoryFilter";
import { trackSearch } from "../utils/analytics";
import { useWishlist } from "../contexts/WishlistContext";
import { initPriceChecking } from "../utils/priceNotifications";
import HeroSection from "../components/HeroSection";
import {
  searchProducts,
  searchAllProducts,
  getFeaturedProducts,
} from "../lib/api";
import {
  SearchResult,
  ProductGroup,
  convertProductGroupToProducts,
  Product,
} from "../types/product";

export default function HomePage() {
  const searchParams = useSearchParams();
  const urlSearchTerm = searchParams?.get("search") || "";
  const { wishlist } = useWishlist();

  const [searchTerm, setSearchTerm] = useState(urlSearchTerm);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

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
      setFeaturedProducts(featured);
    } catch (error) {
      console.error("Failed to load featured products:", error);
      setFeaturedProducts({ groups: [], total: 0, offset: 0, limit: 24 });
    } finally {
      setIsLoadingFeatured(false);
    }
  };

  // Process URL search parameter on load and when it changes
  useEffect(() => {
    console.log("URL search param changed:", urlSearchTerm);
    setSearchTerm(urlSearchTerm);
    setCurrentPage(1); // Reset to first page on new search

    if (urlSearchTerm && urlSearchTerm.trim()) {
      // Use API search for actual queries
      performApiSearch(urlSearchTerm);
    } else {
      // Load featured products for browsing/no search
      setUseApiSearch(false);
      setApiSearchResults(null);
      loadFeaturedProducts();
    }

    // Track search from URL parameter if it exists
    if (urlSearchTerm) {
      trackSearch(urlSearchTerm, 0); // Will be updated when results come in
    }
  }, [urlSearchTerm, selectedCategory]);

  // Check for price changes when the component loads and when wishlist changes
  useEffect(() => {
    const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
    if (isLoggedIn && wishlist.length > 0) {
      initPriceChecking(wishlist, []);
    }
  }, [wishlist]);

  // API search function with pagination support
  const performApiSearch = async (query: string, loadMore: boolean = false) => {
    if (!query.trim()) return;

    if (!loadMore) {
      setIsSearching(true);
      setCurrentPage(1);
    } else {
      setIsLoadingMore(true);
    }

    setSearchError(null);
    setUseApiSearch(true);

    try {
      console.log(
        "Performing API search for:",
        query,
        "Page:",
        loadMore ? currentPage + 1 : 1
      );

      // Let the backend decide the best search type
      const searchType = "auto";

      const results = await searchProducts(query, {
        limit: itemsPerPage,
        offset: loadMore ? currentPage * itemsPerPage : 0,
        searchType: searchType,
      });

      console.log("API search results:", results);
      console.log("Search type used:", results.search_type_used);

      if (loadMore && apiSearchResults) {
        // Append new results to existing ones
        setApiSearchResults({
          ...results,
          groups: [...apiSearchResults.groups, ...results.groups],
          offset: 0,
          limit: apiSearchResults.groups.length + results.groups.length,
        });
        setCurrentPage(currentPage + 1);
      } else {
        setApiSearchResults(results);
      }

      // Track search with actual result count
      if (!loadMore) {
        trackSearch(query, results.total);
      }
    } catch (error) {
      console.error("API search error:", error);
      setSearchError(
        error instanceof Error ? error.message : "Pretraga nije uspešna"
      );

      // Fallback to featured products when search fails
      if (!loadMore) {
        setUseApiSearch(false);
        setApiSearchResults(null);
        loadFeaturedProducts();
      }
    } finally {
      setIsSearching(false);
      setIsLoadingMore(false);
    }
  };

  // Load more results
  const handleLoadMore = () => {
    if (searchTerm || selectedCategory) {
      performApiSearch(searchTerm || selectedCategory || "", true);
    }
  };

  // Listen for custom URL change events
  useEffect(() => {
    const handleUrlSearchChanged = (event: CustomEvent<{ term: string }>) => {
      const term = event.detail.term;
      setSearchTerm(term);
      setCurrentPage(1); // Reset pagination

      if (term && term.trim()) {
        // Use API search for actual queries
        performApiSearch(term);
      } else {
        // Load featured products for browsing/no search
        setUseApiSearch(false);
        setApiSearchResults(null);
        loadFeaturedProducts();
      }
    };

    // Add event listener
    window.addEventListener(
      "urlSearchChanged",
      handleUrlSearchChanged as EventListener
    );

    // Cleanup
    return () => {
      window.removeEventListener(
        "urlSearchChanged",
        handleUrlSearchChanged as EventListener
      );
    };
  }, [selectedCategory]);

  const handleCategorySelect = (category: string | null) => {
    setSelectedCategory(category);
    setCurrentPage(1); // Reset pagination

    if (category) {
      // Perform API search for the selected category
      performApiSearch(category);

      // Track category filter as a search
      trackSearch(
        `Category: ${category}${searchTerm ? ` with term: ${searchTerm}` : ""}`,
        0 // Will be updated when results come in
      );
    } else {
      // If no category selected, either show search results or featured products
      if (searchTerm && searchTerm.trim()) {
        performApiSearch(searchTerm);
      } else {
        setUseApiSearch(false);
        setApiSearchResults(null);
        loadFeaturedProducts();
      }
    }
  };

  // Calculate if there are more results to load
  const hasMoreResults =
    apiSearchResults && apiSearchResults.total > apiSearchResults.groups.length;

  const totalProductsShown = apiSearchResults
    ? apiSearchResults.groups.flatMap((group) =>
        convertProductGroupToProducts(group)
      ).length
    : 0;

  return (
    <div className="min-h-screen flex flex-col bg-health-gray dark:bg-gray-900 transition-colors duration-200">
      <Navbar />

      <main className="flex-grow container mx-auto px-4 py-8">
        {!searchTerm && <HeroSection />}

        <section className="mb-8">
          <CategoryFilter
            onSelectCategory={handleCategorySelect}
            selectedCategory={selectedCategory}
          />
        </section>

        <section>
          <div className="mb-6 flex justify-between items-center">
            <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">
              {searchTerm
                ? `Rezultati za "${searchTerm}"`
                : selectedCategory
                ? `${selectedCategory} proizvodi`
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
                `${
                  featuredProducts.groups.flatMap((group) =>
                    convertProductGroupToProducts(group)
                  ).length
                } proizvoda pronađeno`
              ) : (
                ""
              )}
            </div>
          </div>

          {useApiSearch ? (
            isSearching && !isLoadingMore ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="bg-gray-200 dark:bg-gray-700 rounded-lg h-64"></div>
                  </div>
                ))}
              </div>
            ) : searchError ? (
              <div className="text-center py-12">
                <p className="text-lg text-red-600">Greška pri pretraživanju</p>
                <p className="text-sm text-red-500 mt-2">{searchError}</p>
              </div>
            ) : apiSearchResults && apiSearchResults.groups.length > 0 ? (
              <>
                <ProductList
                  products={apiSearchResults.groups.flatMap((group) =>
                    convertProductGroupToProducts(group)
                  )}
                />

                {/* Load More Button */}
                {hasMoreResults && (
                  <div className="mt-8 text-center">
                    <button
                      onClick={handleLoadMore}
                      disabled={isLoadingMore}
                      className="px-6 py-3 bg-health-blue text-white rounded-md hover:bg-health-purple transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isLoadingMore ? (
                        <span className="flex items-center">
                          <svg
                            className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            ></circle>
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            ></path>
                          </svg>
                          Učitavanje...
                        </span>
                      ) : (
                        `Učitaj još (${
                          apiSearchResults.total - totalProductsShown
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
                <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
                  Pokušajte sa drugačijim ključnim rečima
                </p>
              </div>
            )
          ) : isLoadingFeatured ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="animate-pulse">
                  <div className="bg-gray-200 dark:bg-gray-700 rounded-lg h-64"></div>
                </div>
              ))}
            </div>
          ) : featuredProducts && featuredProducts.groups.length > 0 ? (
            <ProductList
              products={featuredProducts.groups.flatMap((group) =>
                convertProductGroupToProducts(group)
              )}
            />
          ) : (
            <div className="text-center py-12">
              <p className="text-lg text-gray-600 dark:text-gray-400">
                Trenutno nema dostupnih proizvoda
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
                Molimo pokušajte kasnije
              </p>
            </div>
          )}
        </section>
      </main>

      <Footer />
    </div>
  );
}
