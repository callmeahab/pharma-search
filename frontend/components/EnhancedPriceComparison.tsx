import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, ExternalLink, TrendingUp, Package, Users, Store, Award, AlertTriangle } from 'lucide-react';
import { getPriceComparison, type PriceComparisonResult } from '@/lib/api';
import { formatPrice } from '@/lib/utils';
import { PriceComparison } from './PriceComparison';

interface EnhancedPriceComparisonProps {
  groupId: string;
  className?: string;
}

export const EnhancedPriceComparison: React.FC<EnhancedPriceComparisonProps> = ({ 
  groupId, 
  className 
}) => {
  const [data, setData] = useState<PriceComparisonResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const result = await getPriceComparison(groupId);
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch price comparison data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [groupId]);

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Price Comparison</CardTitle>
          <CardDescription>Loading comparison data...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Price Comparison</CardTitle>
          <CardDescription>Error loading comparison data</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-red-500 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  const { group, products } = data;
  const bestDealProduct = products.find(p => p.price_analysis.is_best_deal);
  const worstDealProduct = products.find(p => p.price_analysis.is_worst_deal);

  return (
    <div className={className}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            {group.name}
          </CardTitle>
          <CardDescription>
            {group.dosage_value && group.dosage_unit && (
              <span className="inline-block mr-2">
                {group.dosage_value}{group.dosage_unit}
              </span>
            )}
            Available at {group.vendor_count} vendors
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Group Statistics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-blue-500" />
              <div>
                <div className="text-2xl font-bold">{group.product_count}</div>
                <div className="text-sm text-gray-600">Products</div>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4 text-green-500" />
              <div>
                <div className="text-2xl font-bold">{group.vendor_count}</div>
                <div className="text-sm text-gray-600">Vendors</div>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 text-yellow-500" />
              <div>
                <div className="text-2xl font-bold">{formatPrice(group.price_stats.min)}</div>
                <div className="text-sm text-gray-600">Best Price</div>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-red-500" />
              <div>
                <div className="text-2xl font-bold">{formatPrice(group.price_stats.range)}</div>
                <div className="text-sm text-gray-600">Price Range</div>
              </div>
            </div>
          </div>

          {/* Price Statistics */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-6">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Price Statistics
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Minimum Price</div>
                <div className="text-lg font-semibold text-green-600">{formatPrice(group.price_stats.min)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Average Price</div>
                <div className="text-lg font-semibold">{formatPrice(group.price_stats.avg)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Maximum Price</div>
                <div className="text-lg font-semibold text-red-600">{formatPrice(group.price_stats.max)}</div>
              </div>
            </div>
          </div>

          {/* Best and Worst Deals */}
          {(bestDealProduct || worstDealProduct) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {bestDealProduct && (
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Award className="h-4 w-4 text-green-600" />
                    <span className="font-semibold text-green-800 dark:text-green-300">Best Deal</span>
                  </div>
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    <div className="font-medium">{bestDealProduct.vendor.name}</div>
                    <div className="text-green-600 font-semibold">{formatPrice(bestDealProduct.price)}</div>
                  </div>
                </div>
              )}
              
              {worstDealProduct && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    <span className="font-semibold text-red-800 dark:text-red-300">Highest Price</span>
                  </div>
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    <div className="font-medium">{worstDealProduct.vendor.name}</div>
                    <div className="text-red-600 font-semibold">{formatPrice(worstDealProduct.price)}</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Price Comparison List */}
          <PriceComparison
            products={products}
            productName={group.name}
            isInCard={false}
          />
        </CardContent>
      </Card>
    </div>
  );
};