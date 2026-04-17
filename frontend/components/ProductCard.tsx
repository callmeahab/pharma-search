import React, { useState } from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight, ExternalLink, Heart, Store, TrendingDown } from "lucide-react";
import { Product } from "@/types/product";
import ProductDetailModal from "./ProductDetailModal";
import { trackProductClick, trackStoreClick } from "@/utils/analytics";
import { useWishlist } from "@/contexts/WishlistContext";
import { formatPrice, pluralizeSr } from "@/lib/utils";

interface ProductCardProps {
  product: Product;
}

const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
  const [showModal, setShowModal] = useState(false);
  const [showPriceComparison, setShowPriceComparison] = useState(false);
  const [imageError, setImageError] = useState(false);
  const { isInWishlist, toggleWishlist } = useWishlist();

  const isOfferView = product.displayMode === "offer";
  const primaryOffer = product.primaryOffer ?? product.prices[0];
  const comparison = product.comparisonContext;

  const lowestPrice =
    comparison?.lowestPrice ?? Math.min(...product.prices.map((price) => price.price));
  const highestPrice =
    comparison?.highestPrice ?? Math.max(...product.prices.map((price) => price.price));
  const priceDifference = Math.max(0, highestPrice - lowestPrice);
  const savingsPercentage =
    highestPrice > 0 ? Math.round((priceDifference / highestPrice) * 100) : 0;
  const vendorCount = comparison?.vendorCount || product.vendorCount || product.prices.length;
  const hiddenOfferCount = comparison?.hiddenOfferCount || 0;
  const bestVendorName = comparison?.bestVendorName || product.prices[0]?.store;
  const canCompare = vendorCount > 1 && product.prices.length > 1;
  const isWishlisted = isInWishlist(product.id);
  const vendorWord = pluralizeSr(vendorCount, "apoteka", "apoteke", "apoteka");

  const openTarget = (store: string, link?: string) => {
    const targetUrl =
      link || `https://www.${store.toLowerCase().replace(/\s+/g, "")}.com`;
    trackStoreClick(store, targetUrl, product.name);
    window.open(targetUrl, "_blank");
  };

  const handleBuyClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!primaryOffer) {
      return;
    }
    openTarget(primaryOffer.store, primaryOffer.link);
  };

  const handleCompareClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canCompare) {
      return;
    }
    setShowPriceComparison(true);
    setShowModal(true);
    trackProductClick(product.id, product.name, product.category);
  };

  const handleCardClick = () => {
    if (isOfferView || !canCompare) {
      if (primaryOffer) {
        openTarget(primaryOffer.store, primaryOffer.link);
      }
      return;
    }

    setShowPriceComparison(true);
    setShowModal(true);
    trackProductClick(product.id, product.name, product.category);
  };

  const handleWishClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleWishlist(product);
  };

  return (
    <>
      <Card
        className="price-card overflow-hidden cursor-pointer hover:shadow-md transition-shadow h-full"
        onClick={handleCardClick}
      >
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- external vendor images */}
          <img
            src={imageError ? "/medicine-placeholder.svg" : product.image}
            alt={product.name}
            className="w-full h-48 object-contain"
            onError={() => setImageError(true)}
          />
          {canCompare && savingsPercentage > 0 && (
            <div className="absolute top-2 right-2 bg-red-500 text-white px-2 py-1 rounded-full text-xs font-bold">
              Ušteda do {savingsPercentage}%
            </div>
          )}
          <button
            className="absolute top-2 left-2 p-2 bg-white/80 dark:bg-gray-800/80 rounded-full hover:bg-white dark:hover:bg-gray-800 transition-colors"
            onClick={handleWishClick}
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
        </div>

        <CardContent className="pt-4 flex flex-col gap-3 flex-1">
          <div>
            <h3 className="text-lg font-semibold mb-1 line-clamp-2">{product.name}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
              {product.description}
            </p>
          </div>

          {isOfferView ? (
            <>
              <div>
                <p className="text-sm text-orange-600 dark:text-orange-400 font-medium mb-1">
                  {primaryOffer?.store}
                </p>
                <div className="flex items-end justify-between gap-3">
                  <p className="price-tag text-xl">{formatPrice(primaryOffer?.price || 0)}</p>
                  {canCompare && (
                    <span className="text-xs text-gray-500 dark:text-gray-400 text-right">
                      {vendorCount} {vendorWord}
                    </span>
                  )}
                </div>
              </div>

              {canCompare && (
                <div className="rounded-xl border border-health-light bg-health-light/40 dark:border-gray-700 dark:bg-gray-800/50 p-3 space-y-1">
                  <div className="flex items-center gap-2 text-xs font-medium text-health-primary dark:text-green-300">
                    <TrendingDown size={14} />
                    <span>
                      {comparison?.isBestOffer
                        ? "Ovo je najniža cena u grupi"
                        : `Najbolja cena je ${formatPrice(lowestPrice)}`}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-200">
                    {comparison?.isBestOffer
                      ? `Isti proizvod je dostupan u još ${Math.max(vendorCount - 1, 0)} ${pluralizeSr(
                          Math.max(vendorCount - 1, 0),
                          "apoteci",
                          "apoteke",
                          "apoteka"
                        )}.`
                      : `Najpovoljnije trenutno nudi ${bestVendorName}.`}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Raspon cena: {formatPrice(lowestPrice)} - {formatPrice(highestPrice)}
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Već od</p>
                  <p className="price-tag">{formatPrice(lowestPrice)}</p>
                </div>
                <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                  <Store size={16} className="mr-1 text-health-secondary" />
                  <span>
                    {vendorCount} {vendorWord}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 bg-white/60 dark:bg-gray-800/40 space-y-1">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
                  Najpovoljnije trenutno: {bestVendorName}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  +{formatPrice(priceDifference)} do najskuplje ponude
                </p>
                {hiddenOfferCount > 0 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Prikazana je najniža cena po apoteci, bez duplih listinga.
                  </p>
                )}
              </div>
            </>
          )}
        </CardContent>

        <CardFooter className="pt-0">
          {isOfferView ? (
            canCompare ? (
              <div className="flex w-full gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={handleCompareClick}
                >
                  <ArrowLeftRight size={16} className="mr-2" />
                  Uporedi
                </Button>
                <Button
                  className="flex-1 bg-health-primary hover:bg-health-secondary text-white"
                  onClick={handleBuyClick}
                >
                  <ExternalLink size={16} className="mr-2" />
                  Kupi
                </Button>
              </div>
            ) : (
              <Button
                className="w-full bg-health-primary hover:bg-health-secondary text-white"
                onClick={handleBuyClick}
              >
                <ExternalLink size={16} className="mr-2" />
                Kupi
              </Button>
            )
          ) : canCompare ? (
            <Button
              variant="outline"
              className="w-full text-health-primary dark:text-green-400 hover:bg-health-light dark:hover:bg-gray-700/50 dark:hover:text-green-300 border-health-light dark:border-gray-600 bg-health-gray/50 dark:bg-gray-800/30"
              onClick={handleCompareClick}
            >
              <ArrowLeftRight size={16} className="mr-2" />
              Uporedi {vendorCount} {vendorWord}
            </Button>
          ) : (
            <Button
              className="w-full bg-health-primary hover:bg-health-secondary text-white"
              onClick={handleBuyClick}
            >
              <ExternalLink size={16} className="mr-2" />
              Kupi
            </Button>
          )}
        </CardFooter>
      </Card>

      {canCompare && (
        <ProductDetailModal
          product={product}
          isOpen={showModal}
          onClose={() => {
            setShowModal(false);
            setShowPriceComparison(false);
          }}
          showPriceComparison={showPriceComparison}
        />
      )}
    </>
  );
};

export default ProductCard;
