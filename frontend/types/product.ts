export interface Price {
  store: string;
  price: number;
  inStock: boolean;
  link?: string;
  title?: string;
  is_best_deal?: boolean;
  diff_from_avg?: number;
  updatedAt?: string; // when this offer's price was last retrieved (ISO 8601)
}

export interface ComparisonContext {
  vendorCount: number;
  offerCount: number;
  lowestPrice: number;
  highestPrice: number;
  averagePrice: number;
  bestVendorName?: string;
  hiddenOfferCount: number;
  isBestOffer?: boolean;
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
  displayMode?: "group" | "offer";
  primaryOffer?: Price;
  comparisonContext?: ComparisonContext;
  priceUpdatedAt?: string; // when the displayed (lowest) price was last retrieved
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
  normalized_name?: string;
  dosage_value?: number;
  dosage_unit?: string;
  volume_value?: number;
  volume_unit?: string;
  form?: string;
  quantity?: number;
  rank: number;
  price_updated_at?: string;
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

import { formatPrice, humanizeTitle, pluralizeSr } from "@/lib/utils";

function toPrices(group: ProductGroup): Price[] {
  return group.products.map((product) => ({
    store: product.vendor_name,
    price: product.price,
    inStock: true,
    link: product.link,
    title: product.title,
    updatedAt: product.price_updated_at,
  }));
}

function buildComparisonContext(
  group: ProductGroup,
  currentProduct?: BackendProduct
): ComparisonContext {
  const prices = toPrices(group);
  const lowestOffer = group.products[0];
  const visibleOfferCount = group.products.length;
  const vendorCount = group.vendor_count || visibleOfferCount;
  const rawProductCount = group.product_count || visibleOfferCount;
  const fallbackLowest =
    prices.length > 0 ? Math.min(...prices.map((price) => price.price)) : 0;
  const fallbackHighest =
    prices.length > 0 ? Math.max(...prices.map((price) => price.price)) : 0;
  const lowestPrice =
    group.price_range?.min || fallbackLowest;
  const highestPrice =
    group.price_range?.max || fallbackHighest;
  const averagePrice =
    group.price_range?.avg ||
    prices.reduce((sum, price) => sum + price.price, 0) / Math.max(prices.length, 1);

  return {
    vendorCount,
    offerCount: visibleOfferCount,
    lowestPrice,
    highestPrice,
    averagePrice,
    bestVendorName: lowestOffer?.vendor_name,
    hiddenOfferCount: Math.max(0, rawProductCount - visibleOfferCount),
    isBestOffer: currentProduct
      ? currentProduct.id === lowestOffer?.id ||
        (currentProduct.price === lowestPrice &&
          currentProduct.vendor_name === lowestOffer?.vendor_name)
      : undefined,
  };
}

function formatGroupedDescription(comparison: ComparisonContext): string {
  if (comparison.vendorCount <= 1 && comparison.offerCount <= 1 && comparison.hiddenOfferCount === 0) {
    return "Jedina dostupna ponuda za ovaj proizvod";
  }

  const vendorWord = pluralizeSr(
    comparison.vendorCount,
    "apoteci",
    "apoteke",
    "apoteka"
  );

  if (comparison.hiddenOfferCount > 0) {
    return `${comparison.vendorCount} ${vendorWord}, prikazana najniža cena po apoteci`;
  }

  return `${comparison.offerCount} ponuda u ${comparison.vendorCount} ${vendorWord}`;
}

function formatOfferDescription(comparison: ComparisonContext): string {
  if (comparison.vendorCount <= 1) {
    return "Jedina dostupna ponuda za ovaj proizvod";
  }

  if (comparison.isBestOffer) {
    return `Najpovoljnija ponuda među ${comparison.vendorCount} apoteka`;
  }

  return `Najbolja cena je ${formatPrice(comparison.lowestPrice)} u ${comparison.bestVendorName || "drugoj apoteci"}`;
}

export function convertBackendProductToProduct(
  backendProduct: BackendProduct,
  group: ProductGroup
): Product {
  const prices = toPrices(group);
  const comparisonContext = buildComparisonContext(group, backendProduct);
  const primaryOffer: Price = {
    store: backendProduct.vendor_name,
    price: backendProduct.price,
    inStock: true,
    link: backendProduct.link,
    title: backendProduct.title,
  };

  return {
    id: backendProduct.id,
    name: humanizeTitle(group.normalized_name || backendProduct.title),
    description: formatOfferDescription(comparisonContext),
    category: "", // No category since we removed badges
    image: backendProduct.thumbnail || "/medicine-placeholder.svg",
    prices,
    vendorCount: group.vendor_count,
    productCount: group.product_count,
    displayMode: "offer",
    primaryOffer,
    comparisonContext,
    priceUpdatedAt: backendProduct.price_updated_at,
  };
}

export function convertProductGroupToProducts(group: ProductGroup): Product[] {
  const firstProduct = group.products[0];
  const prices = toPrices(group);
  const comparisonContext = buildComparisonContext(group);
  const productTitle = group.normalized_name
    ? humanizeTitle(group.normalized_name)
    : firstProduct?.title
      ? humanizeTitle(firstProduct.title)
      : "Nepoznat proizvod";

  const mainProduct: Product = {
    id: group.id,
    name: productTitle,
    description: formatGroupedDescription(comparisonContext),
    category: "",
    image: firstProduct?.thumbnail || "/medicine-placeholder.svg",
    prices,
    vendorCount: group.vendor_count,
    productCount: group.product_count,
    displayMode: "group",
    comparisonContext,
    // cheapest offer is products[0]; show when its price was retrieved
    priceUpdatedAt: group.products[0]?.price_updated_at,
  };

  return [mainProduct];
}
