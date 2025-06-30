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
import { searchProducts, getFeaturedProducts } from "../lib/api";
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

  // Load featured products when no search is active
  const loadFeaturedProducts = async () => {
    setIsLoadingFeatured(true);
    try {
      const featured = await getFeaturedProducts({ limit: 12 });
      setFeaturedProducts(featured);
    } catch (error) {
      console.error("Failed to load featured products:", error);
      setFeaturedProducts({ groups: [], total: 0, offset: 0, limit: 12 });
    } finally {
      setIsLoadingFeatured(false);
    }
  };

  // Process URL search parameter on load and when it changes
  useEffect(() => {
    console.log("URL search param changed:", urlSearchTerm);
    setSearchTerm(urlSearchTerm);

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

  // API search function
  const performApiSearch = async (query: string) => {
    if (!query.trim()) return;

    setIsSearching(true);
    setSearchError(null);
    setUseApiSearch(true);

    try {
      console.log("Performing API search for:", query);
      const results = await searchProducts(query, { limit: 20 });
      console.log("API search results:", results);

      setApiSearchResults(results);

      // Track search with actual result count
      trackSearch(query, results.total);
    } catch (error) {
      console.error("API search error:", error);
      setSearchError(
        error instanceof Error ? error.message : "Pretraga nije uspešna"
      );

      // Fallback to featured products when search fails
      setUseApiSearch(false);
      setApiSearchResults(null);
      loadFeaturedProducts();
    } finally {
      setIsSearching(false);
    }
  };

  // Listen for custom URL change events
  useEffect(() => {
    const handleUrlSearchChanged = (event: CustomEvent<{ term: string }>) => {
      const term = event.detail.term;
      setSearchTerm(term);

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

  // Removed filterProducts function as we now use API for all data

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
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {useApiSearch && apiSearchResults
                ? `${
                    apiSearchResults.groups.flatMap((group) =>
                      convertProductGroupToProducts(group)
                    ).length
                  } proizvoda pronađeno`
                : featuredProducts
                ? `${
                    featuredProducts.groups.flatMap((group) =>
                      convertProductGroupToProducts(group)
                    ).length
                  } proizvoda pronađeno`
                : ""}
            </p>
          </div>

          {useApiSearch ? (
            isSearching ? (
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
              <ProductList
                products={apiSearchResults.groups.flatMap((group) =>
                  convertProductGroupToProducts(group)
                )}
              />
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
