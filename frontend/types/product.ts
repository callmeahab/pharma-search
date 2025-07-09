export interface Price {
  store: string;
  price: number;
  inStock: boolean;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  category: string;
  image: string;
  prices: Price[];
}

// Backend API interfaces
export interface BackendProduct {
  id: string;
  title: string;
  price: number;
  vendor_id: string;
  vendor_name: string;
  link: string;
  thumbnail?: string;
}

export interface ProductGroup {
  id: string;
  normalized_name: string;
  dosage_value?: number;
  dosage_unit?: string;
  products: BackendProduct[];
  price_range: {
    min: number;
    max: number;
    avg: number;
  };
  vendor_count: number;
}

export interface SearchResult {
  groups: ProductGroup[];
  search_type_used?: "auto" | "similarity" | "database";
  total: number;
  offset: number;
  limit: number;
}

import { humanizeTitle } from "@/lib/utils";

// Utility functions to convert between formats
export function convertBackendProductToProduct(
  backendProduct: BackendProduct,
  group: ProductGroup
): Product {
  return {
    id: backendProduct.id,
    name: humanizeTitle(backendProduct.title),
    description: `Available at ${group.vendor_count} pharmacies`,
    category: "Supplements", // Default category since backend doesn't provide this
    image: backendProduct.thumbnail || "/placeholder.svg",
    prices: [
      {
        store: backendProduct.vendor_name,
        price: backendProduct.price,
        inStock: true,
      },
    ],
  };
}

export function convertProductGroupToProducts(group: ProductGroup): Product[] {
  // Create one main product representing the group
  // Use the first product's title as the main name, or fall back to normalized name
  const firstProduct = group.products[0];
  
  // Find the most common or representative title
  // For now, use the first product's title, but this could be enhanced
  // to find the most frequent title or the shortest/clearest one
  const productTitle = firstProduct?.title 
    ? humanizeTitle(firstProduct.title)
    : humanizeTitle(group.normalized_name);
  
  const mainProduct: Product = {
    id: group.id,
    name: productTitle,
    description: `Available at ${group.vendor_count} pharmacies`,
    category: "Supplements",
    image: firstProduct?.thumbnail || "/placeholder.svg",
    prices: group.products.map((p) => ({
      store: p.vendor_name,
      price: p.price,
      inStock: true,
    })),
  };

  return [mainProduct];
}
