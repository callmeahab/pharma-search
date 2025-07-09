"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  TrendingDown,
  Store,
  TrendingUp,
  DollarSign,
  Award,
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
              <div className="w-3/4 h-6 bg-gray-200 rounded"></div>
              <div className="w-1/2 h-4 bg-gray-200 rounded"></div>
            </CardHeader>
            <CardContent>
              <div className="w-full h-4 bg-gray-200 rounded"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="bg-red-50 border-red-200">
        <CardContent className="p-6 text-center">
          <p className="font-medium text-red-600">Greška pri pretraživanju</p>
          <p className="mt-1 text-sm text-red-500">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-lg text-gray-600">
            Nema rezultata za vašu pretragu
          </p>
          <p className="mt-2 text-sm text-gray-500">
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
          product.price < min.price ? product : min,
        );

        return (
          <Card key={group.id} className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <CardTitle className="text-lg text-health-primary dark:text-health-accent">
                    {humanizeTitle(group.normalized_name)}
                    {group.dosage_value && (
                      <span className="ml-2 font-normal text-gray-600 dark:text-gray-400">
                        {group.dosage_value} {group.dosage_unit}
                      </span>
                    )}
                  </CardTitle>
                  <div className="flex gap-4 items-center mt-2 text-sm text-gray-600 dark:text-gray-400">
                    <div className="flex gap-1 items-center">
                      <Store className="w-4 h-4" />
                      <span>{group.vendor_count} apoteka</span>
                    </div>
                    <div className="flex gap-1 items-center">
                      <TrendingDown className="w-4 h-4" />
                      <span>od {formatPrice(group.price_range.min)}</span>
                    </div>
                    {group.price_analysis?.savings_potential &&
                      group.price_analysis.savings_potential > 0 && (
                        <div className="flex gap-1 items-center">
                          <DollarSign className="w-4 h-4 text-green-600" />
                          <span className="font-medium text-green-600">
                            Uštedite do{" "}
                            {formatPrice(
                              group.price_analysis.savings_potential,
                            )}
                          </span>
                        </div>
                      )}
                    {group.price_analysis?.has_multiple_vendors && (
                      <Badge variant="secondary" className="text-xs">
                        <TrendingUp className="mr-1 w-3 h-3" />
                        Više ponuđača
                      </Badge>
                    )}
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
                  {group.price_analysis?.price_variation &&
                    group.price_analysis.price_variation > 20 && (
                      <div className="mt-1 text-xs text-orange-600">
                        Visoka varijabilnost cena
                      </div>
                    )}
                </div>
              </div>

              {!isExpanded && (
                <div className="flex justify-between items-center mt-3">
                  <div className="flex gap-2 items-center">
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
                      <ChevronDown className="ml-1 w-4 h-4" />
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
                    <ChevronUp className="ml-1 w-4 h-4" />
                  </Button>
                </div>

                <div className="space-y-2">
                  {group.products
                    .sort((a, b) => a.price - b.price)
                    .map((product) => (
                      <div
                        key={product.id}
                        className={`flex items-center justify-between p-3 rounded-lg ${
                          product.price_analysis?.is_best_deal
                            ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                            : "bg-gray-50 dark:bg-gray-800"
                        }`}
                      >
                        <div className="flex-1">
                          <div className="flex gap-2 items-center">
                            <div className="font-medium text-gray-900 dark:text-gray-100">
                              {product.vendor_name}
                            </div>
                            {product.price_analysis?.is_best_deal && (
                              <Badge
                                variant="default"
                                className="text-xs text-white bg-green-600"
                              >
                                <Award className="mr-1 w-3 h-3" />
                                Najbolja cena
                              </Badge>
                            )}
                            {product.price_analysis?.is_worst_deal && (
                              <Badge
                                variant="outline"
                                className="text-xs text-red-600 border-red-200"
                              >
                                Najskuplja
                              </Badge>
                            )}
                          </div>
                          <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                            {humanizeTitle(product.title)}
                          </div>
                          {product.price_analysis?.diff_from_avg && (
                            <div className="mt-1 text-xs">
                              {product.price_analysis.diff_from_avg > 0 ? (
                                <span className="text-red-600">
                                  +
                                  {formatPrice(
                                    product.price_analysis.diff_from_avg,
                                  )}{" "}
                                  od proseka
                                </span>
                              ) : (
                                <span className="text-green-600">
                                  {formatPrice(
                                    product.price_analysis.diff_from_avg,
                                  )}{" "}
                                  od proseka
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-3 items-center">
                          <div className="text-right">
                            <div className="text-lg font-bold text-health-primary dark:text-health-accent">
                              {formatPrice(product.price)}
                            </div>
                            {product.price_analysis?.percentile !==
                              undefined && (
                              <div className="text-xs text-gray-500">
                                {product.price_analysis.percentile.toFixed(0)}%
                                opsega
                              </div>
                            )}
                          </div>
                          <Button
                            size="sm"
                            onClick={() => window.open(product.link, "_blank")}
                            className="bg-health-primary dark:bg-health-secondary dark:hover:bg-health-primary hover:bg-health-secondary"
                          >
                            <ExternalLink className="mr-1 w-4 h-4" />
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
