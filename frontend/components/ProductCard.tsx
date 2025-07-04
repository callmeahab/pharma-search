import React, { useState } from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Store, Heart } from "lucide-react";
import { Product } from "@/types/product";
import ProductDetailModal from "./ProductDetailModal";
import { trackProductClick } from "@/utils/analytics";
import { useWishlist } from "@/contexts/WishlistContext";
import { formatPrice } from "@/lib/utils";

interface ProductCardProps {
  product: Product;
}

const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
  const [showModal, setShowModal] = useState(false);
  const [showPriceComparison, setShowPriceComparison] = useState(false);
  const { isInWishlist, toggleWishlist } = useWishlist();

  // Find the lowest price
  const lowestPrice = Math.min(...product.prices.map((p) => p.price));
  const highestPrice = Math.max(...product.prices.map((p) => p.price));
  const priceDifference = highestPrice - lowestPrice;
  const savingsPercentage = Math.round((priceDifference / highestPrice) * 100);

  // Category badge colors
  const categoryColors: Record<string, string> = {
    Vitamins: "bg-blue-100 text-blue-800",
    Supplements: "bg-purple-100 text-purple-800",
    Medications: "bg-red-100 text-red-800",
    Wellness: "bg-green-100 text-green-800",
    Fitness: "bg-orange-100 text-orange-800",
    Natural: "bg-emerald-100 text-emerald-800",
    Baby: "bg-pink-100 text-pink-800",
    Food: "bg-yellow-100 text-yellow-800",
    Medical: "bg-indigo-100 text-indigo-800",
    Lab: "bg-gray-100 text-gray-800",
  };

  // Default color if category not found in mapping
  const badgeClass =
    categoryColors[product.category] || "bg-gray-100 text-gray-800";

  const handleCompareClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowPriceComparison(true);
    setShowModal(true);

    // Track price comparison click
    trackProductClick(product.id, product.name, product.category);
  };

  const handleCardClick = () => {
    setShowModal(true);

    // Track product card click
    trackProductClick(product.id, product.name, product.category);
  };

  const handleWishClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleWishlist(product);
  };

  const isWishlisted = isInWishlist(product.id);

  return (
    <>
      <Card
        className="price-card overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
        onClick={handleCardClick}
      >
        <div className="relative">
          <img
            src={product.image}
            alt={product.name}
            className="w-full h-48 object-cover"
          />
          {savingsPercentage > 10 && (
            <div className="absolute top-2 right-2 bg-red-500 text-white px-2 py-1 rounded-full text-xs font-bold">
              Save up to {savingsPercentage}%
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

        <CardContent className="pt-4">
          <div className="mb-2">
            <span
              className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${badgeClass}`}
            >
              {product.category}
            </span>
          </div>
          <h3 className="text-lg font-semibold mb-1">{product.name}</h3>
          <p className="text-sm text-gray-500 mb-3">{product.description}</p>
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm text-gray-500">From</p>
              <p className="price-tag">{formatPrice(lowestPrice)}</p>
            </div>
            <div className="flex items-center text-sm text-gray-500">
              <Store size={16} className="mr-1 text-health-secondary" />
              <span>{product.prices.length} stores</span>
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col pt-0">
          <Button
            variant="outline"
            disabled={product.prices.length <= 1}
            className="w-full text-health-primary dark:text-green-400 hover:bg-health-light dark:hover:bg-gray-700/50 dark:hover:text-green-300 border-health-light dark:border-gray-600 mb-2 bg-health-gray/50 dark:bg-gray-800/30"
            onClick={handleCompareClick}
          >
            Compare prices
          </Button>
        </CardFooter>
      </Card>

      <ProductDetailModal
        product={product}
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          setShowPriceComparison(false);
        }}
        showPriceComparison={showPriceComparison}
      />
    </>
  );
};

export default ProductCard;
