const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface SearchOptions {
  limit?: number;
  offset?: number;
  minPrice?: number;
  maxPrice?: number;
  vendorIds?: string[];
  brandIds?: string[];
}

export interface Product {
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
  products: Product[];
  price_range: {
    min: number;
    max: number;
    avg: number;
  };
  vendor_count: number;
}

export interface SearchResult {
  groups: ProductGroup[];
  total: number;
  offset: number;
  limit: number;
}

export async function searchProducts(
  query: string,
  options?: SearchOptions
): Promise<SearchResult> {
  const params = new URLSearchParams({
    q: query,
    limit: (options?.limit || 20).toString(),
    offset: (options?.offset || 0).toString(),
  });

  if (options?.minPrice !== undefined) {
    params.append("min_price", options.minPrice.toString());
  }
  if (options?.maxPrice !== undefined) {
    params.append("max_price", options.maxPrice.toString());
  }
  if (options?.vendorIds && options.vendorIds.length > 0) {
    options.vendorIds.forEach((id) => params.append("vendor_ids", id));
  }
  if (options?.brandIds && options.brandIds.length > 0) {
    options.brandIds.forEach((id) => params.append("brand_ids", id));
  }

  const response = await fetch(`${API_URL}/api/search?${params}`);

  if (!response.ok) {
    throw new Error(`Search failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function checkHealth(): Promise<{ status: string }> {
  const response = await fetch(`${API_URL}/health`);

  if (!response.ok) {
    throw new Error(
      `Health check failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}

export async function getFeaturedProducts(
  options?: SearchOptions
): Promise<SearchResult> {
  // Get popular products by searching for common terms
  const popularTerms = [
    "vitamin",
    "omega",
    "magnesium",
    "protein",
    "probiotik",
  ];
  const randomTerm =
    popularTerms[Math.floor(Math.random() * popularTerms.length)];

  try {
    return await searchProducts(randomTerm, {
      limit: options?.limit || 12,
      ...options,
    });
  } catch (error) {
    // Fallback to empty result if search fails
    return {
      groups: [],
      total: 0,
      offset: 0,
      limit: options?.limit || 12,
    };
  }
}

export interface Category {
  name: string;
  count: number;
}

export async function getCategories(): Promise<Category[]> {
  // Since the backend doesn't have a dedicated categories endpoint,
  // we'll derive categories from search results
  const commonCategories = [
    "Vitamins",
    "Supplements",
    "Minerals",
    "Proteins",
    "Herbs",
    "Probiotics",
  ];

  const categories: Category[] = [];

  for (const categoryName of commonCategories) {
    try {
      const result = await searchProducts(categoryName.toLowerCase(), {
        limit: 1,
      });
      categories.push({
        name: categoryName,
        count: result.total,
      });
    } catch (error) {
      // Skip categories that fail to search
      continue;
    }
  }

  return categories.filter((cat) => cat.count > 0);
}
