import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTabs,
  DialogTabList,
  DialogTabTrigger,
  DialogTabContent,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Product } from "@/types/product";
import { PriceComparison } from "./PriceComparison";
import { PriceHistoryChart } from "./PriceHistoryChart";
import { Store, Percent, X, Heart, ExternalLink } from "lucide-react";
import { useWishlist } from "@/contexts/WishlistContext";
import { formatPrice, formatVendorCount } from "@/lib/utils";
import { trackStoreClick } from "@/utils/analytics";

interface ProductDetailModalProps {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
  showPriceComparison?: boolean;
}

const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  product,
  isOpen,
  onClose,
  showPriceComparison: _showPriceComparison = false,
}) => {
  const { isInWishlist, toggleWishlist } = useWishlist();
  const [imageError, setImageError] = useState(false);

  if (!product) return null;

  const isSingleProduct = product.prices.length === 1;
  const lowestPrice = Math.min(...product.prices.map((p) => p.price));
  const highestPrice = Math.max(...product.prices.map((p) => p.price));
  const priceDifference = highestPrice - lowestPrice;
  const savingsPercentage = Math.round((priceDifference / highestPrice) * 100);

  const isWishlisted = isInWishlist(product.id);

  const handleWishClick = (e: React.MouseEvent) => {
    e.preventDefault();
    toggleWishlist(product);
  };

  const handleBuyClick = () => {
    const price = product.prices[0];
    const targetUrl = price.link || price.website || `https://www.${price.store.toLowerCase().replace(/\s+/g, "")}.com`;
    trackStoreClick(price.store, targetUrl, product.name);
    window.open(targetUrl, "_blank");
  };

  // Simplified modal for single product
  if (isSingleProduct) {
    const singlePrice = product.prices[0];
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-xl w-[95vw] sm:w-auto max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-900 shadow-2xl rounded-xl sm:rounded-2xl border border-gray-300 dark:border-gray-700 p-4 sm:p-6">
          <div className="absolute right-4 top-4 flex items-center space-x-2">
            <button
              onClick={handleWishClick}
              className="p-2 bg-white/80 dark:bg-gray-800/80 rounded-full hover:bg-white dark:hover:bg-gray-800 transition-colors"
              type="button"
            >
              <Heart
                size={20}
                className={
                  isWishlisted
                    ? "fill-red-500 text-red-500"
                    : "text-gray-500 hover:text-red-500 transition-colors"
                }
              />
            </button>
            <DialogClose className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogClose>
          </div>

          <DialogHeader className="pr-16">
            <DialogTitle className="text-lg sm:text-xl font-bold break-words">
              {product.name}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col sm:flex-row gap-5 mt-4">
            <div className="w-full sm:w-48 h-48 flex-shrink-0 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element -- external vendor images */}
              <img
                src={imageError ? "/medicine-placeholder.svg" : product.image}
                alt={product.name}
                className="h-full w-full object-contain"
                onError={() => setImageError(true)}
              />
            </div>

            <div className="flex-1 flex flex-col">
              <DialogDescription className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                {product.description}
              </DialogDescription>

              <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400 mb-4">
                {product.category && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 dark:text-gray-500">Kategorija:</span>
                    <span className="text-gray-800 dark:text-gray-200">{product.category}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 dark:text-gray-500">Prodavac:</span>
                  <span className="text-orange-600 dark:text-orange-400 font-medium">{singlePrice.store}</span>
                </div>
                {singlePrice.inStock !== undefined && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 dark:text-gray-500">Dostupnost:</span>
                    <span className={singlePrice.inStock ? "text-green-600 dark:text-green-400" : "text-red-500"}>
                      {singlePrice.inStock ? "Na stanju" : "Nije na stanju"}
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-auto pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-gray-500 dark:text-gray-400 text-sm">Cena:</span>
                  <span className="text-2xl font-bold text-health-primary dark:text-green-400">
                    {formatPrice(singlePrice.price)}
                  </span>
                </div>

                <Button
                  onClick={handleBuyClick}
                  className="w-full bg-health-primary hover:bg-health-secondary text-white"
                >
                  <ExternalLink size={16} className="mr-2" />
                  Kupi na {singlePrice.store}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Full modal for multiple products
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-6xl w-[95vw] sm:w-auto max-h-[90vh] sm:max-h-[95vh] overflow-y-auto bg-white dark:bg-gray-900 shadow-2xl drop-shadow-xl rounded-xl sm:rounded-2xl border border-gray-300 dark:border-gray-700 ring-1 ring-black/10 p-4 sm:p-6">
        <div className="absolute right-4 top-4 flex items-center space-x-2">
          <button
            onClick={handleWishClick}
            className="p-2 bg-white/80 dark:bg-gray-800/80 rounded-full hover:bg-white dark:hover:bg-gray-800 transition-colors"
            type="button"
          >
            <Heart
              size={20}
              className={
                isWishlisted
                  ? "fill-red-500 text-red-500"
                  : "text-gray-500 hover:text-red-500 transition-colors"
              }
            />
          </button>
          <DialogClose className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </div>

        <DialogHeader>
          <div className="flex flex-col space-y-2">
            <DialogTitle className="text-lg sm:text-2xl font-bold pr-20 sm:pr-24 break-words">
              {product.name}
            </DialogTitle>
            <div>
              <span className="inline-block bg-health-light text-health-primary text-sm py-1 px-3 rounded-full">
                {product.category}
              </span>
            </div>
          </div>
          <DialogDescription className="text-base text-gray-600 dark:text-gray-300 mt-2">
            {product.description}
          </DialogDescription>
        </DialogHeader>

        <div className="pt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col space-y-4">
              <div className="aspect-square w-full overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                {/* eslint-disable-next-line @next/next/no-img-element -- external vendor images */}
                <img
                  src={imageError ? "/medicine-placeholder.svg" : product.image}
                  alt={product.name}
                  className="h-full w-full object-cover"
                  onError={() => setImageError(true)}
                />
              </div>

              <div className="bg-health-light dark:bg-gray-700 rounded-xl p-3 sm:p-4 border border-gray-200 dark:border-gray-700 shadow-sm">
                <div className="flex justify-between items-center gap-2">
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-300">
                      Raspon cena
                    </p>
                    <div className="text-base sm:text-xl font-bold text-health-primary dark:text-green-400">
                      {formatPrice(lowestPrice)} - {formatPrice(highestPrice)}
                    </div>
                  </div>
                  {savingsPercentage > 0 && (
                    <div className="flex flex-col items-center bg-white dark:bg-gray-800 px-3 sm:px-4 py-2 rounded-lg shadow-sm flex-shrink-0">
                      <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-300 flex items-center">
                        <Percent size={14} className="mr-1 text-red-500" />
                        Uštedi
                      </div>
                      <div className="text-lg sm:text-xl font-bold text-red-500">
                        {savingsPercentage}%
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-gray-100 dark:bg-gray-800 rounded-xl p-4 flex items-center justify-center space-x-2 border border-gray-200 dark:border-gray-700 shadow-sm">
                <Store className="text-health-secondary" size={20} />
                <span className="text-gray-600 dark:text-gray-300">
                  Dostupno u {formatVendorCount(product.vendorCount || product.prices.length)}
                </span>
              </div>
            </div>

            <div className="flex flex-col">
              <DialogTabs
                defaultValue="comparison"
                className="w-full flex flex-col"
              >
                <DialogTabList className="grid w-full grid-cols-2">
                  <DialogTabTrigger value="comparison">
                    Trenutne cene
                  </DialogTabTrigger>
                  <DialogTabTrigger value="history">
                    Istorija cena
                  </DialogTabTrigger>
                </DialogTabList>
                <DialogTabContent value="comparison">
                  <div className="bg-gray-50 dark:bg-gray-800 p-3 sm:p-4 rounded-xl shadow-md border border-gray-200 dark:border-gray-700">
                    <PriceComparison
                      prices={product.prices}
                      isInCard={false}
                      productName={product.name}
                    />
                  </div>
                </DialogTabContent>
                <DialogTabContent value="history">
                  <div className="bg-gray-50 dark:bg-gray-800 p-3 sm:p-4 rounded-xl shadow-md border border-gray-200 dark:border-gray-700">
                    <PriceHistoryChart
                      prices={product.prices}
                      isInCard={false}
                    />
                  </div>
                </DialogTabContent>
              </DialogTabs>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProductDetailModal;
