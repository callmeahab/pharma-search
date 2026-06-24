import { grpcClient, StreamingSearchResult } from "./grpc-client";
import {
  ProductGroup,
  SearchResult,
  BackendProduct,
} from "@/types/product";

export type { StreamingSearchResult };


export interface SearchOptions {
  limit?: number;
  offset?: number;
  minPrice?: number;
  maxPrice?: number;
  vendorIds?: string[];
  brandNames?: string[];
  categories?: string[];
  forms?: string[];
  searchType?: "auto" | "similarity" | "database";
}

export type { ProductGroup, SearchResult, BackendProduct as Product };

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
  return grpcClient.autocomplete(query, limit);
}

export async function searchGroupsStreaming(
  query: string,
  onResult: (result: StreamingSearchResult) => void,
  options?: { offset?: number; limit?: number; brandNames?: string[]; categories?: string[] }
): Promise<StreamingSearchResult> {
  return grpcClient.searchGroupsStream(query, onResult, options);
}

export async function fetchGroupsPage(
  query: string,
  offset: number,
  limit: number,
  filters?: { brandNames?: string[]; categories?: string[] }
): Promise<StreamingSearchResult> {
  return grpcClient.fetchGroupsPage(query, offset, limit, filters);
}

export async function checkHealth(): Promise<{ status: string }> {
  return grpcClient.health();
}

// Global (catalog-wide) facets — used to populate the home-page brand/category
// filters before any search/browse, so every option is selectable up front.
export async function getGlobalFacets(): Promise<{
  facets?: Record<string, Record<string, number>>;
}> {
  try {
    return await grpcClient.getFacets();
  } catch (error) {
    console.error("Failed to fetch global facets:", error);
    return {};
  }
}

export async function getFeaturedProducts(
  options?: SearchOptions
): Promise<SearchResult> {
  try {
    const limit = options?.limit || 24;
    const result = await grpcClient.getFeatured(limit);

    // The backend returns pre-grouped products sorted by vendor count
    return {
      groups: result.groups || [],
      total: result.total || 0,
      offset: 0,
      limit: limit,
    };
  } catch (error) {
    console.error("Failed to fetch featured products:", error);
    return {
      groups: [],
      total: 0,
      offset: 0,
      limit: options?.limit || 24,
    };
  }
}


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
  return grpcClient.getProcessingAnalysis();
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

export async function getPriceComparison(
  groupId: string
): Promise<PriceComparisonResult> {
  return grpcClient.getPriceComparison(groupId);
}

export async function processProducts(
  batchSize: number = 100
): Promise<{ status: string; message: string }> {
  return grpcClient.processProducts(batchSize);
}

export async function reprocessAllProducts(): Promise<{
  status: string;
  message: string;
}> {
  return grpcClient.reprocessAllProducts();
}

export async function rebuildSearchIndex(): Promise<{
  status: string;
  message: string;
}> {
  return grpcClient.rebuildSearchIndex();
}

export async function submitContact(payload: {
  name: string;
  email: string;
  message: string;
}): Promise<void> {
  await grpcClient.submitContact(payload);
}
