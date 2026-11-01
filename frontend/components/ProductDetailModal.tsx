"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { PriceComparison } from "./PriceComparison";
import { PriceHistoryChart } from "./PriceHistoryChart";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/AuthContext";
import { fetchCatalogSKU, productPath } from "@/lib/catalog";
import { convertProductGroupToProducts, type Product } from "@/types/product";

export default function ProductDetailModal({ product, isOpen, onClose }: { product: Product | null; isOpen: boolean; onClose: () => void; showPriceComparison?: boolean }) {
  const mobile = useIsMobile(); const [resolved, setResolved] = useState<{ key: string; product: Product; error?: string } | null>(null); const [retry, setRetry] = useState(0);
  const skuKey = product?.historyGroupKey || product?.id || "";
  const key = `${skuKey}|${JSON.stringify(product?.catalogFilters || {})}`;
  useEffect(() => {
    if (!isOpen || !product || product.detailsComplete) return;
    const abort = new AbortController();
    fetchCatalogSKU(skuKey, product.catalogFilters, abort.signal).then(result => {
      if (abort.signal.aborted) return; const complete = convertProductGroupToProducts(result.group)[0];
      setResolved({ key, product: { ...product, prices: complete.prices, sourceOffers: complete.sourceOffers, vendorCount: complete.vendorCount, comparisonContext: complete.comparisonContext, detailsComplete: true } });
    }).catch(error => { if (!abort.signal.aborted) setResolved({ key, product, error: error instanceof Error ? error.message : "Ponude nisu dostupne." }); });
    return () => abort.abort();
  }, [isOpen, key, skuKey, product, retry]);
  if (!product) return null;
  const current = resolved?.key === key ? resolved.product : product; const error = resolved?.key === key ? resolved.error : undefined;
  const content = <ProductDetails key={key} product={current} loading={!current.detailsComplete && !error} error={error} retry={() => { setResolved(null); setRetry(value => value + 1); }} />;
  if (mobile) return <Drawer open={isOpen} onOpenChange={open => { if (!open) onClose(); }}><DrawerContent className="max-h-[92vh] overflow-y-auto"><DrawerTitle className="sr-only">{product.name}</DrawerTitle><DrawerDescription className="sr-only">Online ponude, tačno pakovanje i istorija cene</DrawerDescription>{content}</DrawerContent></Drawer>;
  return <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto"><DialogTitle className="sr-only">{product.name}</DialogTitle><DialogDescription className="sr-only">Online ponude, tačno pakovanje i istorija cene</DialogDescription>{content}</DialogContent></Dialog>;
}

function ProductDetails({ product, loading, error, retry }: { product: Product; loading: boolean; error?: string; retry: () => void }) {
  const { isWatched, toggleWatch } = useAuth(); const [all, setAll] = useState(false); const key = product.historyGroupKey || product.id;
  const prices = all && product.sourceOffers?.length ? product.sourceOffers : product.prices;
  return <div className="p-4 sm:p-6 space-y-5">
    <div className="flex items-start justify-between gap-4 pr-5"><div><h2 className="text-xl font-bold">{product.name}</h2><p className="text-sm text-gray-500 mt-1">{product.comparable ? "Ponude za potvrđeno isti proizvod i pakovanje." : "Zaseban izvorni listing. Istovetnost sa drugim proizvodima nije potvrđena."}</p></div><Button type="button" variant="outline" aria-pressed={isWatched(key)} onClick={() => toggleWatch({ groupKey: key, displayName: product.name, thumbnail: product.image })}><Heart size={18} className={isWatched(key) ? "fill-red-500 text-red-500" : ""} /><span className="sr-only sm:not-sr-only">{isWatched(key) ? "Pratite cenu" : "Prati cenu"}</span></Button></div>
    <Link href={productPath(key)} className="inline-block text-sm underline text-health-primary dark:text-green-300">Otvori stranicu proizvoda</Link>
    {loading && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="animate-spin" size={16} />Učitavam sve aktuelne ponude…</p>}
    {error && <p role="alert" className="text-sm">Nije moguće učitati sve ponude. <button type="button" className="underline" onClick={retry}>Pokušaj ponovo</button></p>}
    <Tabs defaultValue="comparison"><TabsList className="grid grid-cols-2 w-full"><TabsTrigger value="comparison">Trenutne ponude</TabsTrigger><TabsTrigger value="history">Istorija cena</TabsTrigger></TabsList><TabsContent value="comparison">
      {product.sourceOffers && product.sourceOffers.length > product.prices.length && <label className="flex gap-2 items-center text-sm mt-4"><input type="checkbox" checked={all} onChange={event => setAll(event.target.checked)} />Prikaži sve listinge istog prodavca</label>}
      {prices.length ? <PriceComparison prices={prices} productName={product.name} searchContext={product.searchContext} unitLabel={product.unitLabel} /> : <p className="py-6 text-gray-500">Trenutno nema svežih online ponuda.</p>}
    </TabsContent><TabsContent value="history"><PriceHistoryChart groupKey={key} /></TabsContent></Tabs>
  </div>;
}
