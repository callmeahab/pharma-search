export type AnalyticsConsent = "accepted" | "declined" | "unset";
export const consentKey = "analytics-consent-v2";
let sessionChoice: AnalyticsConsent = "unset";
export function readAnalyticsConsent(): AnalyticsConsent {
  if (typeof window === "undefined") return "unset";
  try { const value = localStorage.getItem(consentKey); return value === "accepted" || value === "declined" ? value : sessionChoice; } catch { return sessionChoice; }
}
export function writeAnalyticsConsent(value: Exclude<AnalyticsConsent, "unset">) {
  sessionChoice = value; try { localStorage.setItem(consentKey, value); } catch { /* a private session can still remember an explicit choice */ }
  window.dispatchEvent(new Event("analyticsConsentChanged"));
}
export function analyticsPath(path: string) { return path.startsWith("/proizvod/") ? "/proizvod/[id]" : path.startsWith("/srodni/") ? "/srodni/[id]" : path.startsWith("/kategorija/") ? "/kategorija/[slug]" : path.split("?")[0]; }
