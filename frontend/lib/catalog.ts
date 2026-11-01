import type { CatalogOfferFilters, ProductGroup } from "@/types/product";

export type CatalogSort = "relevance" | "price_asc" | "price_desc" | "coverage" | "newest";
export class CatalogAPIError extends Error { constructor(message: string, public status: number) { super(message); } }
export interface CatalogState { query: string; filters: CatalogOfferFilters; sort: CatalogSort; grouped: boolean; page: number; family?: string; cursor?: string }
export interface CatalogPage {
  groups: ProductGroup[]; total: number; total_groups: number; total_products: number;
  offset: number; limit: number; facets: Record<string, Record<string, number>>;
  corrected_query?: string; query: string; next_cursor?: string; catalog_version: string;
  price_min: number; price_max: number; request_id: string; processing_time_ms: number;
}
export const initialCatalogState: CatalogState = { query: "", filters: {}, sort: "relevance", grouped: true, page: 1 };
export const categoryLinks = [
  ["suplementi-i-vitamini", "Supplements & Vitamins", "Suplementi i vitamini"],
  ["kozmetika-i-nega", "Cosmetics & Skincare", "Kozmetika i nega"],
  ["lekovi", "OTC Medicines", "Lekovi bez recepta"],
  ["sportska-ishrana", "Sports Nutrition", "Sportska ishrana"],
  ["licna-nega", "Personal Care", "Lična nega"],
  ["bebe-i-mame", "Baby & Mom", "Bebe i mame"],
  ["nega-kose", "Hair Care", "Nega kose"],
  ["medicinska-oprema", "Medical Devices", "Medicinska oprema"],
  ["oralna-nega", "Oral Care", "Oralna nega"],
  ["zastita-od-sunca", "Sun Care", "Zaštita od sunca"],
  ["seksualno-zdravlje", "Sexual Health", "Seksualno zdravlje"],
] as const;

const listFields = { brand: "brands", category: "categories", vendor: "vendors", form: "forms", quantity: "quantities", dosage: "dosages" } as const;
export function parseCatalogState(params: URLSearchParams): CatalogState {
  const filters: CatalogOfferFilters = {};
  for (const [key, field] of Object.entries(listFields)) { const values = params.getAll(key).filter(Boolean); if (values.length) filters[field] = values; }
  const min = Number(params.get("minPrice")); const max = Number(params.get("maxPrice"));
  if (Number.isFinite(min) && min > 0) filters.minPrice = min;
  if (Number.isFinite(max) && max > 0) filters.maxPrice = max;
  const sort = params.get("sort") as CatalogSort;
  return { query: params.get("q") || "", filters, sort: ["relevance", "price_asc", "price_desc", "coverage", "newest"].includes(sort) ? sort : "relevance", grouped: params.get("view") !== "offers", page: Math.max(1, Math.min(40000, Math.trunc(Number(params.get("page"))) || 1)), family: params.get("family") || undefined, cursor: params.get("cursor") || undefined };
}
export function catalogParams(state: CatalogState): URLSearchParams {
  const params = new URLSearchParams(); if (state.query) params.set("q", state.query);
  for (const [key, field] of Object.entries(listFields)) for (const value of state.filters[field] || []) params.append(key, value);
  if (state.filters.minPrice) params.set("minPrice", String(state.filters.minPrice)); if (state.filters.maxPrice) params.set("maxPrice", String(state.filters.maxPrice));
  if (state.sort !== "relevance") params.set("sort", state.sort); if (!state.grouped) params.set("view", "offers");
  if (state.page > 1) params.set("page", String(state.page)); if (state.family) params.set("family", state.family); if (state.cursor) params.set("cursor", state.cursor); return params;
}
function apiBase() { return typeof window === "undefined" ? (process.env.CATALOG_API_URL || "http://127.0.0.1:50051") : window.location.origin; }
export async function fetchCatalogPage(state: CatalogState, options: { signal?: AbortSignal; cursor?: string } = {}): Promise<CatalogPage> {
  const params = catalogParams(state); params.set("offset", String((state.page - 1) * 24)); params.set("limit", "24");
  if (!state.grouped) params.set("allOffers", "1"); if (options.cursor) params.set("cursor", options.cursor);
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
  const response = await fetch(`${apiBase()}/api/catalog/search?${params}`, { signal, cache: "no-store" });
  const result = await response.json(); if (!response.ok) throw new CatalogAPIError(result.error || "Nije moguće učitati proizvode.", response.status);
  for (const [rank, group] of (result.groups as ProductGroup[]).entries()) { group.catalogFilters = state.filters; group.searchContext = { requestId: result.request_id, rank: (state.page - 1) * 24 + rank + 1 }; }
  return result;
}
export async function fetchCatalogSKU(id: string, filters: CatalogOfferFilters = {}, signal?: AbortSignal): Promise<{ group: ProductGroup; archived?: boolean }> {
  const params = catalogParams({ ...initialCatalogState, filters });
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
  const response = await fetch(`${apiBase()}/api/catalog/skus/${encodeURIComponent(id)}?${params}`, { signal: requestSignal, cache: "no-store" });
  const result = await response.json(); if (!response.ok) throw new CatalogAPIError(result.error || "Proizvod nije pronađen.", response.status); return result;
}
export async function fetchCatalogSuggestions(query: string, signal?: AbortSignal): Promise<{ suggestions: { id: string; title: string; price: number; vendor_name: string }[]; corrected_query?: string }> {
  const response = await fetch(`${apiBase()}/api/catalog/autocomplete?q=${encodeURIComponent(query)}&limit=8`, { signal });
  if (!response.ok) throw new Error("Nije moguće učitati predloge."); return response.json();
}
export function updateCatalogURL(state: CatalogState, replace = false) {
  const query = catalogParams(state).toString(); const url = query ? `/?${query}` : "/";
  window.history[replace ? "replaceState" : "pushState"](null, "", url);
  window.dispatchEvent(new Event("catalogLocationChanged"));
}
export function productPath(id: string) { return `/proizvod/${encodeURIComponent(id)}`; }
