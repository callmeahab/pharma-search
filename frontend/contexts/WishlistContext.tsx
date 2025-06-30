"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { Product } from "../types/product";
import { toast } from "../hooks/use-toast";

type WishlistContextType = {
  wishlist: Product[];
  isInWishlist: (productId: string) => boolean;
  toggleWishlist: (product: Product) => void;
};

const WishlistContext = createContext<WishlistContextType | undefined>(
  undefined
);

export const useWishlist = () => {
  const context = useContext(WishlistContext);
  if (!context) {
    throw new Error("useWishlist must be used within a WishlistProvider");
  }
  return context;
};

export const WishlistProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [wishlist, setWishlist] = useState<Product[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isClient, setIsClient] = useState(false);

  // Set client flag and check if user is logged in
  useEffect(() => {
    setIsClient(true);
    // This is a simple simulation - in a real app, you'd use your auth system
    const userLoggedIn = localStorage.getItem("isLoggedIn") === "true";
    setIsLoggedIn(userLoggedIn);
  }, []);

  // Load wishlist from localStorage on initial render
  useEffect(() => {
    if (!isClient) return;

    const savedWishlist = localStorage.getItem("wishlist");
    if (savedWishlist && isLoggedIn) {
      try {
        setWishlist(JSON.parse(savedWishlist));
      } catch (error) {
        console.error("Failed to parse wishlist:", error);
      }
    }
  }, [isLoggedIn, isClient]);

  // Save wishlist to localStorage whenever it changes
  useEffect(() => {
    if (!isClient) return;

    if (isLoggedIn && wishlist.length > 0) {
      localStorage.setItem("wishlist", JSON.stringify(wishlist));
    }
  }, [wishlist, isLoggedIn, isClient]);

  const isInWishlist = (productId: string) => {
    return wishlist.some((item) => item.id === productId);
  };

  const toggleWishlist = (product: Product) => {
    if (!isLoggedIn) {
      toast({
        title: "Potrebno je da se prijavite",
        description:
          "Molimo vas da se prijavite kako biste koristili funkciju liste želja.",
        variant: "destructive",
      });
      return;
    }

    setWishlist((prevWishlist) => {
      if (isInWishlist(product.id)) {
        // Remove from wishlist
        const newWishlist = prevWishlist.filter(
          (item) => item.id !== product.id
        );
        toast({
          title: "Uklonjeno iz liste želja",
          description: `${product.name} je uklonjen iz vaše liste želja.`,
        });
        return newWishlist;
      } else {
        // Add to wishlist
        toast({
          title: "Dodato u listu želja",
          description: `Dobićete obaveštenje kada cena proizvoda ${product.name} padne.`,
        });
        return [...prevWishlist, product];
      }
    });
  };

  const value = {
    wishlist,
    isInWishlist,
    toggleWishlist,
  };

  return (
    <WishlistContext.Provider value={value}>
      {children}
    </WishlistContext.Provider>
  );
};
