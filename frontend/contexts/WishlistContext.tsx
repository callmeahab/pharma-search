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
  const [mounted, setMounted] = useState(false);

  // Hydrate from localStorage after mount (legitimate external store sync)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing mounted state
    setMounted(true);
    const loggedIn = localStorage.getItem("isLoggedIn") === "true";
    setIsLoggedIn(loggedIn);

    if (loggedIn) {
      const saved = localStorage.getItem("wishlist");
      if (saved) {
        try {
          setWishlist(JSON.parse(saved));
        } catch {
          // ignore parse errors
        }
      }
    }
  }, []);

  // Save wishlist to localStorage whenever it changes
  useEffect(() => {
    if (!mounted) return;

    if (isLoggedIn && wishlist.length > 0) {
      localStorage.setItem("wishlist", JSON.stringify(wishlist));
    }
  }, [wishlist, isLoggedIn, mounted]);

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
