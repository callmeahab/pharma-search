import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { searchProducts, autocomplete, ProductGroup, AutocompleteResult } from "@/lib/api";
import { Product } from "@/types/product";
import ProductDetailModal from "./ProductDetailModal";
import { Spinner } from "@/components/ui/spinner";

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
  const [autocompleteSuggestions, setAutocompleteSuggestions] = useState<AutocompleteResult["suggestions"]>([]);
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
        fetchAutocompleteSuggestions(initialTerm);
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

  // Fetch autocomplete suggestions from API
  const fetchAutocompleteSuggestions = async (value: string) => {
    if (value.trim() === "") {
      setAutocompleteSuggestions([]);
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

    // Use fast autocomplete for dropdown suggestions
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await autocomplete(value, 8);
        setAutocompleteSuggestions(results.suggestions);
        setSearchGroups([]); // Clear groups for dropdown
      } catch (error) {
        console.error("Error fetching autocomplete:", error);
        setAutocompleteSuggestions([]);
      } finally {
        setIsLoadingGroups(false);
      }
    }, value.length <= 2 ? 400 : 150); // Faster for autocomplete
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchTerm(value);
    setHasUnsearchedChanges(true);

    if (value.trim() === "") {
      setIsDropdownOpen(false);
      setAutocompleteSuggestions([]);
      setSearchGroups([]);
      setFilteredSuggestions([]);
    } else {
      setIsDropdownOpen(true);
      fetchAutocompleteSuggestions(value);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      onSearch(searchTerm.trim());
      setIsDropdownOpen(false);
      setHasUnsearchedChanges(false);
    }
  };

  const handleSuggestionClick = (name: string) => {
    setSearchTerm(name);
    onSearch(name);
    setIsDropdownOpen(false);
    setHasUnsearchedChanges(false);
  };

  const handleProductSelect = (productId: string) => {
    // Find the product from search groups
    const product = searchGroups
      .flatMap((group) => group.products)
      .find((p) => p.id === productId);

    if (product) {
      // Map the BackendProduct to match the Product type
      const mappedProduct: Product = {
        id: product.id,
        name: product.title,
        description: `Dostupno u apoteci ${product.vendor_name}`,
        category: '',
        image: product.thumbnail || '/medicine-placeholder.svg',
        prices: [{
          store: product.vendor_name,
          price: product.price,
          inStock: true,
          link: product.link
        }],
        vendorCount: 1
      };
      setSelectedProduct(mappedProduct);
      setShowModal(true);
    }
  };

  const handlePopularSearchClick = (
    e: React.MouseEvent,
    term: string
  ) => {
    e.preventDefault();
    setSearchTerm(term);
    onSearch(term);
    setHasUnsearchedChanges(false);
  };

  const clearSearch = () => {
    setSearchTerm("");
    setIsDropdownOpen(false);
    setAutocompleteSuggestions([]);
    setSearchGroups([]);
    setFilteredSuggestions([]);
    setHasUnsearchedChanges(false);
  };

  return (
    <div className="relative w-full max-w-4xl mx-auto" ref={dropdownRef}>
      <form onSubmit={handleSubmit} className="flex">
        <div className="relative flex-1">
          <Input
            ref={inputRef}
            type="text"
            placeholder="Pretražite proizvode, brendove ili kategorije..."
            value={searchTerm}
            onChange={handleInputChange}
            onFocus={() => {
              if (searchTerm.trim()) {
                setIsDropdownOpen(true);
              }
            }}
            className="h-14 rounded-r-none border-r-0 text-base"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded-full transition-colors"
            >
              <X className="h-4 w-4 text-gray-400" />
            </button>
          )}
        </div>
        <Button
          type="submit"
          className={`h-14 px-6 rounded-l-none bg-health-primary hover:bg-health-secondary dark:bg-health-secondary dark:hover:bg-health-primary ${hasUnsearchedChanges ? 'ring-2 ring-health-secondary ring-opacity-50' : ''
            }`}
        >
          <Search className="mr-2 h-5 w-5" />
          <span className="text-base">Pretraži</span>
          {hasUnsearchedChanges && (
            <span className="ml-1 w-2 h-2 bg-health-secondary rounded-full"></span>
          )}
        </Button>
      </form>

      {/* Dropdown for search suggestions */}
      {isDropdownOpen &&
        (autocompleteSuggestions.length > 0 ||
          filteredSuggestions.length > 0 ||
          isLoadingGroups) && (
          <div className="absolute z-10 w-full mt-1 bg-white rounded-md shadow-lg max-h-80 overflow-auto dark:bg-gray-800 dark:border dark:border-gray-700">
            {isLoadingGroups && (
              <div className="px-4 py-6 text-center">
                <Spinner size="md" text="Pretraživanje..." />
              </div>
            )}

            {/* Autocomplete Suggestions from API */}
            {autocompleteSuggestions.length > 0 && (
              <div>
                <div className="px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700">
                  PREDLOZI
                </div>
                <ul className="py-1">
                  {autocompleteSuggestions.map((suggestion) => (
                    <li
                      key={suggestion.id}
                      onClick={() => handleSuggestionClick(suggestion.title)}
                      className="px-4 py-3 hover:bg-gray-100 cursor-pointer flex items-center justify-between dark:hover:bg-gray-700 dark:text-gray-200 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8 rounded-md">
                          <AvatarFallback className="rounded-md bg-gray-200 dark:bg-gray-700 text-xs">
                            {suggestion.title.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm">{suggestion.title}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-medium text-green-600 dark:text-green-400">
                          {suggestion.price.toLocaleString('sr-RS')} RSD
                        </span>
                        <div className="text-xs text-gray-400 dark:text-gray-500">
                          {suggestion.vendor_name}
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
