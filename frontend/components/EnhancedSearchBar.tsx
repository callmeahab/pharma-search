"use client";

import { useState, useEffect, useRef } from "react";
import { Search, X, Lightbulb, TrendingUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  getSearchSuggestions, 
  getRelatedSearches, 
  SearchSuggestion 
} from "@/lib/api";

interface EnhancedSearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
  initialQuery?: string;
  showEnhancements?: boolean;
}

export function EnhancedSearchBar({
  onSearch,
  placeholder = "Pretražite lekove, suplemente, vitamini...",
  initialQuery = "",
  showEnhancements = true,
}: EnhancedSearchBarProps) {
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [relatedSearches, setRelatedSearches] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Debounced suggestions
  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timeoutId = setTimeout(async () => {
      try {
        setIsLoading(true);
        const response = await getSearchSuggestions(query.trim(), 5);
        setSuggestions(response.suggestions);
        setShowSuggestions(true);
      } catch (error) {
        console.error("Failed to fetch suggestions:", error);
        setSuggestions([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [query]);

  // Get related searches when search is performed
  useEffect(() => {
    if (!query.trim() || !showEnhancements) return;

    const fetchRelated = async () => {
      try {
        const response = await getRelatedSearches(query.trim(), 5);
        setRelatedSearches(response.related_searches);
      } catch (error) {
        console.error("Failed to fetch related searches:", error);
        setRelatedSearches([]);
      }
    };

    const timeoutId = setTimeout(fetchRelated, 1000);
    return () => clearTimeout(timeoutId);
  }, [query, showEnhancements]);

  const handleSearch = () => {
    if (query.trim()) {
      onSearch(query.trim());
      setShowSuggestions(false);
      setSelectedIndex(-1);
      inputRef.current?.blur();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === "Enter") {
        handleSearch();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => 
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case "Enter":
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
          const selectedSuggestion = suggestions[selectedIndex].text;
          setQuery(selectedSuggestion);
          onSearch(selectedSuggestion);
          setShowSuggestions(false);
          setSelectedIndex(-1);
        } else {
          handleSearch();
        }
        break;
      case "Escape":
        setShowSuggestions(false);
        setSelectedIndex(-1);
        inputRef.current?.blur();
        break;
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setQuery(suggestion);
    onSearch(suggestion);
    setShowSuggestions(false);
    setSelectedIndex(-1);
  };

  const handleRelatedSearchClick = (relatedQuery: string) => {
    setQuery(relatedQuery);
    onSearch(relatedQuery);
  };

  const clearQuery = () => {
    setQuery("");
    setSuggestions([]);
    setRelatedSearches([]);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4">
      <div className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (suggestions.length > 0) {
                setShowSuggestions(true);
              }
            }}
            placeholder={placeholder}
            className="w-full pl-10 pr-20 py-3 text-lg"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
            {query && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearQuery}
                className="h-8 w-8 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
            <Button
              onClick={handleSearch}
              size="sm"
              disabled={!query.trim() || isLoading}
              className="h-8"
            >
              Search
            </Button>
          </div>
        </div>

        {/* Suggestions Dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div
            ref={suggestionsRef}
            className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg z-50 max-h-60 overflow-y-auto"
          >
            {suggestions.map((suggestion, index) => (
              <div
                key={index}
                className={`px-4 py-2 cursor-pointer flex items-center justify-between hover:bg-muted ${
                  index === selectedIndex ? "bg-muted" : ""
                }`}
                onClick={() => handleSuggestionClick(suggestion.text)}
              >
                <span className="text-sm">{suggestion.text}</span>
                {suggestion.frequency > 1 && (
                  <Badge variant="secondary" className="text-xs">
                    {suggestion.frequency}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Related Searches */}
      {showEnhancements && relatedSearches.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lightbulb className="h-4 w-4" />
            <span>Povezane pretrage:</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {relatedSearches.map((related, index) => (
              <Badge
                key={index}
                variant="outline"
                className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                onClick={() => handleRelatedSearchClick(related)}
              >
                {related}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Search Tips */}
      {showEnhancements && !query && (
        <div className="text-center space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center justify-center gap-2">
            <TrendingUp className="h-4 w-4" />
            <span>Popularno:</span>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {["vitamin d", "omega 3", "magnesium", "protein", "probiotik"].map(
              (tip) => (
                <Badge
                  key={tip}
                  variant="secondary"
                  className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                  onClick={() => handleRelatedSearchClick(tip)}
                >
                  {tip}
                </Badge>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}