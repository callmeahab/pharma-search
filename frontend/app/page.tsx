import type { Metadata } from "next";
import CatalogHome from "@/components/CatalogHome";
import { fetchCatalogPage, parseCatalogState } from "@/lib/catalog";

export const dynamic = "force-dynamic";
type Params = Promise<Record<string, string | string[] | undefined>>;
function parameters(value: Record<string, string | string[] | undefined>) { const params = new URLSearchParams(); for (const [key, item] of Object.entries(value)) for (const entry of Array.isArray(item) ? item : item ? [item] : []) params.append(key, entry); return params; }
export async function generateMetadata({ searchParams }: { searchParams: Params }): Promise<Metadata> {
  const params = await searchParams; const query = typeof params.q === "string" ? params.q : "";
  return { title: query ? `${query} — cene i ponude | Apošteka` : "Apošteka — uporedite cene proizvoda i pakovanja", alternates: { canonical: "https://aposteka.rs/" }, robots: query || Object.keys(params).length ? { index: false, follow: true } : { index: true, follow: true } };
}
export default async function Home({ searchParams }: { searchParams: Params }) {
  const params = parameters(await searchParams); const state = parseCatalogState(params);
  const initialPage = await fetchCatalogPage(state).catch(() => null);
  return <CatalogHome initialSearch={params.toString()} initialPage={initialPage} />;
}
