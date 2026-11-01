import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ProductList from "@/components/ProductList";
import { fetchCatalogPage, initialCatalogState } from "@/lib/catalog";
import { convertProductGroupToProducts } from "@/types/product";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Slični proizvodi | Apošteka", robots: { index: false, follow: true } };
export default async function FamilyPage({ params }: { params: Promise<{ family: string }> }) { const { family: encodedFamily } = await params; let family: string; try { family = decodeURIComponent(encodedFamily); } catch { notFound(); } if (!/^family:[a-f0-9]{32}$/.test(family)) notFound(); const result = await fetchCatalogPage({ ...initialCatalogState, family }); return <div className="min-h-screen bg-health-gray dark:bg-gray-900 dark:text-gray-100"><Navbar /><main className="container mx-auto px-4 py-8"><h1 className="text-2xl font-bold mb-3">Slični proizvodi</h1><p className="text-gray-500 mb-6">Različiti brendovi, sastavi, doze i pakovanja prikazani su odvojeno. Sličnost ne znači istovetnost proizvoda.</p><ProductList products={result.groups.flatMap(convertProductGroupToProducts)} /><a className="inline-block mt-6 underline" href={`/?family=${encodeURIComponent(family)}`}>Otvori sve rezultate i filtere</a></main><Footer /></div>; }
