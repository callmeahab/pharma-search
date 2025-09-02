"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ExternalLink,
  Store,
  Award,
  Package,
  Pill,
} from "lucide-react";
import { Product } from "@/lib/api";
import { humanizeTitle, formatPrice } from "@/lib/utils";

// Helper function to normalize product name for search
const normalizeProductName = (title: string): string => {
  return title
    .toLowerCase()
    .replace(/\b\d+(mg|mcg|μg|iu|ie|g|ml|kom|kapsula|tableta)\b/g, '') // Remove specific dosages
    .replace(/\b\d+\s*x\s*\d+/g, '') // Remove package quantities like "30x500"
    .replace(/[^\w\s]/g, ' ') // Replace special characters with spaces
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .trim();
};

// Helper function to normalize product name for price comparison (less aggressive)
const normalizeForComparison = (title: string): string => {
  return title
    .toLowerCase()
    .replace(/\b\d+(mg|mcg|μg|iu|ie)\b/g, '') // Remove only dosage units, keep package sizes
    .replace(/[^\w\s]/g, ' ') // Replace special characters with spaces
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .trim()
    .split(' ')
    .slice(0, 3) // Take only first 3 meaningful words for grouping
    .join(' ');
};

// Helper function to group products by normalized name for price comparison
const groupProductsByName = (products: Product[]) => {
  const groups: { [key: string]: Product[] } = {};
  
  products.forEach(product => {
    const normalizedName = normalizeForComparison(product.title);
    if (!groups[normalizedName]) {
      groups[normalizedName] = [];
    }
    groups[normalizedName].push(product);
  });
  
  return groups;
};

// Helper function to calculate price statistics for a product group
const calculatePriceStats = (products: Product[]) => {
  const prices = products.map(p => p.price).sort((a, b) => a - b);
  const min = prices[0];
  const max = prices[prices.length - 1];
  const avg = prices.reduce((sum, price) => sum + price, 0) / prices.length;
  
  return { min, max, avg, count: prices.length };
};

// Helper function to get price comparison info for a product
const getPriceComparisonInfo = (product: Product, allProducts: Product[]) => {
  const productGroups = groupProductsByName(allProducts);
  const normalizedName = normalizeForComparison(product.title);
  const similarProducts = productGroups[normalizedName] || [product];
  
  if (similarProducts.length === 1) {
    return {
      isLowestPrice: true,
      percentageAboveMin: 0,
      priceStats: null,
      similarCount: 1
    };
  }
  
  const stats = calculatePriceStats(similarProducts);
  const percentageAboveMin = stats.min > 0 ? ((product.price - stats.min) / stats.min) * 100 : 0;
  
  return {
    isLowestPrice: product.price === stats.min,
    percentageAboveMin: Math.round(percentageAboveMin),
    priceStats: stats,
    similarCount: similarProducts.length
  };
};

// Helper function to get the best product image
const getProductImage = (product: Product): string => {
  // Try thumbnail first
  if (product.thumbnail && product.thumbnail !== '') {
    return product.thumbnail;
  }
  
  // Try first photo from photos array if it exists
  if (product.photos && product.photos !== '') {
    try {
      // Photos might be stored as JSON string or comma-separated
      if (product.photos.startsWith('[')) {
        const photosArray = JSON.parse(product.photos);
        if (Array.isArray(photosArray) && photosArray.length > 0) {
          return photosArray[0];
        }
      } else if (product.photos.includes(',')) {
        const firstPhoto = product.photos.split(',')[0].trim();
        if (firstPhoto) {
          return firstPhoto;
        }
      } else {
        return product.photos;
      }
    } catch (error) {
      // If parsing fails, try to use photos as a single URL
      if (product.photos.startsWith('http')) {
        return product.photos;
      }
    }
  }
  
  // Fallback to placeholder
  return '/medicine-placeholder.svg';
};

interface FlatSearchResultsProps {
  products: Product[];
  total: number;
  loading?: boolean;
  error?: string;
  onSearch?: (query: string, forceRefresh?: boolean) => void;
}

