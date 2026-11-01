import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ProductList from "@/components/ProductList";
import { categoryLinks, fetchCatalogPage, initialCatalogState } from "@/lib/catalog";
import { convertProductGroupToProducts } from "@/types/product";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> };
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> { const { slug } = await params; const page = Math.max(1, Math.trunc(Number((await searchParams).page)) || 1); const item = categoryLinks.find(value => value[0] === slug); return { title: `${item?.[2] || "Proizvodi"} — cene i ponude | Apošteka`, alternates: { canonical: `https://aposteka.rs/kategorija/${slug}${page > 1 ? `?page=${page}` : ""}` } }; }
export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params; const category = categoryLinks.find(value => value[0] === slug); if (!category) notFound(); const current = Math.max(1, Math.min(40000, Math.trunc(Number((await searchParams).page)) || 1));
  const result = await fetchCatalogPage({ ...initialCatalogState, page: current, sort: "coverage", filters: { categories: [category[1]] } });
  return <div className="min-h-screen bg-health-gray dark:bg-gray-900 dark:text-gray-100"><Navbar /><main className="container mx-auto px-4 py-8"><h1 className="text-2xl font-bold mb-3">{category[2]}</h1><p className="text-gray-500 mb-6">{result.total_groups.toLocaleString("sr-RS")} proizvoda. Cene se porede za isto potvrđeno pakovanje.</p><Link className="underline inline-block mb-6" href={`/?category=${encodeURIComponent(category[1])}`}>Otvori pretragu i sve filtere</Link><ProductList products={result.groups.flatMap(convertProductGroupToProducts)} /><nav aria-label="Stranice kategorije" className="flex justify-between mt-8">{current > 1 ? <Link href={`?page=${current - 1}`} className="underline">Prethodna</Link> : <span />}{current * 24 < result.total_groups && <Link href={`?page=${current + 1}`} className="underline">Sledeća</Link>}</nav></main><Footer /></div>;
}
