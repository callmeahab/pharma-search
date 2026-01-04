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

// Backend API interfaces - flat product from search
export interface BackendProduct {
  id: string;
  title: string;
  price: number;
  vendor_id: string;
  vendor_name: string;
  link: string;
  thumbnail?: string;
  brand_name?: string;
  group_key: string;      // Computed by backend for frontend grouping
  dosage_value?: number;
  dosage_unit?: string;
  form?: string;
  quantity?: number;
  rank: number;           // Meilisearch relevance rank
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

// New flat search result from backend
export interface FlatSearchResult {
  products: BackendProduct[];
  total: number;
  offset: number;
  limit: number;
  search_type_used?: string;
  processing_time_ms?: number;
  facets?: Record<string, Record<string, number>>;
}

// Grouped result for UI (created by frontend from flat products)
export interface SearchResult {
  groups: ProductGroup[];
  search_type_used?: string;
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

/**
 * Group flat products by group_key into ProductGroups
 * This is the main frontend grouping function
 */
export function groupProductsByKey(products: BackendProduct[]): ProductGroup[] {
  if (!products || products.length === 0) return [];

  // Group by group_key, preserving order of first appearance (Meilisearch relevance)
  const groupMap = new Map<string, { firstRank: number; products: BackendProduct[] }>();
  const groupOrder: string[] = [];

  for (const product of products) {
    const key = product.group_key || product.title;

    if (groupMap.has(key)) {
      groupMap.get(key)!.products.push(product);
    } else {
      groupMap.set(key, { firstRank: product.rank, products: [product] });
      groupOrder.push(key);
    }
  }

  // Convert to ProductGroup array, sorted by first appearance
  const groups: ProductGroup[] = groupOrder.map(key => {
    const { products: groupProducts } = groupMap.get(key)!;

    // Sort products within group by price (lowest first)
    const sortedProducts = [...groupProducts].sort((a, b) => a.price - b.price);

    // Get unique vendors
    const vendors = new Set(sortedProducts.map(p => p.vendor_id));

    // Calculate price range
    const prices = sortedProducts.map(p => p.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

    // Use first product's data for group display
    const firstProduct = sortedProducts[0];

    return {
      id: key,
      normalized_name: firstProduct.title,
      dosage_value: firstProduct.dosage_value,
      dosage_unit: firstProduct.dosage_unit,
      products: sortedProducts,
      price_range: { min: minPrice, max: maxPrice, avg: avgPrice },
      vendor_count: vendors.size,
      product_count: sortedProducts.length,
    };
  });

  return groups;
}

/**
 * Convert flat search result to grouped search result
 */
export function convertFlatToGrouped(flat: FlatSearchResult): SearchResult {
  const groups = groupProductsByKey(flat.products);

  return {
    groups,
    search_type_used: flat.search_type_used,
    total: groups.length, // Total groups, not products
    offset: flat.offset,
    limit: flat.limit,
  };
}