const FlatSearchResults: React.FC<FlatSearchResultsProps> = ({
  products,
  total,
  loading = false,
  error,
  onSearch,
}) => {
  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(6)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-4">
              <div className="flex justify-between items-start">
                <div className="flex-1 space-y-2">
                  <div className="w-3/4 h-5 bg-gray-200 rounded"></div>
                  <div className="w-1/2 h-4 bg-gray-200 rounded"></div>
                  <div className="w-1/4 h-3 bg-gray-200 rounded"></div>
                </div>
                <div className="w-20 h-6 bg-gray-200 rounded"></div>
              </div>
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

  if (products.length === 0) {
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
    <div className="space-y-3">
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Pronađeno je <strong>{total}</strong> proizvoda
        </p>
      </div>

      {products.map((product, index) => {
        const priceInfo = getPriceComparisonInfo(product, products);
        
        return (
          <Card key={product.id} className="hover:shadow-lg transition-all duration-200 hover:-translate-y-1">
            <CardContent className="p-4">
              <div className="flex justify-between items-start">
                <div className="flex gap-4 flex-1 pr-4">
                  {/* Product Image */}
                  <div className="flex-shrink-0">
                    <img
                      src={getProductImage(product)}
                      alt={humanizeTitle(product.title)}
                      className="w-24 h-24 object-cover rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 shadow-sm hover:shadow-md transition-shadow duration-200"
                      onError={(e) => {
                        e.currentTarget.src = '/medicine-placeholder.svg';
                      }}
                    />
                  </div>
                  
                  {/* Product Details */}
                  <div className="flex-1">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 
                          className="text-lg font-semibold text-health-primary dark:text-health-accent mb-2 cursor-pointer hover:underline transition-colors"
                          onClick={() => onSearch && onSearch(product.title, true)}
                          title="Kliknite za pretragu ovog proizvoda"
                        >
                          {humanizeTitle(product.title)}
                        </h3>
                    
                    <div className="flex flex-wrap gap-2 mb-3">
                      <Badge variant="outline" className="text-xs">
                        <Store className="w-3 h-3 mr-1" />
                        {product.vendor_name}
                      </Badge>
                      
                      {product.brand_name && (
                        <Badge variant="secondary" className="text-xs">
                          {product.brand_name}
                        </Badge>
                      )}
                      
                      {product.form && (
                        <Badge variant="outline" className="text-xs">
                          <Pill className="w-3 h-3 mr-1" />
                          {product.form}
                        </Badge>
                      )}
                      
                      {product.dosage_text && (
                        <Badge variant="outline" className="text-xs">
                          {product.dosage_text}
                        </Badge>
                      )}
                      
                      {product.volume_text && (
                        <Badge variant="outline" className="text-xs">
                          <Package className="w-3 h-3 mr-1" />
                          {product.volume_text}
                        </Badge>
                      )}
                    </div>

                    {product.category && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                        Kategorija: {product.category}
                      </p>
                    )}

                    {product.quality_score && (
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <Award className="w-3 h-3" />
                        <span>Ocena kvaliteta: {product.quality_score.toFixed(1)}</span>
                      </div>
                    )}
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Price and Actions */}
              <div className="text-right flex flex-col items-end">
                <div className="flex flex-col items-end mb-2">
                  <div className="text-2xl font-bold text-health-primary dark:text-health-accent">
                    {formatPrice(product.price)}
                  </div>
                  
                  {/* Price Comparison Info */}
                  {priceInfo.similarCount > 1 && (
                    <div className="text-xs mt-1">
                      {priceInfo.isLowestPrice ? (
                        <span className="text-green-600 font-medium">
                          Najbolja cena od {priceInfo.similarCount} prodavaca
                        </span>
                      ) : (
                        <span className="text-orange-600 font-medium">
                          +{priceInfo.percentageAboveMin}% skuplje
                        </span>
                      )}
                    </div>
                  )}
                  
                  {/* Price Statistics */}
                  {priceInfo.priceStats && priceInfo.similarCount > 1 && (
                    <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      Min: {formatPrice(priceInfo.priceStats.min)} • 
                      Prosek: {formatPrice(priceInfo.priceStats.avg)} • 
                      Max: {formatPrice(priceInfo.priceStats.max)}
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
          </CardContent>
        </Card>
        );
      })}
    </div>
  );
};

export default FlatSearchResults;