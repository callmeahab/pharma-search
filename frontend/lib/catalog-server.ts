import { cache } from "react";
import { fetchCatalogSKU, CatalogAPIError } from "./catalog";
export const loadCatalogProduct = cache(async (value: string) => { let id: string; try { id = decodeURIComponent(value); } catch { return null; } if (!/^(sku|offer):v2:[a-f0-9]{32}$/.test(id)) return null; try { return await fetchCatalogSKU(id); } catch (error) { if (error instanceof CatalogAPIError && error.status === 404) return null; throw error; } });
export const siteURL = "https://aposteka.rs";
export async function catalogStatus(): Promise<{ current_skus: number }> { const result = await fetch(`${process.env.CATALOG_API_URL || "http://127.0.0.1:50051"}/api/catalog/status`, { cache: "no-store", signal: AbortSignal.timeout(10000) }); if (!result.ok) throw new Error("Katalog nije dostupan."); return result.json(); }
