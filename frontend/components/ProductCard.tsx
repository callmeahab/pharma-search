import React, { useState } from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Store, Heart, ExternalLink } from "lucide-react";
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

  const isSingleProduct = product.prices.length === 1;
  const lowestPrice = Math.min(...product.prices.map((p) => p.price));
  const highestPrice = Math.max(...product.prices.map((p) => p.price));
  const priceDifference = highestPrice - lowestPrice;
  const savingsPercentage = Math.round((priceDifference / highestPrice) * 100);

  const handleBuyClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const price = product.prices[0];
    const targetUrl = price.link || `https://www.${price.store.toLowerCase().replace(/\s+/g, "")}.com`;
    trackStoreClick(price.store, targetUrl, product.name);
    window.open(targetUrl, "_blank");
  };

  const handleCompareClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowPriceComparison(true);
    setShowModal(true);
    trackProductClick(product.id, product.name, product.category);
  };

  const handleCardClick = () => {
    if (isSingleProduct) {
      // For single product, go directly to store
      const price = product.prices[0];
      const targetUrl = price.link || `https://www.${price.store.toLowerCase().replace(/\s+/g, "")}.com`;
      trackStoreClick(price.store, targetUrl, product.name);
      window.open(targetUrl, "_blank");
    } else {
      setShowModal(true);
      trackProductClick(product.id, product.name, product.category);
    }
  };

  const handleWishClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleWishlist(product);
  };

  const isWishlisted = isInWishlist(product.id);
  const vendorCount = product.vendorCount || product.prices.length;
  const vendorWord = pluralizeSr(vendorCount, "apoteka", "apoteke", "apoteka");

  return (
    <>
      <Card
        className="price-card overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
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
          {!isSingleProduct && savingsPercentage > 10 && (
            <div className="absolute top-2 right-2 bg-red-500 text-white px-2 py-1 rounded-full text-xs font-bold">
              Uštedi do {savingsPercentage}%
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

        <CardContent className="pt-4 flex flex-col">
          <h3 className="text-lg font-semibold mb-1 line-clamp-2 flex-shrink-0">{product.name}</h3>

          {isSingleProduct ? (
            // Single product: show vendor and direct price
            <>
              <p className="text-sm text-orange-600 dark:text-orange-400 font-medium mb-2">
                {product.prices[0].store}
              </p>
              <div className="flex justify-between items-center">
                <p className="price-tag text-xl">{formatPrice(lowestPrice)}</p>
              </div>
            </>
          ) : (
            // Multiple products: show price range and vendor count
            <>
              <p className="text-sm text-gray-500 mb-3 line-clamp-1 flex-1">
                Dostupno u {vendorCount} {vendorWord}
              </p>
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm text-gray-500">Već od</p>
                  <p className="price-tag">{formatPrice(lowestPrice)}</p>
                </div>
                <div className="flex items-center text-sm text-gray-500">
                  <Store size={16} className="mr-1 text-health-secondary" />
                  <span>{vendorCount} {vendorWord}</span>
                </div>
              </div>
            </>
          )}
        </CardContent>

        <CardFooter className="flex flex-col pt-0">
          {isSingleProduct ? (
            <Button
              className="w-full bg-health-primary hover:bg-health-secondary text-white"
              onClick={handleBuyClick}
            >
              <ExternalLink size={16} className="mr-2" />
              Kupi
            </Button>
          ) : (
            <Button
              variant="outline"
              className="w-full text-health-primary dark:text-green-400 hover:bg-health-light dark:hover:bg-gray-700/50 dark:hover:text-green-300 border-health-light dark:border-gray-600 bg-health-gray/50 dark:bg-gray-800/30"
              onClick={handleCompareClick}
            >
              Uporedi cene
            </Button>
          )}
        </CardFooter>
      </Card>

      {!isSingleProduct && (
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
