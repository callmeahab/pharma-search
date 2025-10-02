export interface Price {
  store: string;
  price: number;
  inStock: boolean;
  link?: string;
  title?: string; // Individual product title for this price entry
  is_best_deal?: boolean;
  diff_from_avg?: number;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  category: string;
  image: string;
  prices: Price[];
  vendorCount?: number;
  productCount?: number;
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
  product_count?: number;
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
    description: `${group.product_count || 0} proizvoda u ${group.vendor_count} apoteka`,
    category: "", // No category since we removed badges
    image: backendProduct.thumbnail || "/medicine-placeholder.svg",
    prices: [
      {
        store: backendProduct.vendor_name,
        price: backendProduct.price,
        inStock: true,
        link: backendProduct.link,
        title: backendProduct.title, // Include individual product title
      },
    ],
    vendorCount: group.vendor_count,
    productCount: group.product_count,
  };
}

export function convertProductGroupToProducts(group: ProductGroup): Product[] {
  // Create one main product representing the group
  // Use the first product's title as the main name, or fall back to normalized name
  const firstProduct = group.products[0];

  // Find the most common or representative title
  // Use the actual product title instead of normalized name
  const productTitle = firstProduct?.title
    ? humanizeTitle(firstProduct.title)
    : "Nepoznat proizvod";

  const mainProduct: Product = {
    id: group.id,
    name: productTitle,
    description: `${group.product_count || 0} proizvoda u ${group.vendor_count} apoteka`,
    category: "",
    image: firstProduct?.thumbnail || "/medicine-placeholder.svg",
    prices: group.products.map((p) => ({
      store: p.vendor_name,
      price: p.price,
      inStock: true,
      link: p.link,
      title: p.title, // Include individual product title
    })),
    vendorCount: group.vendor_count,
    productCount: group.product_count,
  };

  return [mainProduct];
}
