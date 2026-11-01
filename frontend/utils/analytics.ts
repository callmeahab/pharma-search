import { readAnalyticsConsent, writeAnalyticsConsent } from "@/lib/analytics-consent";

function allowed() { return typeof window !== "undefined" && readAnalyticsConsent() === "accepted"; }
export function setCookieConsent(hasConsent: boolean) {
  writeAnalyticsConsent(hasConsent ? "accepted" : "declined");
  // Remove cookies left by the previous analytics implementation. New collection
  // is limited to first-party aggregate events and never loads third-party code.
  for (const item of document.cookie.split(";")) {
    const name = item.split("=")[0].trim();
    if (/^_ga|^_gid$|^_gat/.test(name)) for (const domain of ["", `;domain=${window.location.hostname}`, `;domain=.${window.location.hostname}`]) document.cookie = `${name}=;max-age=0;path=/${domain};SameSite=Lax`;
  }
}
type Context = { requestId: string; rank: number };
export type SearchCompletion = { requestId: string; resultCount: number; offerCount: number; latencyMs: number; filterCount: number; corrected: boolean };
function firstParty(payload: Record<string, string | number | boolean | undefined>) {
  if (!allowed()) return;
  void fetch("/api/catalog/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), keepalive: true }).catch(() => {});
}
export function trackSearchComplete(value: SearchCompletion) {
  firstParty({ kind: "search_complete", request_id: value.requestId, result_count: value.resultCount, offer_count: value.offerCount, latency_ms: Math.round(value.latencyMs), filter_count: value.filterCount, corrected: value.corrected });
}
export function trackProductClick(_id: string, _name: string, _category: string, context?: Context) {
  firstParty({ kind: "product_click", request_id: context?.requestId, rank: context?.rank });
}
export function trackStoreClick(_store: string, _url: string, _product: string | null = null, context?: Context) {
  firstParty({ kind: "store_click", request_id: context?.requestId, rank: context?.rank });
}
