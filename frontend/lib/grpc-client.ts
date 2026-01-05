import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { PharmaAPI } from "./gen/service_connect";
import type {
  GenericJsonResponse,
  HealthResponse,
  ProductGroupChunk,
  ProductGroup as PbProductGroup,
  Product as PbProduct,
} from "./gen/service_pb";
import { SearchOptions } from "./api";
import { ProductGroup, BackendProduct } from "@/types/product";

export interface StreamingSearchResult {
  groups: ProductGroup[];
  totalProducts: number;
  totalGroups: number;
  searchTypeUsed: string;
  facets: Record<string, Record<string, number>>;
  isComplete: boolean;
}

function convertPbProductToBackend(p: PbProduct): BackendProduct {
  return {
    id: p.id,
    title: p.title,
    price: p.price,
    vendor_id: p.vendorId,
    vendor_name: p.vendorName,
    link: p.link,
    thumbnail: p.thumbnail,
    brand_name: p.brandName,
    group_key: p.groupKey,
    dosage_value: p.dosageValue,
    dosage_unit: p.dosageUnit,
    form: p.form,
    quantity: p.quantity,
    rank: p.rank,
  };
}

function convertPbGroupToProductGroup(g: PbProductGroup, index: number): ProductGroup {
  const products = g.products.map(convertPbProductToBackend);
  return {
    id: `${g.id}-${index}`,
    normalized_name: g.normalizedName,
    products,
    price_range: {
      min: g.priceRange?.min || 0,
      max: g.priceRange?.max || 0,
      avg: g.priceRange?.avg || 0,
    },
    vendor_count: g.vendorCount,
    product_count: g.productCount,
    dosage_value: g.dosageValue,
    dosage_unit: g.dosageUnit,
  };
}

function convertChunkToResult(chunk: ProductGroupChunk): StreamingSearchResult {
  const groups = chunk.groups.map((g, i) => convertPbGroupToProductGroup(g, i));

  // Convert facets from proto format to our format
  const facets: Record<string, Record<string, number>> = {};
  if (chunk.metadata?.facets) {
    for (const [key, facetValues] of Object.entries(chunk.metadata.facets)) {
      if (facetValues.values) {
        facets[key] = {};
        for (const [k, v] of Object.entries(facetValues.values)) {
          facets[key][k] = v;
        }
      }
    }
  }

  return {
    groups,
    totalProducts: chunk.metadata?.totalProducts || 0,
    totalGroups: chunk.metadata?.totalGroups || 0,
    searchTypeUsed: chunk.metadata?.searchTypeUsed || "",
    facets,
    isComplete: chunk.isComplete,
  };
}

let transport: ReturnType<typeof createConnectTransport> | null = null;
let client: ReturnType<typeof createClient<typeof PharmaAPI>> | null = null;

