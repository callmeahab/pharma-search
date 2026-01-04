"use client";

import React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FilterState, Facets } from "./FilterSidebar";

interface FilterChipsProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  facets?: Facets;
  className?: string;
}

const EXCLUDED_BRANDS = new Set([
  "", " ", "null", "undefined", "n/a", "-", "bez brenda", "nepoznat"
]);

const MIN_BRAND_COUNT = 2;

export const FilterChips: React.FC<FilterChipsProps> = ({
  filters,
  onFiltersChange,
  facets,
  className,
}) => {
  const removeFilter = (
    key: "brands" | "vendors" | "dosages" | "quantities" | "forms",
    value: string
  ) => {
    onFiltersChange({
      ...filters,
      [key]: filters[key].filter((v) => v !== value),
    });
  };

  const clearPriceFilter = () => {
    onFiltersChange({
      ...filters,
      minPrice: 0,
      maxPrice: 50000,
    });
  };

  const suggestedBrands = facets?.brand
    ? Object.entries(facets.brand)
        .filter(([key, count]) => {
          const normalizedKey = key?.toLowerCase().trim() || "";
          return (
            key &&
            key.trim().length > 1 &&
            !EXCLUDED_BRANDS.has(normalizedKey) &&
            !filters.brands.includes(key) &&
            count >= MIN_BRAND_COUNT
          );
        })
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([key, count]) => ({ name: key, count }))
    : [];


  const addBrandFilter = (brand: string) => {
    onFiltersChange({
      ...filters,
      brands: [...filters.brands, brand],
    });
  };


  const activeChips: { label: string; onRemove: () => void }[] = [];

  if (filters.minPrice > 0 || filters.maxPrice < 50000) {
    const formatPrice = (p: number) =>
      new Intl.NumberFormat("sr-RS").format(p);
    activeChips.push({
      label: `${formatPrice(filters.minPrice)} - ${formatPrice(filters.maxPrice)} RSD`,
      onRemove: clearPriceFilter,
    });
  }

  filters.brands.forEach((brand) => {
    activeChips.push({
      label: brand,
      onRemove: () => removeFilter("brands", brand),
    });
  });

  filters.vendors.forEach((vendor) => {
    activeChips.push({
      label: vendor,
      onRemove: () => removeFilter("vendors", vendor),
    });
  });

  filters.quantities.forEach((qty) => {
    activeChips.push({
      label: `${qty} kom`,
      onRemove: () => removeFilter("quantities", qty),
    });
  });

  filters.dosages.forEach((dosage) => {
    activeChips.push({
      label: dosage,
      onRemove: () => removeFilter("dosages", dosage),
    });
  });

  const hasActiveFilters = activeChips.length > 0;
  const hasSuggestions = suggestedBrands.length > 0;

  if (!hasActiveFilters && !hasSuggestions) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap gap-2 items-center", className)}>
      {activeChips.map((chip, index) => (
        <span
          key={index}
          className="inline-flex items-center gap-1 px-3 py-1 text-sm bg-health-primary text-white rounded-full"
        >
          {chip.label}
          <button
            onClick={chip.onRemove}
            className="hover:bg-white/20 rounded-full p-0.5"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      {hasActiveFilters && hasSuggestions && (
        <span className="text-gray-400 dark:text-gray-500 mx-1">|</span>
      )}

      {suggestedBrands.map(({ name, count }) => (
        <button
          key={name}
          onClick={() => addBrandFilter(name)}
          className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-full hover:border-health-primary hover:text-health-primary dark:hover:border-health-accent dark:hover:text-health-accent transition-colors"
          title={`${count} proizvoda`}
        >
          {name}
        </button>
      ))}
    </div>
  );
};

export default FilterChips;
