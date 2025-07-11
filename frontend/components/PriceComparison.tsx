import React from "react";
import { Price } from "@/types/product";
import { cn, formatPrice } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ExternalLink } from "lucide-react";
import { trackStoreClick } from "@/utils/analytics";
import { PriceComparisonProduct } from "@/lib/api";

interface PriceComparisonProps {
  prices?: Price[];
  products?: PriceComparisonProduct[];
  isInCard?: boolean; // Prop to identify if it's in a card on home screen
  productName?: string; // Add productName as an optional prop
}

export const PriceComparison: React.FC<PriceComparisonProps> = ({
  prices,
  products,
  isInCard = false,
  productName,
}) => {
  // Handle both legacy prices and new products format
  const priceData = products 
    ? products.map(product => ({
        store: product.vendor.name,
        price: product.price,
        inStock: true,
        link: product.link,
        website: product.vendor.website,
        is_best_deal: product.price_analysis.is_best_deal,
        is_worst_deal: product.price_analysis.is_worst_deal,
        diff_from_avg: product.price_analysis.diff_from_avg,
      }))
    : prices || [];

  // Sort prices from lowest to highest
  const sortedPrices = [...priceData].sort((a, b) => a.price - b.price);
  const lowestPrice = sortedPrices[0]?.price || 0;

  // For large number of pharmacies, we'll display them in a grid or scrollable area
  const displayLimit = isInCard ? 5 : 20;
  const hasMorePrices = sortedPrices.length > displayLimit;
  const displayPrices = hasMorePrices
    ? sortedPrices.slice(0, displayLimit)
    : sortedPrices;

  const handleStoreClick = (price: any) => {
    // Track store link click
    trackStoreClick(price.store, productName || null);

    console.log(`Navigating to ${price.store} website`);
    
    // Use the actual product link if available, otherwise fallback to generic website
    const targetUrl = price.link || price.website || `https://www.${price.store.toLowerCase().replace(/\s+/g, "")}.com`;
    window.open(targetUrl, "_blank");
  };

  const PriceList = () => (
    <div
      className={cn(
        "space-y-2",
        sortedPrices.length > 8 &&
          !isInCard &&
          "grid grid-cols-1 md:grid-cols-2 gap-2 space-y-0"
      )}
    >
      {displayPrices.map((price, index) => (
        <button
          key={`${price.store}-${index}`}
          onClick={() => handleStoreClick(price)}
          className={cn(
            "flex justify-between items-center p-3 rounded transition-colors duration-200 w-full text-left",
            price.is_best_deal || index === 0
              ? "bg-health-light dark:bg-green-800/30 border-l-4 border-health-primary dark:border-green-500"
              : "hover:bg-gray-50 dark:hover:bg-gray-700 border-l-4 border-transparent"
          )}
          aria-label={`Visit ${price.store} website`}
        >
          <div className="flex items-center">
            <div
              className={cn(
                "w-6 h-6 flex items-center justify-center mr-2 rounded-full border",
                price.is_best_deal || index === 0
                  ? "bg-health-primary text-white border-health-primary dark:bg-green-600 dark:border-green-500"
                  : "bg-white dark:bg-gray-600 border-gray-200 dark:border-gray-700"
              )}
            >
              {index + 1}
            </div>
            <span className="font-medium dark:text-gray-200 hover:text-health-primary dark:hover:text-green-300 flex items-center group">
              {price.store}
              <ExternalLink
                size={14}
                className="ml-1 inline-block opacity-60 group-hover:opacity-100 transition-opacity"
              />
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span
              className={cn(
                "font-semibold",
                price.is_best_deal || index === 0
                  ? "text-health-primary dark:text-green-300"
                  : "dark:text-gray-200"
              )}
            >
              {formatPrice(price.price)}
            </span>

            {index > 0 && (
              <span
                className={cn(
                  "text-xs",
                  price.price - lowestPrice > lowestPrice * 0.3
                    ? "text-red-500 dark:text-red-400 font-medium"
                    : "text-gray-500 dark:text-gray-400"
                )}
              >
                +{formatPrice(price.price - lowestPrice)}
              </span>
            )}
            
            {price.diff_from_avg && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {price.diff_from_avg > 0 ? '+' : ''}{formatPrice(price.diff_from_avg)} from avg
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  );

  return (
    <div className="w-full mt-2">
      <h4 className="text-lg font-medium mb-3 dark:text-gray-200">
        Price Comparison
      </h4>

      {sortedPrices.length > 10 ? (
        <ScrollArea
          className={cn("w-full rounded-md", !isInCard && "h-[500px]")}
        >
          <PriceList />
        </ScrollArea>
      ) : (
        <div>
          <PriceList />
        </div>
      )}

      {hasMorePrices && (
        <div className="text-xs text-center mt-2 text-gray-500 dark:text-gray-400">
          {isInCard
            ? `Click to see all ${priceData.length} stores`
            : `Showing ${displayPrices.length} of ${priceData.length} stores`}
        </div>
      )}
    </div>
  );
};
