"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  MapPin,
  TrendingDown,
  Store,
} from "lucide-react";
import { ProductGroup } from "@/types/product";
import { humanizeTitle, formatPrice } from "@/lib/utils";

interface SearchResultsProps {
  groups: ProductGroup[];
  total: number;
  loading?: boolean;
  error?: string;
}

const SearchResults: React.FC<SearchResultsProps> = ({
  groups,
  total,
  loading = false,
  error,
}) => {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Using imported formatPrice function from utils

  const toggleGroupExpansion = (groupId: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupId)) {
      newExpanded.delete(groupId);
    } else {
      newExpanded.add(groupId);
    }
    setExpandedGroups(newExpanded);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader>
              <div className="h-6 bg-gray-200 rounded w-3/4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </CardHeader>
            <CardContent>
              <div className="h-4 bg-gray-200 rounded w-full"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="p-6 text-center">
          <p className="text-red-600 font-medium">Greška pri pretraživanju</p>
          <p className="text-red-500 text-sm mt-1">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-gray-600 text-lg">
            Nema rezultata za vašu pretragu
          </p>
          <p className="text-gray-500 text-sm mt-2">
            Pokušajte sa drugačijim ključnim rečima
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Pronađeno je <strong>{total}</strong> grupa proizvoda
        </p>
      </div>

      {groups.map((group) => {
        const isExpanded = expandedGroups.has(group.id);
        const hasMultipleProducts = group.products.length > 1;
        const cheapestProduct = group.products.reduce((min, product) =>
          product.price < min.price ? product : min
        );

        return (
          <Card key={group.id} className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <CardTitle className="text-lg text-health-primary dark:text-health-accent">
                    {humanizeTitle(group.normalized_name)}
                    {group.dosage_value && (
                      <span className="font-normal text-gray-600 dark:text-gray-400 ml-2">
                        {group.dosage_value} {group.dosage_unit}
                      </span>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-4 mt-2 text-sm text-gray-600 dark:text-gray-400">
                    <div className="flex items-center gap-1">
                      <Store className="h-4 w-4" />
                      <span>{group.vendor_count} apoteka</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <TrendingDown className="h-4 w-4" />
                      <span>od {formatPrice(group.price_range.min)}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-health-primary dark:text-health-accent">
                    {formatPrice(group.price_range.min)}
                  </div>
                  {group.price_range.min !== group.price_range.max && (
                    <div className="text-sm text-gray-500">
                      do {formatPrice(group.price_range.max)}
                    </div>
                  )}
                </div>
              </div>

              {!isExpanded && (
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {cheapestProduct.vendor_name}
                    </Badge>
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      najniža cena
                    </span>
                  </div>
                  {hasMultipleProducts && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleGroupExpansion(group.id)}
                      className="text-health-primary dark:text-health-accent"
                    >
                      Prikaži sve ({group.products.length})
                      <ChevronDown className="ml-1 h-4 w-4" />
                    </Button>
                  )}
                </div>
              )}
            </CardHeader>

            {isExpanded && (
              <CardContent className="pt-0">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="font-medium text-gray-900 dark:text-gray-100">
                    Sve ponude ({group.products.length})
                  </h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleGroupExpansion(group.id)}
                    className="text-health-primary dark:text-health-accent"
                  >
                    Sakrij
                    <ChevronUp className="ml-1 h-4 w-4" />
                  </Button>
                </div>

                <div className="space-y-2">
                  {group.products
                    .sort((a, b) => a.price - b.price)
                    .map((product) => (
                      <div
                        key={product.id}
                        className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                      >
                        <div className="flex-1">
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            {product.vendor_name}
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            {humanizeTitle(product.title)}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="font-bold text-lg text-health-primary dark:text-health-accent">
                              {formatPrice(product.price)}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => window.open(product.link, "_blank")}
                            className="bg-health-primary hover:bg-health-secondary dark:bg-health-secondary dark:hover:bg-health-primary"
                          >
                            <ExternalLink className="h-4 w-4 mr-1" />
                            Kupi
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
};

export default SearchResults;
