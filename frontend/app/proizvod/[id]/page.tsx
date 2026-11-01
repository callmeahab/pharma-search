import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { PriceComparison } from "@/components/PriceComparison";
import { PriceHistoryChart } from "@/components/PriceHistoryChart";
import { ProductPageActions, ProductImage } from "@/components/ProductPageActions";
import { convertProductGroupToProducts } from "@/types/product";
import { loadCatalogProduct, siteURL } from "@/lib/catalog-server";
import { productPath } from "@/lib/catalog";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params; const result = await loadCatalogProduct(id); if (!result) return { title: "Proizvod nije pronađen | Apošteka", robots: { index: false } };
  const group = result.group; return { title: `${group.normalized_name} — cene i ponude | Apošteka`, description: `Aktuelne online ponude za ${group.normalized_name}. Proverite pakovanje, prodavce i istoriju cene.`, alternates: { canonical: `${siteURL}${productPath(group.id)}` }, openGraph: { title: group.normalized_name, url: `${siteURL}${productPath(group.id)}`, images: group.products[0]?.thumbnail ? [group.products[0].thumbnail] : [] } };
}
export default async function ProductPage({ params }: Props) {
  const { id } = await params; const result = await loadCatalogProduct(id); if (!result) notFound(); const { group } = result;
  const product = convertProductGroupToProducts(group)[0];
  const structured: Record<string, unknown> = { "@context": "https://schema.org", "@type": "Product", "@id": `${siteURL}${productPath(group.id)}`, name: group.normalized_name, url: `${siteURL}${productPath(group.id)}`, image: group.products[0]?.thumbnail || undefined, brand: group.brand ? { "@type": "Brand", name: group.brand } : undefined };
  if (group.gtin && [8, 12, 13, 14].includes(group.gtin.length)) structured[`gtin${group.gtin.length}`] = group.gtin;
  if (group.products.length) structured.offers = { "@type": "AggregateOffer", priceCurrency: "RSD", lowPrice: group.price_range.min, highPrice: group.price_range.max, offerCount: group.vendor_count, offers: group.products.map(offer => ({ "@type": "Offer", price: offer.price, priceCurrency: "RSD", url: offer.link, seller: { "@type": "Organization", name: offer.vendor_name }, availability: offer.availability === "available" ? "https://schema.org/InStock" : undefined })) };
  return <div className="min-h-screen bg-health-gray dark:bg-gray-900 dark:text-gray-100"><Navbar /><main className="container mx-auto px-4 py-8 max-w-6xl"><nav aria-label="Putanja" className="text-sm mb-6"><Link href="/" className="underline">Proizvodi</Link> / {group.normalized_name}</nav><div className="grid md:grid-cols-[320px_1fr] gap-8"><ProductImage src={group.products[0]?.thumbnail} alt={group.normalized_name} /><section className="space-y-5"><h1 className="text-2xl font-bold">{group.normalized_name}</h1><p className="text-gray-600 dark:text-gray-300">{group.comparable ? "Poredimo potvrđeno isti proizvod i pakovanje kod različitih prodavaca." : "Ovo je zaseban izvorni listing. Istovetnost pakovanja sa drugim proizvodima nije potvrđena."}</p><ProductPageActions group={group} />{result.archived && <p role="status">Trenutno nema svežih online ponuda. Proizvod možete sačuvati za kasnije.</p>}<PriceComparison prices={product.prices} productName={product.name} unitLabel={product.unitLabel} /></section></div><PriceHistoryChart groupKey={group.id} /><section className="mt-8"><h2 className="text-lg font-semibold mb-2">Pronađite slične proizvode</h2><p className="text-sm text-gray-500 mb-3">Sličan sastojak ili namena ne potvrđuju isti proizvod, dozu ili pakovanje.</p><Link className="underline text-health-primary dark:text-green-300" href={`/srodni/${encodeURIComponent(group.family_id || "")}`}>Pogledaj proizvode iz iste porodice</Link></section><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structured).replace(/</g, "\\u003c") }} /></main><Footer /></div>;
}
