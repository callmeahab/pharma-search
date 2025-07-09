import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, Package, Users, Store } from 'lucide-react';
import { getGroupingAnalysis, type GroupingAnalysis } from '@/lib/api';
import { formatPrice } from '@/lib/utils';

interface GroupingAnalysisProps {
  className?: string;
}

export const GroupingAnalysisComponent: React.FC<GroupingAnalysisProps> = ({ className }) => {
  const [data, setData] = useState<GroupingAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const result = await getGroupingAnalysis();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch grouping analysis');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Grouping Analysis</CardTitle>
          <CardDescription>Loading analysis data...</CardDescription>
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
          <CardTitle>Grouping Analysis</CardTitle>
          <CardDescription>Error loading analysis data</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-red-500">{error}</div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  const { statistics, top_groups } = data;

  return (
    <div className={className}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Grouping Analysis
          </CardTitle>
          <CardDescription>
            Overview of product grouping effectiveness
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-blue-500" />
              <div>
                <div className="text-2xl font-bold">{statistics.total_products.toLocaleString()}</div>
                <div className="text-sm text-gray-600">Total Products</div>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-green-500" />
              <div>
                <div className="text-2xl font-bold">{statistics.total_groups.toLocaleString()}</div>
                <div className="text-sm text-gray-600">Product Groups</div>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4 text-purple-500" />
              <div>
                <div className="text-2xl font-bold">{statistics.avg_products_per_group.toFixed(1)}</div>
                <div className="text-sm text-gray-600">Avg Products/Group</div>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-orange-500" />
              <div>
                <div className="text-2xl font-bold">{statistics.multi_vendor_percentage.toFixed(1)}%</div>
                <div className="text-sm text-gray-600">Multi-Vendor Groups</div>
              </div>
            </div>
          </div>
          
          <div className="space-y-3">
            <h3 className="text-lg font-semibold">Top Product Groups</h3>
            <div className="space-y-2">
              {top_groups.map((group, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="flex-1">
                    <div className="font-medium">{group.name}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-4">
                      <Badge variant="secondary">{group.product_count} products</Badge>
                      <Badge variant="outline">{group.vendor_count} vendors</Badge>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{formatPrice(group.price_range.min)} - {formatPrice(group.price_range.max)}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      Avg: {formatPrice(group.price_range.avg)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};