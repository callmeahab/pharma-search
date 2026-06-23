/**
 * Fetch-based scrapers for sites that expose a clean JSON API (WooCommerce Store
 * API, Shopify products.json). These are far more robust than DOM scraping and
 * need no Puppeteer. Each helper paginates the API and writes the standard CSV via
 * insertData, and FAILS LOUD (throws) on an empty/blocked result so the worker
 * records an error instead of writing an empty success.
 */

import { insertData, Product, initializeDatabase, closeDatabase } from './database';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchJson(url: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  return { ok: res.ok, status: res.status, body };
}

// ---- WooCommerce Store API: /wp-json/wc/store/v1/products ----
interface WcProduct {
  name?: string;
  permalink?: string;
  prices?: { price?: string; currency_minor_unit?: number };
  images?: Array<{ src?: string }>;
  categories?: Array<{ name?: string }>;
  is_in_stock?: boolean;
}

export async function scrapeWooStore(
  baseUrl: string,
  shopName: string,
  opts: { perPage?: number; inStockOnly?: boolean } = {},
): Promise<Product[]> {
  const perPage = opts.perPage ?? 100;
  const root = baseUrl.replace(/\/$/, '');
  const products: Product[] = [];

  for (let page = 1; page <= 1000; page++) {
    const url = `${root}/wp-json/wc/store/v1/products?per_page=${perPage}&page=${page}`;
    const { ok, status, body } = await fetchJson(url);
    if (!ok) {
      if (page === 1) throw new Error(`${shopName}: Store API ${status} on page 1 (${url})`);
      break; // past the last page Woo returns 400/404
    }
    const batch = body as WcProduct[];
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const p of batch) {
      if (opts.inStockOnly && p.is_in_stock === false) continue;
      const title = (p.name || '').trim();
      if (!title) continue;
      const minor = p.prices?.currency_minor_unit ?? 2;
      const raw = p.prices?.price;
      const price =
        raw != null && raw !== '' ? (Number(raw) / Math.pow(10, minor)).toString() : '';
      const images = (p.images || []).map((i) => i.src).filter(Boolean) as string[];
      products.push({
        title,
        price,
        category: p.categories?.[0]?.name || '',
        link: p.permalink || '',
        thumbnail: images[0] || '',
        photos: images.join(', '),
      });
    }
    if (batch.length < perPage) break;
  }

  if (products.length === 0) {
    throw new Error(`${shopName}: WooCommerce Store API returned 0 products — failing loud`);
  }
  return products;
}

// ---- Shopify: /products.json ----
interface ShopifyProduct {
  title?: string;
  handle?: string;
  product_type?: string;
  variants?: Array<{ price?: string }>;
  images?: Array<{ src?: string }>;
}

export async function scrapeShopify(baseUrl: string, shopName: string): Promise<Product[]> {
  const root = baseUrl.replace(/\/$/, '');
  const products: Product[] = [];

  for (let page = 1; page <= 500; page++) {
    const url = `${root}/products.json?limit=250&page=${page}`;
    const { ok, status, body } = await fetchJson(url);
    if (!ok) {
      if (page === 1) throw new Error(`${shopName}: products.json ${status} on page 1 (${url})`);
      break;
    }
    const batch = ((body as { products?: ShopifyProduct[] })?.products) || [];
    if (batch.length === 0) break;

    for (const p of batch) {
      const title = (p.title || '').trim();
      if (!title) continue;
      const images = (p.images || []).map((i) => i.src).filter(Boolean) as string[];
      products.push({
        title,
        price: p.variants?.[0]?.price != null ? String(p.variants[0].price) : '',
        category: p.product_type || '',
        link: p.handle ? `${root}/products/${p.handle}` : root,
        thumbnail: images[0] || '',
        photos: images.join(', '),
      });
    }
    if (batch.length < 250) break;
  }

  if (products.length === 0) {
    throw new Error(`${shopName}: Shopify products.json returned 0 products — failing loud`);
  }
  return products;
}

// Shared runner: init -> scrape -> write -> close, with a loud, non-zero exit on failure.
export async function runApiScraper(scrape: () => Promise<Product[]>, shopName: string) {
  await initializeDatabase();
  try {
    const products = await scrape();
    await insertData(products, shopName);
    console.log(`Successfully processed ${products.length} products`);
  } finally {
    await closeDatabase();
  }
}
