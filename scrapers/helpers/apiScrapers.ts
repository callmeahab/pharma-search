/**
 * Fetch-based scrapers for sites that expose a clean JSON API (WooCommerce Store
 * API, Shopify products.json). These are far more robust than DOM scraping and
 * need no Puppeteer. Each helper paginates the API and writes the standard CSV via
 * insertData, and FAILS LOUD (throws) on an empty/blocked result so the worker
 * records an error instead of writing an empty success.
 */

import { insertData, Product, initializeDatabase, closeDatabase } from './database';
import { reportScraperFailure, requestText, ScraperFailure } from './http';

async function fetchJson(url: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await requestText(url, { accept: 'application/json', allowedStatuses: [400, 404] });
  let body: unknown = null;
  try {
    body = JSON.parse(res.body);
  } catch {
    if (res.status >= 200 && res.status < 300) throw new ScraperFailure(`${url}: invalid catalog JSON`, 'incomplete');
  }
  return { ok: res.status >= 200 && res.status < 300, status: res.status, body };
}

// ---- WooCommerce Store API: /wp-json/wc/store/v1/products ----
interface WcProduct {
  name?: string;
  permalink?: string;
  prices?: { price?: string; currency_minor_unit?: number };
  images?: Array<{ src?: string }>;
  categories?: Array<{ name?: string }>;
  is_in_stock?: boolean;
  global_unique_id?: string;
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
      const code = (body as { code?: string } | null)?.code;
      if (page > 1 && status === 400 && code?.endsWith('invalid_page_number')) break;
      throw new ScraperFailure(`${shopName}: Store API ${status} on page ${page} (${url})`, 'unavailable', status);
    }
    const batch = body as WcProduct[];
    if (!Array.isArray(batch)) throw new ScraperFailure(`${shopName}: invalid Store API product list`, 'incomplete');
    if (batch.length === 0) break;

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
        availability: p.is_in_stock === true ? 'available' : p.is_in_stock === false ? 'unavailable' : 'unknown',
        gtin: p.global_unique_id || '',
      });
    }
    if (batch.length < perPage) break;
    if (page === 1000) throw new ScraperFailure(`${shopName}: pagination limit reached`, 'incomplete');
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
  variants?: Array<{ id?: number; title?: string; price?: string; available?: boolean; barcode?: string }>;
  images?: Array<{ src?: string }>;
}

export async function scrapeShopify(baseUrl: string, shopName: string): Promise<Product[]> {
  const root = baseUrl.replace(/\/$/, '');
  const products: Product[] = [];

  for (let page = 1; page <= 500; page++) {
    const url = `${root}/products.json?limit=250&page=${page}`;
    const { ok, status, body } = await fetchJson(url);
    if (!ok) {
      throw new ScraperFailure(`${shopName}: products.json ${status} on page ${page} (${url})`, 'unavailable', status);
    }
    const batch = (body as { products?: ShopifyProduct[] })?.products;
    if (!Array.isArray(batch)) throw new ScraperFailure(`${shopName}: invalid Shopify product list`, 'incomplete');
    if (batch.length === 0) break;

    for (const p of batch) {
      const title = (p.title || '').trim();
      if (!title) continue;
      const images = (p.images || []).map((i) => i.src).filter(Boolean) as string[];
      for (const variant of p.variants || []) {
        const variantTitle = variant.title && variant.title !== 'Default Title' ? ` ${variant.title}` : '';
        const link = p.handle ? `${root}/products/${p.handle}${variant.id ? `?variant=${variant.id}` : ''}` : root;
        products.push({
          title: title + variantTitle,
          price: variant.price != null ? String(variant.price) : '',
          category: p.product_type || '', link,
          thumbnail: images[0] || '', photos: images.join(', '),
          availability: variant.available === true ? 'available' : variant.available === false ? 'unavailable' : 'unknown',
          gtin: variant.barcode || '',
        });
      }
    }
    if (batch.length < 250) break;
    if (page === 500) throw new ScraperFailure(`${shopName}: pagination limit reached`, 'incomplete');
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
  } catch (error) {
    reportScraperFailure(error);
    throw error;
  } finally {
    await closeDatabase();
  }
}
