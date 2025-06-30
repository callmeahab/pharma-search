import React from "react";
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
import { Product } from "@/types/product";
import { PriceComparison } from "./PriceComparison";
import { PriceHistoryChart } from "./PriceHistoryChart";
import { Store, Percent, X, Heart } from "lucide-react";
import { Button } from "./ui/button";
import { useWishlist } from "@/contexts/WishlistContext";
import { formatPrice } from "@/lib/utils";

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
  showPriceComparison = false,
}) => {
  const { isInWishlist, toggleWishlist } = useWishlist();

  if (!product) return null;

  // Find the lowest and highest prices
  const lowestPrice = Math.min(...product.prices.map((p) => p.price));
  const highestPrice = Math.max(...product.prices.map((p) => p.price));
  const priceDifference = highestPrice - lowestPrice;
  const savingsPercentage = Math.round((priceDifference / highestPrice) * 100);

  const isWishlisted = isInWishlist(product.id);

  const handleWishClick = (e: React.MouseEvent) => {
    e.preventDefault();
    toggleWishlist(product);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
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
            <DialogTitle className="text-2xl font-bold pr-6">
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
              <div className="aspect-square w-full overflow-hidden rounded-lg">
                <img
                  src={product.image}
                  alt={product.name}
                  className="h-full w-full object-cover"
                />
              </div>

              <div className="bg-health-light dark:bg-gray-700 rounded-lg p-4">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-300">
                      Price Range
                    </p>
                    <div className="text-xl font-bold text-health-primary dark:text-green-400">
                      {formatPrice(lowestPrice)} - {formatPrice(highestPrice)}
                    </div>
                  </div>
                  {savingsPercentage > 0 && (
                    <div className="flex flex-col items-center bg-white dark:bg-gray-800 px-4 py-2 rounded-lg shadow-sm">
                      <div className="text-sm text-gray-500 dark:text-gray-300 flex items-center">
                        <Percent size={14} className="mr-1 text-red-500" />
                        Save up to
                      </div>
                      <div className="text-xl font-bold text-red-500">
                        {savingsPercentage}%
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 flex items-center justify-center space-x-2">
                <Store className="text-health-secondary" size={20} />
                <span className="text-gray-600 dark:text-gray-300">
                  Available at {product.prices.length} pharmacies
                </span>
              </div>
            </div>

            <div>
              <DialogTabs defaultValue="comparison" className="w-full">
                <DialogTabList className="grid w-full grid-cols-2">
                  <DialogTabTrigger value="comparison">
                    Current Prices
                  </DialogTabTrigger>
                  <DialogTabTrigger value="history">
                    Price History
                  </DialogTabTrigger>
                </DialogTabList>
                <DialogTabContent value="comparison">
                  <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                    <PriceComparison
                      prices={product.prices}
                      isInCard={false}
                      productName={product.name}
                    />
                  </div>
                </DialogTabContent>
                <DialogTabContent value="history">
                  <PriceHistoryChart prices={product.prices} isInCard={false} />
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
