export interface Price {
  store: string;
  price: number;
  inStock: boolean;
  link?: string;
  title?: string;
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

export interface BackendProduct {
  id: string;
  title: string;
  price: number;
  vendor_id: string;
  vendor_name: string;
  link: string;
  thumbnail?: string;
  brand_name?: string;
  group_key: string;
  dosage_value?: number;
  dosage_unit?: string;
  form?: string;
  quantity?: number;
  rank: number;
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

export interface FlatSearchResult {
  products: BackendProduct[];
  total: number;
  offset: number;
  limit: number;
  search_type_used?: string;
  processing_time_ms?: number;
  facets?: Record<string, Record<string, number>>;
}

export interface SearchResult {
  groups: ProductGroup[];
  search_type_used?: string;
  total: number;
  offset: number;
  limit: number;
  facets?: Record<string, Record<string, number>>;
}

import { humanizeTitle } from "@/lib/utils";

// Serbian pluralization helper
function pluralize(count: number, one: string, few: string, many: string): string {
  const absCount = Math.abs(count);
  const lastTwo = absCount % 100;
  const lastOne = absCount % 10;

  // Special case for 11-14 (always "many" form)
  if (lastTwo >= 11 && lastTwo <= 14) {
    return `${count} ${many}`;
  }

  if (lastOne === 1) {
    return `${count} ${one}`;
  }

  if (lastOne >= 2 && lastOne <= 4) {
    return `${count} ${few}`;
  }

  return `${count} ${many}`;
}

function formatProductDescription(productCount: number, vendorCount: number): string {
  const products = pluralize(productCount, "proizvod", "proizvoda", "proizvoda");
  const vendors = pluralize(vendorCount, "apoteci", "apoteke", "apoteka");
  return `${products} u ${vendors}`;
}

export function convertBackendProductToProduct(
  backendProduct: BackendProduct,
  group: ProductGroup
): Product {
  return {
    id: backendProduct.id,
    name: humanizeTitle(backendProduct.title),
    description: formatProductDescription(group.product_count || 0, group.vendor_count),
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
  const firstProduct = group.products[0];
  const productTitle = firstProduct?.title
    ? humanizeTitle(firstProduct.title)
    : "Nepoznat proizvod";

  const mainProduct: Product = {
    id: group.id,
    name: productTitle,
    description: formatProductDescription(group.product_count || 0, group.vendor_count),
    category: "",
    image: firstProduct?.thumbnail || "/medicine-placeholder.svg",
    prices: group.products.map((p) => ({
      store: p.vendor_name,
      price: p.price,
      inStock: true,
      link: p.link,
      title: p.title,
    })),
    vendorCount: group.vendor_count,
    productCount: group.product_count,
  };

  return [mainProduct];
}

export type GroupingMode = "strict" | "normal" | "loose";

interface GroupingContext {
  knownBrands?: Set<string>;
}

/**
 * Extract a grouping key based on the mode:
 * - strict: exact group_key match
 * - normal: ingredient + dosage (default)
 * - loose: base ingredient name only (ignores dosage/quantity/brand)
 */
function getGroupingKey(product: BackendProduct, mode: GroupingMode, context?: GroupingContext): string {
  const baseKey = product.group_key || product.title.toLowerCase();

  switch (mode) {
    case "strict":
      // Use full group key including quantity
      return baseKey;

    case "normal":
      // Remove quantity variations (e.g., "vitamin d3 2000 iu" without "60 caps")
      // Keep: ingredient + dosage, Remove: quantity
      return baseKey
        .replace(/\s*\d+\s*(tab|tabl|tableta|tablete|kaps|kapsula|kapsule|caps|capsule|softgel|kom|komada|kesica|kesice)\w*\s*/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    case "loose": {
      // Loose grouping - group ALL variants of a product together
      // Uses title directly (not group_key) and removes: brands, dosages, quantities, forms
      // So "Vitamin D3 1000 IU" and "Vitamin D3 5000 IU" from any brand = same group
      let key = product.title.toLowerCase();

      // Remove known brands from database
      if (context?.knownBrands && context.knownBrands.size > 0) {
        for (const brand of context.knownBrands) {
          if (brand && brand.length > 2) { // Only remove brands with 3+ chars
            const escaped = brand.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            key = key.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), ' ');
          }
        }
      }

      key = key
        // Remove ALL numeric values with units (dosages AND quantities)
        .replace(/\d+([.,]\d+)?\s*(mg|mcg|µg|g|kg|ml|l|iu|ij|%)\b/gi, ' ')
        // Remove "x60", "x30", "60x" patterns (quantity indicators)
        .replace(/\bx\d+\b/gi, ' ')
        .replace(/\b\d+x\b/gi, ' ')
        // Remove quantity patterns (30 tableta, 60 caps, etc.)
        .replace(/\b\d+\s*(tab|tabl|tableta|tablete|kaps|kapsula|kapsule|caps|capsule|softgel|kom|komada|kesica|kesice|komad)\w*\b/gi, ' ')
        .replace(/\b\d+\s*x\s*\d+\b/gi, ' ') // "30x500" patterns
        .replace(/\b\d+\b/g, ' ') // standalone numbers
        // Remove product forms
        .replace(/\b(tablete?|tableta|tabl|kapsule?|kapsula|kaps|caps|capsule|softgel|gel|sirup|sprej|spray|kapi|drops|krema?|cream|losion|lotion|mast|serum|prah|powder|granule?|kesice?|kesica|ampule?|ampula|komada?|kom|bars?)\b/gi, ' ')
        // Remove marketing words
        .replace(/\b(plus|extra|forte|max|ultra|super|premium|gold|silver|pro|active|complex|formula|supplement|dietary|natural|organic|vegan|gluten.?free|nutrition|foods?)\b/gi, ' ')
        // Remove special characters
        .replace(/[+®™©()[\]{}<>\/\\|_–—:;'"`]/g, ' ')
        .replace(/\s*-\s*/g, ' ')
        // Collapse whitespace
        .replace(/\s+/g, ' ')
        .trim();

      // Take first 3 significant words for core identity (more aggressive grouping)
      const words = key.split(' ').filter(w => w.length > 1);
      return words.slice(0, 3).join(' ');
    }

    default:
      return baseKey;
  }
}

export function groupProductsByKey(products: BackendProduct[], mode: GroupingMode = "normal"): ProductGroup[] {
  if (!products || products.length === 0) return [];

  // For loose mode, collect all known brands from the products
  const context: GroupingContext = {
    knownBrands: new Set<string>(),
  };

  if (mode === "loose") {
    for (const product of products) {
      // Collect brands
      if (product.brand_name && product.brand_name.trim()) {
        context.knownBrands!.add(product.brand_name.trim().toLowerCase());
      }
      // Also extract brand from vendor_name in some cases
      if (product.vendor_name && product.vendor_name.trim()) {
        // Vendor names like "Apoteka Benu" - extract the brand part
        const vendorParts = product.vendor_name.split(/\s+/);
        if (vendorParts.length > 1) {
          context.knownBrands!.add(vendorParts[vendorParts.length - 1].toLowerCase());
        }
      }
    }
  }

  const groupMap = new Map<string, { firstRank: number; products: BackendProduct[]; originalKey: string }>();
  const groupOrder: string[] = [];

  for (const product of products) {
    const key = getGroupingKey(product, mode, context);
    const originalKey = product.group_key || product.title;

    if (groupMap.has(key)) {
      groupMap.get(key)!.products.push(product);
    } else {
      groupMap.set(key, { firstRank: product.rank, products: [product], originalKey });
      groupOrder.push(key);
    }
  }

  const groups: ProductGroup[] = groupOrder.map((key, index) => {
    const { products: groupProducts } = groupMap.get(key)!;

    const sortedProducts = [...groupProducts].sort((a, b) => a.price - b.price);
    const vendors = new Set(sortedProducts.map(p => p.vendor_id));
    const prices = sortedProducts.map(p => p.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

    const firstProduct = sortedProducts[0];

    return {
      // Use normalized key + index for unique identification (avoids duplicate key issues)
      id: `${key}-${index}`,
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

export function convertFlatToGrouped(flat: FlatSearchResult, groupingMode: GroupingMode = "normal"): SearchResult {
  const groups = groupProductsByKey(flat.products, groupingMode);

  return {
    groups,
    search_type_used: flat.search_type_used,
    total: groups.length, // Total groups, not products
    offset: flat.offset,
    limit: flat.limit,
    facets: flat.facets,
  };
}
