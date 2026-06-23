/**
 * Generic sitemap-driven scraper.
 *
 * Many vendors under-cover because their scraper crawls a hardcoded subset of
 * categories. But almost all of them publish a product sitemap AND render
 * schema.org/JSON-LD (or OpenGraph) product metadata on each product page. So we
 * can recover the FULL catalog with no per-site selectors and no Puppeteer:
 *   discover product URLs from the sitemap -> fetch each page -> parse JSON-LD/og.
 *
 * Use for vendors whose product pages are curl-able (NOT Cloudflare-gated).
 */

import { gunzipSync } from 'node:zlib';
import { insertData, Product, initializeDatabase, closeDatabase } from './database';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface SitemapOpts {
  productSitemaps?: string[]; // explicit product sitemap URLs (skip discovery)
  productUrlPattern?: RegExp; // keep only product URLs matching this (for mixed sitemaps)
  concurrency?: number; // parallel page fetches (default 6)
  maxUrls?: number; // cap (for testing)
}

async function fetchText(url: string, timeoutMs = 25000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'sr,en;q=0.9' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    if (url.endsWith('.gz')) {
      return gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf-8');
    }
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}

function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1].trim()));
}

// Bounded-concurrency map.
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      try { results[i] = await fn(items[i], i); } catch { results[i] = undefined as unknown as R; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Discover product URLs: explicit hint > robots.txt sitemaps > /sitemap.xml.
// Recurses through sitemap indexes, preferring product-specific child sitemaps.
export async function discoverProductUrls(baseUrl: string, opts: SitemapOpts = {}): Promise<string[]> {
  const root = baseUrl.replace(/\/$/, '');
  let entry: string[] = [];
  if (opts.productSitemaps?.length) {
    entry = opts.productSitemaps;
  } else {
    const robots = await fetchText(`${root}/robots.txt`, 15000);
    const fromRobots = robots ? [...robots.matchAll(/Sitemap:\s*(\S+)/gi)].map((m) => m[1].trim()) : [];
    entry = fromRobots.length ? fromRobots : [`${root}/sitemap.xml`];
  }

  const productUrls = new Set<string>();
  const seen = new Set<string>();
  const queue = [...entry];
  let guard = 0;
  while (queue.length && guard++ < 5000) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm);
    const xml = await fetchText(sm);
    if (!xml) continue;
    const locs = extractLocs(xml);
    if (/<sitemapindex/i.test(xml)) {
      let children = locs;
      const productChildren = children.filter((u) => /product|proizvod/i.test(u));
      if (productChildren.length && !opts.productSitemaps) children = productChildren;
      queue.push(...children);
    } else {
      for (const u of locs) {
        if (opts.productUrlPattern && !opts.productUrlPattern.test(u)) continue;
        productUrls.add(u);
      }
    }
  }
  return [...productUrls];
}

// ---- product page parsing (JSON-LD first, OpenGraph/meta fallback) ----
function firstImage(img: unknown): string {
  if (!img) return '';
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return firstImage(img[0]);
  if (typeof img === 'object') {
    const o = img as Record<string, unknown>;
    return (o.url as string) || (o['@id'] as string) || '';
  }
  return '';
}

function extractOfferPrice(offers: unknown): string {
  if (!offers) return '';
  const o = (Array.isArray(offers) ? offers[0] : offers) as Record<string, unknown>;
  if (!o) return '';
  const p = o.price ?? o.lowPrice ?? o.highPrice;
  return p != null ? String(p) : '';
}

function findProductNode(node: unknown): Record<string, unknown> | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const p = findProductNode(n);
      if (p) return p;
    }
    return null;
  }
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>;
    const t = o['@type'];
    if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) return o;
    if (o['@graph']) return findProductNode(o['@graph']);
  }
  return null;
}

function metaContent(html: string, key: string): string {
  const re1 = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${key}["'][^>]+content=["']([^"']*)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name|itemprop)=["']${key}["']`, 'i');
  const m = html.match(re1) || html.match(re2);
  return m ? decodeEntities(m[1]).trim() : '';
}

export function parseProductPage(html: string, url: string): Product | null {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    let data: unknown;
    try { data = JSON.parse(b[1].trim()); } catch { continue; }
    const prod = findProductNode(data);
    if (prod) {
      const title = typeof prod.name === 'string' ? prod.name.trim() : '';
      if (!title) continue;
      return {
        title,
        price: extractOfferPrice(prod.offers),
        category: typeof prod.category === 'string' ? prod.category : '',
        link: url,
        thumbnail: firstImage(prod.image),
        photos: firstImage(prod.image),
      };
    }
  }
  // OpenGraph / microdata fallback
  const rawTitle = metaContent(html, 'og:title');
  if (rawTitle) {
    // Strip a trailing site-name suffix ("Product | eApoteka", "Product — Shop").
    const title = rawTitle.replace(/\s*[|–—]\s*[^|–—]{1,40}\s*$/, '').replace(/,\s*$/, '').trim() || rawTitle;
    const price =
      metaContent(html, 'product:price:amount') ||
      metaContent(html, 'og:price:amount') ||
      metaContent(html, 'price') ||
      microdataPrice(html);
    return { title, price, category: '', link: url, thumbnail: metaContent(html, 'og:image'), photos: '' };
  }
  return null;
}

// Microdata price: <meta itemprop="price" content="X"> or <span itemprop="price">X</span>.
function microdataPrice(html: string): string {
  const m1 = html.match(/itemprop=["']price["'][^>]*\bcontent=["']([0-9][0-9.,]*)["']/i)
    || html.match(/\bcontent=["']([0-9][0-9.,]*)["'][^>]*itemprop=["']price["']/i);
  if (m1) return m1[1];
  const m2 = html.match(/itemprop=["']price["'][^>]*>([^<]*[0-9][0-9.,]*)/i);
  return m2 ? m2[1].trim() : '';
}

export async function scrapeSitemapVendor(baseUrl: string, shopName: string, opts: SitemapOpts = {}): Promise<Product[]> {
  let urls = await discoverProductUrls(baseUrl, opts);
  if (urls.length === 0) throw new Error(`${shopName}: no product URLs discovered from sitemap`);
  if (opts.maxUrls) urls = urls.slice(0, opts.maxUrls);
  console.log(`${shopName}: ${urls.length} product URLs to fetch`);

  let done = 0;
  const parsed = await mapPool(urls, opts.concurrency ?? 6, async (u) => {
    const html = await fetchText(u);
    done++;
    if (done % 500 === 0) console.log(`${shopName}: fetched ${done}/${urls.length}`);
    return html ? parseProductPage(html, u) : null;
  });

  const products = parsed.filter((p): p is Product => !!p && !!p.title);
  if (products.length === 0) {
    throw new Error(`${shopName}: parsed 0 products from ${urls.length} pages — failing loud`);
  }
  console.log(`${shopName}: parsed ${products.length}/${urls.length} products`);
  return products;
}

// Convenience runner mirroring apiScrapers.runApiScraper (ensures output dir).
export async function runSitemapScraper(baseUrl: string, shopName: string, opts: SitemapOpts = {}) {
  await initializeDatabase();
  try {
    const products = await scrapeSitemapVendor(baseUrl, shopName, opts);
    await insertData(products, shopName);
    console.log(`Successfully processed ${products.length} products`);
  } finally {
    await closeDatabase();
  }
}
