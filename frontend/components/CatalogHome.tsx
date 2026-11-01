"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Filter, ChevronLeft, ChevronRight } from "lucide-react";
import Navbar from "./Navbar";
import Footer from "./Footer";
import HeroSection from "./HeroSection";
import ProductList from "./ProductList";
import ProductSkeleton from "./ProductSkeleton";
import { FilterSidebar, defaultFilters, type FilterState } from "./FilterSidebar";
import { FilterChips } from "./FilterChips";
import { ResultsToolbar } from "./ResultsToolbar";
import { Button } from "./ui/button";
import { catalogParams, categoryLinks, fetchCatalogPage, parseCatalogState, updateCatalogURL, type CatalogPage, type CatalogState } from "@/lib/catalog";
import { convertBackendProductToProduct, convertProductGroupToProducts } from "@/types/product";
import { trackSearchComplete } from "@/utils/analytics";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";

function subscribe(callback: () => void) { window.addEventListener("popstate", callback); window.addEventListener("catalogLocationChanged", callback); return () => { window.removeEventListener("popstate", callback); window.removeEventListener("catalogLocationChanged", callback); }; }
export default function CatalogHome({ initialSearch, initialPage }: { initialSearch: string; initialPage: CatalogPage | null }) {
  const search = useSyncExternalStore(subscribe, () => window.location.search.slice(1), () => initialSearch);
  const state = useMemo(() => parseCatalogState(new URLSearchParams(search)), [search]);
  const key = catalogParams(state).toString(); const [initialKey] = useState(() => catalogParams(parseCatalogState(new URLSearchParams(initialSearch))).toString());
  const [loaded, setLoaded] = useState<{ key: string; page: CatalogPage | null; error?: string }>({ key: initialKey, page: initialPage });
  const [retry, setRetry] = useState(0); const [mobileFilters, setMobileFilters] = useState(false); const resultsRef = useRef<HTMLElement>(null);
  const page = loaded.key === key ? loaded.page : null; const error = loaded.key === key ? loaded.error : undefined;
  const tracked = useRef(new Set<string>());
  const firstRequest = useRef(true);
  useEffect(() => {
    if (firstRequest.current) { firstRequest.current = false; if (key === initialKey && initialPage && retry === 0) return; }
    const abort = new AbortController(); const requested = key;
    fetchCatalogPage(state, { signal: abort.signal, cursor: state.cursor }).then(result => { if (!abort.signal.aborted) setLoaded({ key: requested, page: result }); }).catch(cause => { if (!abort.signal.aborted) setLoaded({ key: requested, page: null, error: cause instanceof Error ? cause.message : "Pretraga trenutno nije dostupna." }); });
    return () => abort.abort();
  }, [key, state, initialPage, initialKey, retry]);
  useEffect(() => {
    if (!page || tracked.current.has(page.request_id)) return; tracked.current.add(page.request_id);
    if (state.query) trackSearchComplete({ requestId: page.request_id, resultCount: page.total_groups, offerCount: page.total_products, latencyMs: page.processing_time_ms, filterCount: Object.values(state.filters).flat().filter(Boolean).length, corrected: !!page.corrected_query });
  }, [page, state.query, state.filters]);
  const change = (next: CatalogState) => { updateCatalogURL(next); resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const filters: FilterState = { ...defaultFilters, ...state.filters, brands: state.filters.brands || [], categories: state.filters.categories || [], vendors: state.filters.vendors || [], forms: state.filters.forms || [], quantities: state.filters.quantities || [], dosages: state.filters.dosages || [], groupSimilar: state.grouped };
  const onFiltersChange = (next: FilterState) => { change({ ...state, page: 1, cursor: undefined, grouped: next.groupSimilar, filters: { brands: next.brands, categories: next.categories, vendors: next.vendors, forms: next.forms, quantities: next.quantities, dosages: next.dosages, minPrice: next.minPrice, maxPrice: next.maxPrice } }); };
  const products = page?.groups.flatMap(group => state.grouped ? convertProductGroupToProducts(group) : (group.offers || group.products).map(offer => convertBackendProductToProduct(offer, group))) || [];
  const range = { min: Math.max(0, page?.price_min || 0), max: Math.max((page?.price_min || 0) + 1, page?.price_max || 50000) };
  const hasFilters = Object.values(state.filters).some(value => Array.isArray(value) ? value.length > 0 : !!value) || !!state.family;
  return <div className="min-h-screen flex flex-col bg-health-gray dark:bg-gray-900 dark:text-gray-100">
    <Navbar />
    <main className="flex-1 container mx-auto px-4 py-8">
      {!state.query && !hasFilters && <><HeroSection /><nav aria-label="Kategorije proizvoda" className="flex flex-wrap gap-2 my-6">{categoryLinks.slice(0, 6).map(([slug, , title]) => <Link key={slug} href={`/kategorija/${slug}`} className="rounded-full border px-4 py-2 text-sm bg-white hover:border-health-primary dark:bg-gray-800 dark:border-gray-700">{title}</Link>)}</nav></>}
      <section ref={resultsRef} aria-label="Rezultati pretrage" className="scroll-mt-4">
        <div className="flex items-center justify-between gap-4 mb-4"><h1 className="text-xl font-bold">{state.query ? `Rezultati za „${state.query}“` : hasFilters ? "Izabrani proizvodi" : "Uporedite ponude za isto pakovanje"}</h1><Button variant="outline" className="lg:hidden" onClick={() => setMobileFilters(true)}><Filter size={16} /> Filteri</Button></div>
        {page?.corrected_query && <p role="status" className="mb-4 text-sm">Ispravljena pretraga: <Link href={`/?q=${encodeURIComponent(page.corrected_query)}`} className="text-health-primary underline dark:text-green-300">{page.corrected_query}</Link>. Doza i pakovanje ostaju deo pretrage.</p>}
        <div className="flex gap-6">
          <aside className="hidden lg:block w-64 shrink-0"><FilterSidebar filters={filters} onFiltersChange={onFiltersChange} facets={page?.facets} priceRange={range} /></aside>
          <div className="min-w-0 flex-1">
            <ResultsToolbar groupSimilar={state.grouped} onGroupSimilarChange={grouped => { localStorage.setItem("pharma-search-grouping-prefs", JSON.stringify({ groupSimilar: grouped })); change({ ...state, grouped, page: 1, cursor: undefined }); }} totalGroups={page?.total_groups || 0} totalProducts={page?.total_products || 0} loadedGroups={page?.groups.length} sort={state.sort} onSortChange={sort => change({ ...state, sort, page: 1, cursor: undefined })} />
            <FilterChips filters={filters} onFiltersChange={onFiltersChange} facets={page?.facets} />
            {!page && !error && <div role="status" aria-live="polite" className="mt-6"><span className="sr-only">Učitavanje rezultata</span><ProductSkeleton count={6} /></div>}
            {error && <div role="alert" className="my-6 rounded-lg border p-6"><p>Pretraga trenutno nije dostupna. Pokušajte ponovo.</p><p className="text-sm text-gray-500 mt-2">{error.includes("results changed") ? "Katalog je osvežen. Otvorite prvu stranicu rezultata." : "Proverite vezu ili osvežite rezultate."}</p><Button className="mt-4" onClick={() => { if (state.cursor || state.page > 1) change({ ...state, page: 1, cursor: undefined }); else setRetry(value => value + 1); }}>Osveži rezultate</Button></div>}
            {page && <><p className="text-sm text-gray-500 my-4" role="status" aria-live="polite">{page.total_groups.toLocaleString("sr-RS")} proizvoda · {page.total_products.toLocaleString("sr-RS")} aktuelnih ponuda. Cena dostave se proverava kod prodavca.</p><ProductList products={products} /></>}
            {page && page.total_groups > 24 && <nav aria-label="Stranice rezultata" className="flex items-center justify-between mt-8 gap-3"><Button variant="outline" disabled={state.page <= 1} onClick={() => change({ ...state, page: state.page - 1, cursor: undefined })}><ChevronLeft size={16} /> Prethodna</Button><span className="text-sm">Stranica {state.page} od {Math.ceil(page.total_groups / 24)}</span><Button variant="outline" disabled={!page.next_cursor} onClick={() => change({ ...state, page: state.page + 1, cursor: page.next_cursor })}>Sledeća <ChevronRight size={16} /></Button></nav>}
          </div>
        </div>
      </section>
    </main>
    <Sheet open={mobileFilters} onOpenChange={setMobileFilters}><SheetContent side="left" className="w-[min(90vw,360px)] overflow-y-auto"><SheetTitle className="sr-only">Filteri proizvoda</SheetTitle><FilterSidebar filters={filters} onFiltersChange={onFiltersChange} facets={page?.facets} priceRange={range} onClose={() => setMobileFilters(false)} /><Button className="w-full mt-4" onClick={() => setMobileFilters(false)}>Prikaži rezultate</Button></SheetContent></Sheet>
    <Footer />
  </div>;
}
