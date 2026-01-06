"use client";

import React, { useState, useEffect } from "react";
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
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from "@/components/ui/drawer";
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

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);

    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [query]);

  return matches;
}

const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  product,
  isOpen,
  onClose,
  showPriceComparison: _showPriceComparison = false,
}) => {
  const { isInWishlist, toggleWishlist } = useWishlist();
  const [imageError, setImageError] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 640px)");

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
    const targetUrl = price.link || `https://www.${price.store.toLowerCase().replace(/\s+/g, "")}.com`;
    trackStoreClick(price.store, targetUrl, product.name);
    window.open(targetUrl, "_blank");
  };

  // Mobile content for drawer
  const MobileContent = () => (
    <div className="px-4 pb-6">
      {/* Header with close and wishlist */}
      <div className="flex items-start justify-between mb-3">
        <DrawerTitle className="text-lg font-bold pr-16 break-words">
          {product.name}
        </DrawerTitle>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleWishClick}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
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
          <DrawerClose className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <X className="h-5 w-5" />
          </DrawerClose>
        </div>
      </div>

      {isSingleProduct ? (
        // Single product mobile layout
        <>
          <div className="flex gap-3 mb-4">
            <div className="w-24 h-24 flex-shrink-0 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageError ? "/medicine-placeholder.svg" : product.image}
                alt={product.name}
                className="h-full w-full object-contain"
                onError={() => setImageError(true)}
              />
            </div>
            <div className="flex-1 flex flex-col justify-center">
              <p className="text-orange-600 dark:text-orange-400 font-medium text-sm mb-1">
                {product.prices[0].store}
              </p>
              <p className="text-2xl font-bold text-health-primary dark:text-green-400">
                {formatPrice(lowestPrice)}
              </p>
            </div>
          </div>
          <Button
            onClick={handleBuyClick}
            className="w-full bg-health-primary hover:bg-health-secondary text-white"
          >
            <ExternalLink size={16} className="mr-2" />
            Kupi
          </Button>
        </>
      ) : (
        // Multiple products mobile layout
        <>
          <div className="flex gap-3 mb-3">
            <div className="w-20 h-20 flex-shrink-0 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageError ? "/medicine-placeholder.svg" : product.image}
                alt={product.name}
                className="h-full w-full object-contain"
                onError={() => setImageError(true)}
              />
            </div>
            <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-xl p-3 border border-gray-200 dark:border-gray-700">
              <div className="flex justify-between items-center gap-2 h-full">
                <div className="min-w-0">
                  <p className="text-xs text-gray-500 dark:text-gray-300">Raspon cena</p>
                  <div className="text-base font-bold text-health-primary dark:text-green-400">
                    {formatPrice(lowestPrice)} - {formatPrice(highestPrice)}
                  </div>
                </div>
                {savingsPercentage > 0 && (
                  <div className="flex items-center bg-gray-200 dark:bg-gray-800 px-2 py-1 rounded-lg flex-shrink-0">
                    <Percent size={12} className="mr-1 text-red-500" />
                    <span className="text-base font-bold text-red-500">{savingsPercentage}%</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-xl border border-gray-200 dark:border-gray-700 max-h-[50vh] overflow-y-auto">
            <PriceComparison
              prices={product.prices}
              isInCard={false}
              productName={product.name}
            />
          </div>
        </>
      )}
    </div>
  );

  // Mobile: use Drawer
  if (!isDesktop) {
    return (
      <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DrawerContent className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700">
          <DrawerHeader className="sr-only">
            <DrawerTitle>{product.name}</DrawerTitle>
          </DrawerHeader>
          <MobileContent />
        </DrawerContent>
      </Drawer>
    );
  }

  // Desktop: use Dialog
  // Single product desktop
  if (isSingleProduct) {
    const singlePrice = product.prices[0];
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-xl w-[95vw] max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-900 shadow-2xl rounded-2xl border border-gray-300 dark:border-gray-700 p-6">
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
            <DialogTitle className="text-xl font-bold break-words">
              {product.name}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-row gap-5 mt-4">
            <div className="w-48 h-48 flex-shrink-0 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
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
                    <span className="text-gray-500">Kategorija:</span>
                    <span className="text-gray-800 dark:text-gray-200">{product.category}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">Prodavac:</span>
                  <span className="text-orange-600 dark:text-orange-400 font-medium">{singlePrice.store}</span>
                </div>
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

  // Multiple products desktop
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-6xl w-[95vw] max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-900 shadow-2xl drop-shadow-xl rounded-2xl border border-gray-300 dark:border-gray-700 ring-1 ring-black/10 p-6">
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

        <DialogHeader>
          <DialogTitle className="text-2xl font-bold pr-24 break-words">
            {product.name}
          </DialogTitle>
          <div className="mt-2">
            <span className="inline-block bg-health-light dark:bg-gray-700 text-health-primary dark:text-green-400 text-sm py-1 px-3 rounded-full">
              {product.category}
            </span>
          </div>
          <DialogDescription className="text-base text-gray-600 dark:text-gray-300 mt-2">
            {product.description}
          </DialogDescription>
        </DialogHeader>

        <div className="pt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col space-y-4">
              <div className="aspect-square w-full overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageError ? "/medicine-placeholder.svg" : product.image}
                  alt={product.name}
                  className="h-full w-full object-cover"
                  onError={() => setImageError(true)}
                />
              </div>

              <div className="bg-health-light dark:bg-gray-700 rounded-xl p-4 border border-gray-200 dark:border-gray-700 shadow-sm">
                <div className="flex justify-between items-center gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-500 dark:text-gray-300">Raspon cena</p>
                    <div className="text-xl font-bold text-health-primary dark:text-green-400">
                      {formatPrice(lowestPrice)} - {formatPrice(highestPrice)}
                    </div>
                  </div>
                  {savingsPercentage > 0 && (
                    <div className="flex flex-col items-center bg-white dark:bg-gray-800 px-4 py-2 rounded-lg shadow-sm flex-shrink-0">
                      <div className="text-sm text-gray-500 dark:text-gray-300 flex items-center">
                        <Percent size={14} className="mr-1 text-red-500" />
                        Uštedi
                      </div>
                      <div className="text-xl font-bold text-red-500">
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
              <DialogTabs defaultValue="comparison" className="w-full flex flex-col">
                <DialogTabList className="grid w-full grid-cols-2">
                  <DialogTabTrigger value="comparison">Trenutne cene</DialogTabTrigger>
                  <DialogTabTrigger value="history">Istorija cena</DialogTabTrigger>
                </DialogTabList>
                <DialogTabContent value="comparison">
                  <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-xl shadow-md border border-gray-200 dark:border-gray-700">
                    <PriceComparison
                      prices={product.prices}
                      isInCard={false}
                      productName={product.name}
                    />
                  </div>
                </DialogTabContent>
                <DialogTabContent value="history">
                  <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-xl shadow-md border border-gray-200 dark:border-gray-700">
                    <PriceHistoryChart prices={product.prices} isInCard={false} />
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
