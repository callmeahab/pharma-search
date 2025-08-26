// In production, use relative URLs so nginx can proxy to backend
// In development, use localhost:8000 directly
const API_URL = process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:8000');

export interface SearchOptions {
  limit?: number;
  offset?: number;
  minPrice?: number;
  maxPrice?: number;
  vendorIds?: string[];
  brandIds?: string[];
  searchType?: "auto" | "similarity" | "database";
}

export interface Product {
  id: string;
  title: string;
  price: number;
  vendor_id: string;
  vendor_name: string;
  link: string;
  thumbnail?: string;
  brand_name?: string;
  price_analysis?: {
    diff_from_avg: number;
    percentile: number;
    is_best_deal: boolean;
    is_worst_deal: boolean;
  };
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
    range?: number;
    stddev?: number;
  };
  vendor_count: number;
  product_count?: number;
  price_analysis?: {
    savings_potential: number;
    price_variation: number;
    below_avg_count: number;
    above_avg_count: number;
    has_multiple_vendors: boolean;
  };
}

export interface SearchResult {
  groups: ProductGroup[];
  total: number;
  offset: number;
  limit: number;
  search_type_used?: "auto" | "similarity" | "database";
}

export interface AutocompleteResult {
  suggestions: {
    id: string;
    title: string;
    price: number;
    vendor_name: string;
  }[];
  query: string;
  limit: number;
}

export async function autocomplete(
  query: string,
  limit: number = 8
): Promise<AutocompleteResult> {
  const params = new URLSearchParams({
    q: query,
    limit: limit.toString(),
  });

  const response = await fetch(`${API_URL}/api/autocomplete?${params}`);

  if (!response.ok) {
    throw new Error(`Autocomplete failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function searchProducts(
  query: string,
  options?: SearchOptions
): Promise<SearchResult> {
  const params = new URLSearchParams({
    q: query,
    limit: (options?.limit || 100).toString(), // Increased default limit
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
  if (options?.searchType) {
    params.append("search_type", options.searchType);
  }

  const response = await fetch(`${API_URL}/api/search?${params}`);

  if (!response.ok) {
    throw new Error(`Search failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function searchProductsStreaming(
  query: string,
  onBatch: (groups: ProductGroup[], isComplete: boolean) => void,
  options?: { limit?: number }
): Promise<void> {
  const params = new URLSearchParams({
    q: query,
    limit: (options?.limit || 50).toString(),
  });

  const response = await fetch(`${API_URL}/api/search-stream?${params}`);
  
  if (!response.ok) {
    throw new Error(`Streaming search failed: ${response.status}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error("No response body available");
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            
            if (data.type === 'batch' && data.groups) {
              onBatch(data.groups, false);
            } else if (data.type === 'complete') {
              onBatch([], true);
            } else if (data.type === 'error') {
              throw new Error(data.message);
            }
          } catch (parseError) {
            console.warn('Failed to parse streaming data:', parseError);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function searchAllProducts(
  query: string,
  options?: Omit<SearchOptions, "limit" | "offset">
): Promise<SearchResult> {
  // First, get a small batch to check total count
  const initialResult = await searchProducts(query, {
    ...options,
    limit: 1,
    offset: 0,
  });

  // If total is reasonable, fetch all at once
  if (initialResult.total <= 100) {
    return searchProducts(query, {
      ...options,
      limit: 100,
      offset: 0,
    });
  }

  // For larger result sets, fetch in batches
  const allGroups: ProductGroup[] = [];
  const batchSize = 100;
  let offset = 0;

  while (offset < initialResult.total) {
    const batch = await searchProducts(query, {
      ...options,
      limit: batchSize,
      offset: offset,
    });

    allGroups.push(...batch.groups);
    offset += batchSize;

    // Safety limit to prevent infinite loops
    if (offset > 1000) break;
  }

  return {
    groups: allGroups,
    total: initialResult.total,
    offset: 0,
    limit: allGroups.length,
    search_type_used: initialResult.search_type_used,
  };
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
    "kreatin",
    "kolagen",
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



// New API functions for backend routes

export interface GroupingStatistics {
  total_products: number;
  total_groups: number;
  avg_products_per_group: number;
  avg_vendors_per_group: number;
  groups_with_multiple_vendors: number;
  multi_vendor_percentage: number;
}

export interface TopGroup {
  name: string;
  product_count: number;
  vendor_count: number;
  price_range: {
    min: number;
    max: number;
    avg: number;
  };
}

export interface GroupingAnalysis {
  status: string;
  statistics: GroupingStatistics;
  top_groups: TopGroup[];
}

export async function getGroupingAnalysis(): Promise<GroupingAnalysis> {
  const response = await fetch(`${API_URL}/api/grouping-analysis`);

  if (!response.ok) {
    throw new Error(`Grouping analysis failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export interface PriceComparisonProduct {
  id: string;
  title: string;
  price: number;
  vendor: {
    name: string;
    website: string;
  };
  brand: string;
  link: string;
  thumbnail: string;
  price_analysis: {
    diff_from_avg: number;
    percentile: number;
    is_best_deal: boolean;
    is_worst_deal: boolean;
  };
}

export interface PriceComparisonGroup {
  id: string;
  name: string;
  product_count: number;
  vendor_count: number;
  dosage_value: number | null;
  dosage_unit: string;
  price_stats: {
    min: number;
    max: number;
    avg: number;
    range: number;
  };
}

export interface PriceComparisonResult {
  group: PriceComparisonGroup;
  products: PriceComparisonProduct[];
}

export async function getPriceComparison(groupId: string): Promise<PriceComparisonResult> {
  const response = await fetch(`${API_URL}/api/price-comparison/${groupId}`);

  if (!response.ok) {
    throw new Error(`Price comparison failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function processProducts(batchSize: number = 100): Promise<{ status: string; message: string }> {
  const response = await fetch(`${API_URL}/api/process?batch_size=${batchSize}`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Product processing failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function reprocessAllProducts(): Promise<{ status: string; message: string }> {
  const response = await fetch(`${API_URL}/api/reprocess-all`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Reprocessing failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function rebuildSearchIndex(): Promise<{ status: string; message: string }> {
  const response = await fetch(`${API_URL}/api/rebuild-index`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Index rebuild failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function submitContact(payload: { name: string; email: string; message: string }): Promise<any> {
  const response = await fetch(`${API_URL}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('Contact submit failed');
  return response.json();
}
