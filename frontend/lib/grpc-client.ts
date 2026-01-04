import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { PharmaAPI } from "./gen/service_connect";
import type {
  AutocompleteResponse,
  GenericJsonResponse,
  HealthResponse,
} from "./gen/service_pb";
import { SearchOptions } from "./api";

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
      limit: options?.limit || 100,
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
