"use client";

import type { ReactNode } from "react";
import { useAuth } from "./AuthContext";
import type { Product } from "@/types/product";

// Compatibility adapter: every heart now uses the same authenticated watch API.
// Original local-storage entries are retained for explicit review in the profile.
export function WishlistProvider({ children }: { children: ReactNode }) { return children; }
export function useWishlist() {
  const { watches, isWatched, toggleWatch } = useAuth();
  const wishlist: Product[] = watches.map(watch => ({ id: watch.group_key, historyGroupKey: watch.group_key, name: watch.display_name || "Praćeni proizvod", description: watch.needs_review ? "Izaberite tačan proizvod i pakovanje." : "Praćenje cene", category: "", image: watch.thumbnail || "/medicine-placeholder.svg", prices: watch.last_price ? [{ store: watch.last_vendor || "", price: watch.last_price }] : [], comparable: false }));
  return { wishlist, isInWishlist: isWatched, toggleWishlist: (product: Product) => toggleWatch({ groupKey: product.historyGroupKey || product.id, displayName: product.name, thumbnail: product.image }) };
}
