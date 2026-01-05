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

export function groupProductsByKey(products: BackendProduct[]): ProductGroup[] {
  if (!products || products.length === 0) return [];

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

  const groups: ProductGroup[] = groupOrder.map(key => {
    const { products: groupProducts } = groupMap.get(key)!;

    const sortedProducts = [...groupProducts].sort((a, b) => a.price - b.price);
    const vendors = new Set(sortedProducts.map(p => p.vendor_id));
    const prices = sortedProducts.map(p => p.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

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

export function convertFlatToGrouped(flat: FlatSearchResult): SearchResult {
  const groups = groupProductsByKey(flat.products);

  return {
    groups,
    search_type_used: flat.search_type_used,
    total: groups.length, // Total groups, not products
    offset: flat.offset,
    limit: flat.limit,
    facets: flat.facets,
  };
}