function getClient() {
  if (typeof window === "undefined") {
    return null;
  }

  if (!transport) {
    const baseUrl =
      process.env.NODE_ENV === "production"
        ? window.location.origin
        : "http://localhost:50051";

    transport = createConnectTransport({
      baseUrl: baseUrl,
    });
  }

  if (!client) {
    client = createClient(PharmaAPI, transport);
  }

  return client;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertGenericResponse(response: GenericJsonResponse): any {
  if (response.data) {
    return response.data.toJson();
  }
  return {};
}

export class GrpcApiClient {
  async health(): Promise<HealthResponse> {
    const connectClient = getClient();
    if (!connectClient)
      throw new Error("Connect client not available on server side");

    return await connectClient.health({});
  }

  async autocomplete(query: string, limit: number = 8) {
    const connectClient = getClient();
    if (!connectClient)
      throw new Error("Connect client not available on server side");

    const response = await connectClient.autocomplete({
      q: query,
      limit: limit,
    });

    const suggestions = response.suggestions.map((suggestion) => ({
      id: suggestion.id || "",
      title: suggestion.title || "",
      price: suggestion.price || 0,
      vendor_name: suggestion.vendorName || "",
    }));

    return {
      suggestions,
      query: response.query,
      limit: response.limit,
    };
  }

  async autocompleteFallback(query: string, limit: number = 8) {
    return this.autocomplete(query, limit);
  }

  async searchProducts(query: string, options?: SearchOptions) {
    const connectClient = getClient();
    if (!connectClient)
      throw new Error("Connect client not available on server side");

    const response = await connectClient.search({
      q: query,
      limit: options?.limit || 1000,
      offset: options?.offset || 0,
      minPrice: options?.minPrice || 0,
      maxPrice: options?.maxPrice || 0,
      brandNames: options?.brandNames || [],
      categories: options?.categories || [],
      forms: options?.forms || [],
      inStockOnly: false,
    });

    return convertGenericResponse(response);
  }

  async searchGroups(query: string, limit: number = 20) {
    const connectClient = getClient();
    if (!connectClient)
      throw new Error("Connect client not available on server side");

    const response = await connectClient.searchGroups({
      q: query,
      limit: limit,
    });

    return convertGenericResponse(response);
  }

  async searchGroupsStream(
    query: string,
    onChunk: (result: StreamingSearchResult) => void,
    options?: { offset?: number; limit?: number }
  ): Promise<StreamingSearchResult> {
    const connectClient = getClient();
    if (!connectClient)
      throw new Error("Connect client not available on server side");

    let finalResult: StreamingSearchResult = {
      groups: [],
      totalProducts: 0,
      totalGroups: 0,
      searchTypeUsed: "",
      facets: {},
      isComplete: false,
    };

    const stream = connectClient.searchGroupsStream({
      q: query,
      offset: options?.offset || 0,
      limit: options?.limit || 24,
    });

    for await (const chunk of stream) {
      const result = convertChunkToResult(chunk);

      if (chunk.isComplete) {
        finalResult = result;
      } else {
        // Partial chunk - show early results
        finalResult = result;
      }

      onChunk(finalResult);
    }

    return finalResult;
  }

  // Simple paginated fetch without streaming callbacks
  async fetchGroupsPage(
    query: string,
    offset: number,
    limit: number
  ): Promise<StreamingSearchResult> {
    const connectClient = getClient();
    if (!connectClient)
      throw new Error("Connect client not available on server side");

    const stream = connectClient.searchGroupsStream({
      q: query,
      offset,
      limit,
    });

    let result: StreamingSearchResult = {
      groups: [],
      totalProducts: 0,
      totalGroups: 0,
      searchTypeUsed: "",
      facets: {},
      isComplete: false,
    };

    for await (const chunk of stream) {
      result = convertChunkToResult(chunk);
    }

    return result;
  }

  async getFacets() {
    const connectClient = getClient();
    if (!connectClient)
      throw new Error("Connect client not available on server side");

    const response = await connectClient.getFacets({});
    return convertGenericResponse(response);
  }

  async getFeatured(limit: number = 24) {
    const connectClient = getClient();
    if (!connectClient)
      throw new Error("Connect client not available on server side");

    const response = await connectClient.getFeatured({ limit });
    return convertGenericResponse(response);
  }

  async getPriceComparison(query: string) {
    const connectClient = getClient();
    if (!connectClient)
      throw new Error("Connect client not available on server side");

    const response = await connectClient.priceComparison({
      q: query,
    });

    return convertGenericResponse(response);
  }

  async submitContact(payload: {
    name: string;
    email: string;
    message: string;
  }) {
    const connectClient = getClient();
    if (!connectClient)
      throw new Error("Connect client not available on server side");

    const response = await connectClient.contact({
      name: payload.name,
      email: payload.email,
      message: payload.message,
    });

    return convertGenericResponse(response);
  }

  async processProducts(batchSize: number = 100) {
    const connectClient = getClient();
    if (!connectClient)
      throw new Error("Connect client not available on server side");

    const response = await connectClient.processProducts({
      batchSize: batchSize,
    });

    return convertGenericResponse(response);
  }

  async reprocessAllProducts() {
    const connectClient = getClient();
    if (!connectClient)
      throw new Error("Connect client not available on server side");

    const response = await connectClient.reprocessAll({});
    return convertGenericResponse(response);
  }

  async rebuildSearchIndex() {
    const connectClient = getClient();
    if (!connectClient)
      throw new Error("Connect client not available on server side");

    const response = await connectClient.rebuildIndex({});
    return convertGenericResponse(response);
  }

  async getProcessingAnalysis() {
    const connectClient = getClient();
    if (!connectClient)
      throw new Error("Connect client not available on server side");

    const response = await connectClient.processingAnalysis({});
    return convertGenericResponse(response);
  }
}

export const grpcClient = new GrpcApiClient();
