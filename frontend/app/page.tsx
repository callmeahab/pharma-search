"use client";

import React, { useState, useEffect } from "react";
import { useWishlist } from "@/contexts/WishlistContext";
import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import ProductList from "@/components/ProductList";
import { searchProducts, getFeaturedProducts, SearchResult } from "@/lib/api";
import { convertProductGroupToProducts } from "@/types/product";
import { Spinner } from "@/components/ui/spinner";
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

  // With frontend grouping, we fetch all products at once (up to 1000)
  // No pagination state needed

  // Load featured products when no search is active
  const loadFeaturedProducts = async () => {
    setIsLoadingFeatured(true);
    try {
      const featured = await getFeaturedProducts({ limit: 24 });
      
      // Ensure the response has the expected structure
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

  const handleSearch = async (term: string) => {
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
      // Don't specify limit - backend defaults to 1000 products, frontend groups them
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
  };

  // With frontend grouping, we fetch all products at once (up to 1000)
  // No pagination needed - all groups are available immediately

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
              ) : featuredProducts && featuredProducts.groups ? (
                `${featuredProducts.groups.flatMap((group) =>
                  convertProductGroupToProducts(group)
                ).length
                } proizvoda pronađeno`
              ) : (
                ""
              )}
            </div>
          </div>

          {useApiSearch ? (
            isSearching ? (
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
                featuredProducts && featuredProducts.groups && (
                  <ProductList
                    products={featuredProducts.groups.flatMap((group) =>
                      convertProductGroupToProducts(group)
                    )}
                  />
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
