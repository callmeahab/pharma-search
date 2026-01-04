"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, X, Filter } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FilterState {
  minPrice: number;
  maxPrice: number;
  brands: string[];
  vendors: string[];
  dosages: string[];
  quantities: string[];
  forms: string[];
  groupSimilar: boolean;
  sortBy: "relevance" | "price_asc" | "price_desc" | "savings" | "vendors";
}

export interface Facets {
  vendorName?: Record<string, number>;
  brand?: Record<string, number>;
  normalizedName?: Record<string, number>;
  dosageUnit?: Record<string, number>;
}

interface FilterSidebarProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  facets?: Facets;
  priceRange?: { min: number; max: number };
  onClose?: () => void;
  className?: string;
}

const defaultFilters: FilterState = {
  minPrice: 0,
  maxPrice: 50000,
  brands: [],
  vendors: [],
  dosages: [],
  quantities: [],
  forms: [],
  groupSimilar: true,
  sortBy: "relevance",
};

export { defaultFilters };

// Sub-components defined outside to avoid recreating on each render
const FilterSection = ({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) => (
  <Collapsible defaultOpen={defaultOpen} className="border-b border-gray-200 dark:border-gray-700 pb-4">
    <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-health-primary dark:hover:text-health-accent">
      {title}
      <ChevronDown className="h-4 w-4 transition-transform duration-200 [&[data-state=open]]:rotate-180" />
    </CollapsibleTrigger>
    <CollapsibleContent className="pt-2 space-y-2">
      {children}
    </CollapsibleContent>
  </Collapsible>
);

const CheckboxItem = ({
  id,
  label,
  count,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  count?: number;
  checked: boolean;
  onChange: () => void;
}) => (
  <div className="flex items-center space-x-2">
    <Checkbox
      id={id}
      checked={checked}
      onCheckedChange={onChange}
      className="border-gray-300 dark:border-gray-600"
    />
    <Label
      htmlFor={id}
      className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer flex-1 truncate"
    >
      {label}
    </Label>
    {count !== undefined && (
      <span className="text-xs text-gray-500 dark:text-gray-400">({count})</span>
    )}
  </div>
);

export const FilterSidebar: React.FC<FilterSidebarProps> = ({
  filters,
  onFiltersChange,
  facets,
  priceRange = { min: 0, max: 50000 },
  onClose,
  className,
}) => {
  const updateFilter = <K extends keyof FilterState>(
    key: K,
    value: FilterState[K]
  ) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const toggleArrayFilter = (
    key: "brands" | "vendors" | "dosages" | "quantities" | "forms",
    value: string
  ) => {
    const current = filters[key];
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    updateFilter(key, updated);
  };

  const clearAllFilters = () => {
    onFiltersChange({
      ...defaultFilters,
      minPrice: priceRange.min,
      maxPrice: priceRange.max,
      sortBy: filters.sortBy,
      groupSimilar: filters.groupSimilar,
    });
  };

  const hasActiveFilters =
    filters.minPrice > priceRange.min ||
    filters.maxPrice < priceRange.max ||
    filters.brands.length > 0 ||
    filters.vendors.length > 0 ||
    filters.dosages.length > 0 ||
    filters.quantities.length > 0 ||
    filters.forms.length > 0;

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("sr-RS", {
      style: "decimal",
      maximumFractionDigits: 0,
    }).format(price) + " RSD";
  };

  // Extract dosage units from facets
  const dosageOptions = facets?.dosageUnit
    ? Object.entries(facets.dosageUnit)
        .filter(([key]) => key && key.trim() !== "")
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([key]) => key)
    : [];

  // Extract brands from facets
  const brandOptions = facets?.brand
    ? Object.entries(facets.brand)
        .filter(([key]) => key && key.trim() !== "")
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([key, count]) => ({ name: key, count }))
    : [];

  // Extract vendors from facets
  const vendorOptions = facets?.vendorName
    ? Object.entries(facets.vendorName)
        .filter(([key]) => key && key.trim() !== "")
        .sort((a, b) => b[1] - a[1])
        .map(([key, count]) => ({ name: key, count }))
    : [];

  return (
    <div
      className={cn(
        "bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Filter className="h-5 w-5" />
          Filteri
        </h3>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose} className="lg:hidden">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Clear filters */}
      {hasActiveFilters && (
        <Button
          variant="outline"
          size="sm"
          onClick={clearAllFilters}
          className="w-full mb-4 text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900/20"
        >
          Obriši sve filtere
        </Button>
      )}

      <div className="space-y-4">
        {/* Sort */}
        <FilterSection title="Sortiraj po">
          <select
            value={filters.sortBy}
            onChange={(e) => updateFilter("sortBy", e.target.value as FilterState["sortBy"])}
            className="w-full p-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            <option value="relevance">Relevantnost</option>
            <option value="price_asc">Cena: Niža prvo</option>
            <option value="price_desc">Cena: Viša prvo</option>
            <option value="savings">Najveća ušteda</option>
            <option value="vendors">Najviše apoteka</option>
          </select>
        </FilterSection>

        {/* Grouping toggle */}
        <FilterSection title="Prikaz">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="groupSimilar"
              checked={filters.groupSimilar}
              onCheckedChange={(checked) => updateFilter("groupSimilar", !!checked)}
            />
            <Label htmlFor="groupSimilar" className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              Grupiši slične proizvode
            </Label>
          </div>
        </FilterSection>

        {/* Price range */}
        <FilterSection title="Cena">
          <div className="px-2">
            <Slider
              key={`${priceRange.min}-${priceRange.max}-${filters.minPrice}-${filters.maxPrice}`}
              defaultValue={[
                Math.max(filters.minPrice, priceRange.min),
                Math.min(filters.maxPrice, priceRange.max)
              ]}
              min={priceRange.min}
              max={priceRange.max}
              step={100}
              onValueCommit={([min, max]) => {
                onFiltersChange({ ...filters, minPrice: min, maxPrice: max });
              }}
              className="mb-4"
            />
            <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
              <span>{formatPrice(Math.max(filters.minPrice, priceRange.min))}</span>
              <span>{formatPrice(Math.min(filters.maxPrice, priceRange.max))}</span>
            </div>
          </div>
        </FilterSection>

        {/* Dosage/Form */}
        {dosageOptions.length > 0 && (
          <FilterSection title="Oblik/Doza" defaultOpen={false}>
            <div className="max-h-40 overflow-y-auto space-y-2">
              {dosageOptions.map((dosage) => (
                <CheckboxItem
                  key={dosage}
                  id={`dosage-${dosage}`}
                  label={dosage}
                  checked={filters.dosages.includes(dosage)}
                  onChange={() => toggleArrayFilter("dosages", dosage)}
                />
              ))}
            </div>
          </FilterSection>
        )}

        {/* Brands */}
        {brandOptions.length > 0 && (
          <FilterSection title="Brend" defaultOpen={false}>
            <div className="max-h-48 overflow-y-auto space-y-2">
              {brandOptions.map(({ name, count }) => (
                <CheckboxItem
                  key={name}
                  id={`brand-${name}`}
                  label={name}
                  count={count}
                  checked={filters.brands.includes(name)}
                  onChange={() => toggleArrayFilter("brands", name)}
                />
              ))}
            </div>
          </FilterSection>
        )}

        {/* Vendors/Pharmacies */}
        {vendorOptions.length > 0 && (
          <FilterSection title="Apoteka" defaultOpen={false}>
            <div className="max-h-48 overflow-y-auto space-y-2">
              {vendorOptions.map(({ name, count }) => (
                <CheckboxItem
                  key={name}
                  id={`vendor-${name}`}
                  label={name}
                  count={count}
                  checked={filters.vendors.includes(name)}
                  onChange={() => toggleArrayFilter("vendors", name)}
                />
              ))}
            </div>
          </FilterSection>
        )}
      </div>
    </div>
  );
};

export default FilterSidebar;
