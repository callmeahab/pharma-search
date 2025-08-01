"use client";

import React from "react";
import { Heart, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useWishlist } from "@/contexts/WishlistContext";
import { formatPrice } from "@/lib/utils";

const UserWishlist = () => {
  const { wishlist, toggleWishlist } = useWishlist();

  if (wishlist.length === 0) {
    return (
      <div className="text-center py-12">
        <Heart className="mx-auto h-12 w-12 text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          Vaš spisak želja je prazan
        </h3>
        <p className="text-gray-500 dark:text-gray-400 mb-6">
          Dodajte proizvode u spisak želja da biste ih kasnije pratili
        </p>
        <Link href="/">
          <Button className="bg-health-primary hover:bg-health-secondary text-white">
            Pretražite proizvode
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          Vaš spisak želja
        </h2>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {wishlist.length} proizvoda
        </span>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {wishlist.map((product) => (
          <div
            key={product.id}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden"
          >
            <div className="aspect-w-16 aspect-h-9">
              <img
                src={product.image}
                alt={product.name}
                className="w-full h-48 object-cover"
              />
            </div>

            <div className="p-4">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
                {product.name}
              </h3>

              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">
                {product.description}
              </p>

              <div className="flex items-center justify-between mb-3">
                <span className="text-lg font-bold text-gray-900 dark:text-white">
                  {formatPrice(Math.min(...product.prices.map((p) => p.price)))}
                </span>
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => toggleWishlist(product)}
                >
                  <Heart className="h-4 w-4 mr-1 fill-current" />
                  Ukloni
                </Button>

                <Link href={`/?search=${encodeURIComponent(product.name)}`}>
                  <Button
                    size="sm"
                    className="bg-health-primary hover:bg-health-secondary text-white"
                  >
                    <ExternalLink className="h-4 w-4 mr-1" />
                    Pogledaj
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default UserWishlist;
