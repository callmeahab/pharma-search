"use client";

import { useState, useEffect } from "react";
import { TrendingDown, ShoppingCart, AlertCircle, Percent } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  getBetterDeals, 
  getCheaperAlternatives, 
  trackPriceDrops,
  BetterDeal, 
  AlternativeProduct, 
  PriceAlert 
} from "@/lib/api";

interface PriceRecommendationsProps {
  productId?: string;
  searchQuery?: string;
  priceLimit?: number;
}

export function PriceRecommendations({
  productId,
  searchQuery,
  priceLimit,
}: PriceRecommendationsProps) {
  const [betterDeals, setBetterDeals] = useState<BetterDeal[]>([]);
  const [alternatives, setAlternatives] = useState<AlternativeProduct[]>([]);
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"deals" | "alternatives" | "alerts">("deals");

  useEffect(() => {
    if (productId) {
      fetchBetterDeals();
      fetchPriceAlerts();
    }
    if (searchQuery) {
      fetchAlternatives();
    }
  }, [productId, searchQuery, priceLimit]);

  const fetchBetterDeals = async () => {
    if (!productId) return;
    
    try {
      setLoading(true);
      const response = await getBetterDeals(productId);
      setBetterDeals(response.better_deals);
    } catch (error) {
      console.error("Failed to fetch better deals:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAlternatives = async () => {
    if (!searchQuery) return;
    
    try {
      setLoading(true);
      const response = await getCheaperAlternatives(searchQuery, priceLimit);
      setAlternatives(response.alternatives);
    } catch (error) {
      console.error("Failed to fetch alternatives:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPriceAlerts = async () => {
    if (!productId) return;
    
    try {
      const response = await trackPriceDrops([productId]);
      setPriceAlerts(response.price_alerts);
    } catch (error) {
      console.error("Failed to fetch price alerts:", error);
    }
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("sr-RS", {
      style: "currency",
      currency: "RSD",
      minimumFractionDigits: 0,
    }).format(price);
  };

  if (!productId && !searchQuery) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Price Alerts */}
      {priceAlerts.length > 0 && (
        <Alert className="border-green-200 bg-green-50 dark:bg-green-950">
          <AlertCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800 dark:text-green-200">
            <div className="space-y-2">
              <p className="font-medium">Odličan deal pronađen!</p>
              {priceAlerts.map((alert, index) => (
                <div key={index} className="flex items-center justify-between">
                  <span>{alert.message}</span>
                  <Badge variant="secondary" className="bg-green-100 text-green-800">
                    {alert.savings.percentage}% popust
                  </Badge>
                </div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b">
        {productId && (
          <Button
            variant={activeTab === "deals" ? "default" : "ghost"}
            onClick={() => setActiveTab("deals")}
            className="flex items-center gap-2"
          >
            <TrendingDown className="h-4 w-4" />
            Bolji dealovi ({betterDeals.length})
          </Button>
        )}
        {searchQuery && (
          <Button
            variant={activeTab === "alternatives" ? "default" : "ghost"}
            onClick={() => setActiveTab("alternatives")}
            className="flex items-center gap-2"
          >
            <ShoppingCart className="h-4 w-4" />
            Jeftiniji proizvodi ({alternatives.length})
          </Button>
        )}
      </div>

      {/* Better Deals Tab */}
      {activeTab === "deals" && productId && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-green-600" />
            <h3 className="text-lg font-semibold">Bolji dealovi za sličan proizvod</h3>
          </div>
          
          {loading ? (
            <div className="grid gap-4 md:grid-cols-2">
              {[...Array(3)].map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardContent className="p-4">
                    <div className="h-4 bg-muted rounded mb-2"></div>
                    <div className="h-6 bg-muted rounded mb-2"></div>
                    <div className="h-4 bg-muted rounded"></div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : betterDeals.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {betterDeals.map((deal, index) => (
                <Card key={index} className="border-green-200 hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-sm font-medium line-clamp-2">
                        {deal.product.title}
                      </CardTitle>
                      <Badge variant="secondary" className="bg-green-100 text-green-800 ml-2">
                        -{deal.savings.percentage}%
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-2xl font-bold text-green-600">
                          {formatPrice(deal.product.price)}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {deal.product.vendor_name}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {deal.recommendation_reason}
                      </p>
                      <div className="flex items-center gap-2">
                        <Percent className="h-4 w-4 text-green-600" />
                        <span className="text-sm font-medium">
                          Ušteda: {formatPrice(deal.savings.amount)}
                        </span>
                      </div>
                      <Button 
                        asChild 
                        size="sm" 
                        className="w-full"
                      >
                        <a 
                          href={deal.product.link} 
                          target="_blank" 
                          rel="noopener noreferrer"
                        >
                          Pogledaj proizvod
                        </a>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-6 text-center">
                <TrendingDown className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  Trenutno nema boljih dealova za ovaj proizvod.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Cheaper Alternatives Tab */}
      {activeTab === "alternatives" && searchQuery && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-blue-600" />
            <h3 className="text-lg font-semibold">Jeftiniji proizvodi</h3>
            {priceLimit && (
              <Badge variant="outline">
                Do {formatPrice(priceLimit)}
              </Badge>
            )}
          </div>
          
          {loading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardContent className="p-4">
                    <div className="h-4 bg-muted rounded mb-2"></div>
                    <div className="h-6 bg-muted rounded mb-2"></div>
                    <div className="h-4 bg-muted rounded"></div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : alternatives.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {alternatives.map((alt, index) => (
                <Card key={index} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium line-clamp-2">
                      {alt.product.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xl font-bold">
                          {formatPrice(alt.product.price)}
                        </span>
                        {alt.price_analysis.is_bargain && (
                          <Badge variant="secondary" className="bg-orange-100 text-orange-800">
                            Akcija!
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {alt.product.vendor_name}
                        {alt.product.brand_name && ` • ${alt.product.brand_name}`}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {alt.recommendation_reason}
                      </p>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">
                          {alt.price_analysis.percentile}. percentil
                        </span>
                        {alt.price_analysis.vs_average < 0 && (
                          <Badge variant="outline" className="text-xs">
                            {formatPrice(Math.abs(alt.price_analysis.vs_average))} ispod proseka
                          </Badge>
                        )}
                      </div>
                      <Button 
                        asChild 
                        size="sm" 
                        variant="outline" 
                        className="w-full"
                      >
                        <a 
                          href={alt.product.link} 
                          target="_blank" 
                          rel="noopener noreferrer"
                        >
                          Pogledaj proizvod
                        </a>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-6 text-center">
                <ShoppingCart className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  Nema jeftinijih proizvoda za ovu pretragu.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}