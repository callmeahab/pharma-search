import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import { PharmaAPIClient } from "./grpc/service.client";
import {
  SearchRequest,
  AutocompleteRequest,
  ContactRequest,
  SearchGroupsRequest,
  FacetsRequest,
  PriceComparisonRequest,
  ProcessRequest,
  ReprocessAllRequest,
  RebuildIndexRequest,
  ProcessingAnalysisRequest,
  HealthRequest,
} from "./grpc/service";
import { SearchOptions } from "./api";

// Create gRPC-Web transport (only on client side)
let transport: any = null;
let client: any = null;

function getClient() {
  if (typeof window === "undefined") {
    // Server-side rendering, return null
    return null;
  }

  if (!transport) {
    // Try bypassing nginx by connecting directly to grpcwebproxy
    const baseUrl =
      process.env.NODE_ENV === "production"
        ? window.location.origin
        : "http://localhost:8080";

    transport = new GrpcWebFetchTransport({
      baseUrl: baseUrl,
      format: "binary",
    });
  }

  if (!client) {
    client = new PharmaAPIClient(transport);
  }

  return client;
}

// Helper function to convert gRPC response to expected format
function convertGenericResponse(response: any) {
  if (response.response?.data) {
    // Convert protobuf Struct to plain object by extracting values from fields
    const data = response.response.data;
    if (data.fields) {
      const result: any = {};
      for (const [key, field] of Object.entries(data.fields)) {
        result[key] = extractFieldValue(field);
      }
      return result;
    }
    // Fallback to JSON conversion
    return JSON.parse(JSON.stringify(data));
  }
  return response.response;
}

// Helper to extract value from protobuf field structure
function extractFieldValue(field: any): any {
  if (!field || !field.kind) return null;

  switch (field.kind.oneofKind) {
    case "numberValue":
      return field.kind.numberValue;
    case "stringValue":
      return field.kind.stringValue;
    case "boolValue":
      return field.kind.boolValue;
    case "structValue":
      if (field.kind.structValue.fields) {
        const result: any = {};
        for (const [key, nestedField] of Object.entries(
          field.kind.structValue.fields
        )) {
          result[key] = extractFieldValue(nestedField);
        }
        return result;
      }
      return {};
    case "listValue":
      if (field.kind.listValue.values) {
        return field.kind.listValue.values.map((item: any) =>
          extractFieldValue(item)
        );
      }
      return [];
    case "nullValue":
      return null;
    default:
      return null;
  }
}

export class GrpcApiClient {
  async health() {
    const grpcClient = getClient();
    if (!grpcClient)
      throw new Error("gRPC client not available on server side");

    const request: HealthRequest = {};
    const response = await grpcClient.health(request);
    return response.response;
  }

  async autocomplete(query: string, limit: number = 8) {
    const grpcClient = getClient();
    if (!grpcClient)
      throw new Error("gRPC client not available on server side");

    const request: AutocompleteRequest = {
      q: query,
      limit: limit,
    };
    try {
      const response = await grpcClient.autocomplete(request);
      
      // Transform the gRPC response to match expected format
      const suggestions = response.response.suggestions.map((suggestion: any) => ({
        id: suggestion.id || "",
        title: suggestion.title || "",
        price: suggestion.price || 0,
        vendor_name: suggestion.vendorName || "",
      }));

      return {
        suggestions,
        query: response.response.query,
        limit: response.response.limit,
      };
    } catch (error) {
      throw error;
    }
  }

  async autocompleteFallback(query: string, limit: number = 8) {
    const grpcClient = getClient();
    if (!grpcClient)
      throw new Error("gRPC client not available on server side");

    const request: AutocompleteRequest = {
      q: query,
      limit: limit,
    };
    const response = await grpcClient.autocomplete(request);
    const raw = response.response.suggestions as any[];
    const suggestions = Array.isArray(raw)
      ? raw.map((item: any) => {
          // Support both legacy string[] and new structured suggestions
          if (typeof item === "string") {
            return {
              id: "",
              title: item,
              price: 0,
              vendor_name: "",
            };
          }
          return {
            id: item.id ?? "",
            title: item.title ?? "",
            // Backends may send vendorName (camelCase) via protobuf-ts mapping
            vendor_name: item.vendor_name ?? item.vendorName ?? "",
            price: typeof item.price === "number" ? item.price : 0,
          };
        })
      : [];
    return {
      suggestions,
      query: response.response.query,
      limit: response.response.limit,
    };
  }

  async searchProducts(query: string, options?: SearchOptions) {
    const grpcClient = getClient();
    if (!grpcClient)
      throw new Error("gRPC client not available on server side");

    const request: SearchRequest = {
      q: query,
      limit: options?.limit || 100,
      offset: options?.offset || 0,
      minPrice: options?.minPrice || 0,
      maxPrice: options?.maxPrice || 0,
      brandNames: options?.brandIds || [],
      categories: [],
      forms: [],
      inStockOnly: false,
    };

    const response = await grpcClient.search(request);
    return convertGenericResponse(response);
  }

  async searchGroups(query: string, limit: number = 20) {
    const request: SearchGroupsRequest = {
      q: query,
      limit: limit,
    };
    const grpcClient = getClient();
    if (!grpcClient)
      throw new Error("gRPC client not available on server side");

    const response = await grpcClient.searchGroups(request);
    return convertGenericResponse(response);
  }

  async getFacets() {
    const request: FacetsRequest = {};
    const grpcClient = getClient();
    if (!grpcClient)
      throw new Error("gRPC client not available on server side");

    const response = await grpcClient.getFacets(request);
    return convertGenericResponse(response);
  }

  async getPriceComparison(query: string) {
    const request: PriceComparisonRequest = {
      q: query,
    };
    const grpcClient = getClient();
    if (!grpcClient)
      throw new Error("gRPC client not available on server side");

    const response = await grpcClient.priceComparison(request);
    return convertGenericResponse(response);
  }

  async submitContact(payload: {
    name: string;
    email: string;
    message: string;
  }) {
    const request: ContactRequest = {
      name: payload.name,
      email: payload.email,
      message: payload.message,
    };
    const grpcClient = getClient();
    if (!grpcClient)
      throw new Error("gRPC client not available on server side");

    const response = await grpcClient.contact(request);
    return convertGenericResponse(response);
  }

  async processProducts(batchSize: number = 100) {
    const request: ProcessRequest = {
      batchSize: batchSize,
    };
    const grpcClient = getClient();
    if (!grpcClient)
      throw new Error("gRPC client not available on server side");

    const response = await grpcClient.processProducts(request);
    return convertGenericResponse(response);
  }

  async reprocessAllProducts() {
    const request: ReprocessAllRequest = {};
    const grpcClient = getClient();
    if (!grpcClient)
      throw new Error("gRPC client not available on server side");

    const response = await grpcClient.reprocessAll(request);
    return convertGenericResponse(response);
  }

  async rebuildSearchIndex() {
    const request: RebuildIndexRequest = {};
    const grpcClient = getClient();
    if (!grpcClient)
      throw new Error("gRPC client not available on server side");

    const response = await grpcClient.rebuildIndex(request);
    return convertGenericResponse(response);
  }

  async getProcessingAnalysis() {
    const request: ProcessingAnalysisRequest = {};
    const grpcClient = getClient();
    if (!grpcClient)
      throw new Error("gRPC client not available on server side");

    const response = await grpcClient.processingAnalysis(request);
    return convertGenericResponse(response);
  }
}

export const grpcClient = new GrpcApiClient();
