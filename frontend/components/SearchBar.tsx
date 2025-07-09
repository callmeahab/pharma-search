import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, X, Package, TrendingDown } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import ProductDetailModal from "./ProductDetailModal";
import { Product, ProductGroup } from "@/types/product";
import { trackSearch, trackProductClick } from "@/utils/analytics";
import { searchProducts } from "@/lib/api";
import { humanizeTitle, formatPrice } from "@/lib/utils";

interface SearchBarProps {
  onSearch: (term: string) => void;
  initialTerm?: string;
}

const SearchBar: React.FC<SearchBarProps> = ({
  onSearch,
  initialTerm = "",
}) => {
  const [searchTerm, setSearchTerm] = useState(initialTerm);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<
    Array<{ id: string; name: string; category: string; image: string }>
  >([]);
  const [searchGroups, setSearchGroups] = useState<ProductGroup[]>([]);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [hasUnsearchedChanges, setHasUnsearchedChanges] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Update search term when initialTerm changes
  useEffect(() => {
    if (initialTerm !== searchTerm) {
      setSearchTerm(initialTerm);
      setHasUnsearchedChanges(false); // Reset unsearched changes when URL changes
      if (initialTerm.trim() !== "") {
        fetchSearchGroups(initialTerm);
      }
    }
  }, [initialTerm]);

  useEffect(() => {
    // Handle clicks outside the dropdown to close it
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  // Fetch search groups from API
  const fetchSearchGroups = async (value: string) => {
    if (value.trim() === "") {
      setSearchGroups([]);
      setFilteredSuggestions([]);
      return;
    }

    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Set loading state
    setIsLoadingGroups(true);

    // Debounce API calls
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchProducts(value, { limit: 6 });
        setSearchGroups(results.groups);

        // Also keep some sample product suggestions as fallback
        // const sampleFiltered: Product[] = []
        //   .filter(
        //     (product) =>
        //       product.name.toLowerCase().includes(value.toLowerCase()) ||
        //       product.category.toLowerCase().includes(value.toLowerCase())
        //   )
        //   .map((product) => ({
        //     id: product.id,
        //     name: product.name,
        //     category: product.category,
        //     image: product.image,
        //   }));

        // setFilteredSuggestions(sampleFiltered.slice(0, 3)); // Show fewer sample suggestions
      } catch (error) {
        console.error("Error fetching search groups:", error);
        // Fallback to sample products on error
        // const filtered = sampleProducts
        //   .filter(
        //     (product) =>
        //       product.name.toLowerCase().includes(value.toLowerCase()) ||
        //       product.category.toLowerCase().includes(value.toLowerCase())
        //   )
        //   .map((product) => ({
        //     id: product.id,
        //     name: product.name,
        //     category: product.category,
        //     image: product.image,
        //   }));

        // setFilteredSuggestions(filtered.slice(0, 6));
        setSearchGroups([]);
      } finally {
        setIsLoadingGroups(false);
      }
    }, 300); // 300ms debounce
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchTerm(value);

    // Mark that there are unsearched changes
    setHasUnsearchedChanges(value !== initialTerm);

    // Real-time API search for dropdown suggestions only
    fetchSearchGroups(value);
    setIsDropdownOpen(value.trim() !== "");

    // Don't call onSearch here - only on form submit or suggestion click
  };

  const handleSuggestionClick = (suggestion: string) => {
    setSearchTerm(suggestion);
    setHasUnsearchedChanges(false);
    onSearch(suggestion);
    setIsDropdownOpen(false);
  };

  const handleProductSelect = (productId: string) => {
    const product = null;
    if (product) {
      setSelectedProduct(product);
      setShowModal(true);
      // Track product click from search
      // trackProductClick(product.id, product.name, product.category);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault(); // Prevent default form submission
    console.log("Form submitted with term:", searchTerm);
    
    // Only perform search if there's a search term
    if (searchTerm.trim()) {
      setHasUnsearchedChanges(false);
      onSearch(searchTerm);
      setIsDropdownOpen(false);
      
      // Track search when form is submitted
      trackSearch(searchTerm, 0); // Will be updated when results come in
    }
  };

  const clearSearch = () => {
    setSearchTerm("");
    setHasUnsearchedChanges(false);
    setIsDropdownOpen(false);
    setFilteredSuggestions([]);
    setSearchGroups([]);
    setIsLoadingGroups(false);
    // Clear any pending timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    onSearch(""); // Call onSearch with empty string to reset grid results
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handlePopularSearchClick = (e: React.MouseEvent, term: string) => {
    e.preventDefault(); // Prevent any default behavior
    setSearchTerm(term);
    setHasUnsearchedChanges(false);
    fetchSearchGroups(term);
    setIsDropdownOpen(true);
    onSearch(term); // Trigger grid search for popular searches

    // Track popular search click
    trackSearch(term, 0); // Will be updated when API results come in
  };

  return (
    <div className="w-full relative" ref={dropdownRef}>
      <form onSubmit={handleSubmit} className="relative">
        <div className="flex relative">
          <div className="relative flex-grow">
            <Input
              ref={inputRef}
              type="text"
              placeholder="Pretraži vitamine, suplemente, lekove..."
              value={searchTerm}
              onChange={handleInputChange}
              onFocus={() =>
                searchTerm.trim() !== "" && setIsDropdownOpen(true)
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              className="w-full pr-12 rounded-r-none h-14 text-lg border-r-0 focus-visible:ring-health-primary dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100 dark:placeholder:text-gray-400"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  clearSearch();
                }}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                aria-label="Clear search"
              >
                <X size={20} />
              </button>
            )}
          </div>
          <Button
            type="submit"
            className={`h-14 px-6 rounded-l-none bg-health-primary hover:bg-health-secondary dark:bg-health-secondary dark:hover:bg-health-primary ${
              hasUnsearchedChanges ? 'ring-2 ring-health-secondary ring-opacity-50' : ''
            }`}
          >
            <Search className="mr-2 h-5 w-5" />
            <span className="text-base">Pretraži</span>
            {hasUnsearchedChanges && (
              <span className="ml-1 w-2 h-2 bg-health-secondary rounded-full"></span>
            )}
          </Button>
        </div>
      </form>

      {/* Dropdown for search suggestions */}
      {isDropdownOpen &&
        (searchGroups.length > 0 ||
          filteredSuggestions.length > 0 ||
          isLoadingGroups) && (
          <div className="absolute z-10 w-full mt-1 bg-white rounded-md shadow-lg max-h-80 overflow-auto dark:bg-gray-800 dark:border dark:border-gray-700">
            {isLoadingGroups && (
              <div className="px-4 py-3 text-center text-gray-500 dark:text-gray-400">
                <div className="animate-pulse">Pretraživanje...</div>
              </div>
            )}

            {/* Search Groups from API */}
            {searchGroups.length > 0 && (
              <div>
                <div className="px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700">
                  PROIZVODI
                </div>
                <ul className="py-1">
                  {searchGroups.map((group) => (
                    <li
                      key={group.id}
                      onClick={() => {
                        handleSuggestionClick(
                          humanizeTitle(group.normalized_name)
                        );
                      }}
                      className="px-4 py-3 hover:bg-gray-100 cursor-pointer dark:hover:bg-gray-700 dark:text-gray-200 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center h-10 w-10 rounded-md bg-health-light dark:bg-health-secondary">
                            <Package className="h-5 w-5 text-health-primary dark:text-health-accent" />
                          </div>
                          <div>
                            <div className="text-base font-medium">
                              {humanizeTitle(group.normalized_name)}
                              {group.dosage_value && (
                                <span className="text-sm text-gray-500 ml-1">
                                  {group.dosage_value} {group.dosage_unit}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {group.vendor_count} apoteka
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-health-primary dark:text-health-accent flex items-center">
                            <TrendingDown className="h-4 w-4 mr-1" />
                            {formatPrice(group.price_range.min)}
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Sample Product Suggestions */}
            {filteredSuggestions.length > 0 && (
              <div>
                {searchGroups.length > 0 && (
                  <div className="px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700">
                    PREDLOZI
                  </div>
                )}
                <ul className="py-1">
                  {filteredSuggestions.map((suggestion) => (
                    <li
                      key={suggestion.id}
                      onClick={() => {
                        handleSuggestionClick(suggestion.name);
                        handleProductSelect(suggestion.id);
                      }}
                      className="px-4 py-3 hover:bg-gray-100 cursor-pointer flex items-center justify-between dark:hover:bg-gray-700 dark:text-gray-200 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10 rounded-md">
                          <AvatarImage
                            src={suggestion.image}
                            alt={suggestion.name}
                          />
                          <AvatarFallback className="rounded-md bg-gray-200 dark:bg-gray-700">
                            {suggestion.name.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-base">{suggestion.name}</span>
                      </div>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {suggestion.category}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

      <div className="mt-2 flex flex-wrap gap-2">
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Popularne pretrage:
        </span>
        <button
          type="button"
          onClick={(e) => handlePopularSearchClick(e, "vitamin d")}
          className="text-sm text-health-primary hover:underline dark:text-health-accent"
        >
          Vitamin D
        </button>
        <button
          type="button"
          onClick={(e) => handlePopularSearchClick(e, "protein")}
          className="text-sm text-health-primary hover:underline dark:text-health-accent"
        >
          Protein
        </button>
        <button
          type="button"
          onClick={(e) => handlePopularSearchClick(e, "omega")}
          className="text-sm text-health-primary hover:underline dark:text-health-accent"
        >
          Omega-3
        </button>
        <button
          type="button"
          onClick={(e) => handlePopularSearchClick(e, "probiotici")}
          className="text-sm text-health-primary hover:underline dark:text-health-accent"
        >
          Probiotici
        </button>
      </div>
      
      {hasUnsearchedChanges && (
        <div className="mt-1 text-xs text-health-primary dark:text-health-accent">
          Pritisnite Enter ili kliknite "Pretraži" da pretražite rezultate
        </div>
      )}

      {/* Product Detail Modal */}
      <ProductDetailModal
        product={selectedProduct}
        isOpen={showModal}
        onClose={() => setShowModal(false)}
      />
    </div>
  );
};

export default SearchBar;
