import { siteURL } from "@/lib/catalog-server";
import { productPath, categoryLinks } from "@/lib/catalog";
export const dynamic = "force-dynamic";
const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export async function GET(_request: Request, { params }: { params: Promise<{ page: string }> }) {
  const { page } = await params; if (!/^\d{1,3}\.xml$/.test(page)) return new Response("Not found", { status: 404 }); const index = Number(page.slice(0, -4));
  const response = await fetch(`${process.env.CATALOG_API_URL || "http://127.0.0.1:50051"}/api/catalog/sitemap?page=${index}`, { cache: "no-store", signal: AbortSignal.timeout(10000) }); if (!response.ok) return new Response("Sitemap temporarily unavailable", { status: 503 });
  const { items } = await response.json() as { items: { id: string; updated_at: string }[] }; if (!items.length && index > 0) return new Response("Not found", { status: 404 });
  const categories = index === 0 ? ["/", ...categoryLinks.map(([slug]) => `/kategorija/${slug}`)].map(path => `<url><loc>${siteURL}${path}</loc></url>`).join("") : "";
  const urls = items.map(item => `<url><loc>${xml(siteURL + productPath(item.id))}</loc><lastmod>${xml(item.updated_at)}</lastmod></url>`).join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${categories}${urls}</urlset>`, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
