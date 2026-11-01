import { closeDatabase, initializeDatabase, insertData, type Product } from './database';
import { reportScraperFailure, requestText, ScraperFailure } from './http';

interface AnanasHit {
  objectID?: string | number;
  price?: number;
  onStock?: boolean;
  available?: number;
  product?: { name?: string; slug?: string; coverImageUrl?: string; thumbnailUrl?: string; categoryNames?: string[] };
}

export interface AnanasPage {
  products: Product[];
  page: number;
  pages: number;
  total: number;
  hitIds: string[];
  skipped: number;
}

// The current site renders its catalog as JSON before hydration. Read that
// payload instead of generated CSS classes, lazy images or rendered price text.
export function parseAnanasPage(html: string, url: string, expectedPage: number): AnanasPage {
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .find(text => /window\[Symbol\.for\(["']InstantSearchInitialResults["']\)\]\s*=/.test(text));
  if (!script) {
    // The site renders no search payload when a category is explicitly sold out.
    if (expectedPage === 1 && /id=["']category-page-empty-state-identifier["']/.test(html)
      && /data-testid=["']empty-state-title["']/.test(html)) {
      return { products: [], page: 0, pages: 0, total: 0, hitIds: [], skipped: 0 };
    }
    throw new ScraperFailure(`${url}: missing Ananas catalog payload`, 'incomplete');
  }
  let state: Record<string, { results?: Array<{ hits?: AnanasHit[]; page?: number; nbPages?: number; nbHits?: number }> }>;
  try { state = JSON.parse(script.slice(script.indexOf('=') + 1).trim().replace(/;\s*$/, '')); }
  catch { throw new ScraperFailure(`${url}: invalid Ananas catalog JSON`, 'incomplete'); }
  const result = Object.values(state).flatMap(value => value.results || [])
    .find(value => Array.isArray(value.hits));
  if (!result || !Number.isInteger(result.page) || !Number.isInteger(result.nbPages)
    || !Number.isInteger(result.nbHits) || result.page !== expectedPage - 1) {
    throw new ScraperFailure(`${url}: invalid or repeated Ananas pagination`, 'incomplete');
  }
  if (result.nbHits! > 0 && result.hits!.length === 0 && expectedPage <= result.nbPages!) {
    throw new ScraperFailure(`${url}: empty page inside the Ananas catalog`, 'incomplete');
  }
  const products: Product[] = [];
  const hitIds: string[] = [];
  let skipped = 0;
  for (const hit of result.hits!) {
    const id = String(hit.objectID || '');
    hitIds.push(id);
    if (hit.onStock === false || hit.available === 0) { skipped++; continue; }
    const product = hit.product;
    if (!product?.name?.trim() || !product.slug || !/^\d+$/.test(id)
      || !Number.isFinite(hit.price) || hit.price! <= 0) {
      throw new ScraperFailure(`${url}: incomplete in-stock product ${id}`, 'incomplete');
    }
    const image = product.coverImageUrl || product.thumbnailUrl || '';
    const imageUrl = image ? new URL(image, 'https://static.ananas.rs').href : '';
    products.push({
      title: product.name.trim(), price: String(Math.round(hit.price!)),
      category: product.categoryNames?.[0] || new URL(url).pathname.split('/').pop() || '',
      link: `https://ananas.rs/proizvod/${product.slug}/${id}`,
      thumbnail: imageUrl, photos: imageUrl,
    });
  }
  return { products, page: result.page!, pages: result.nbPages!, total: result.nbHits!, hitIds, skipped };
}

export function decodeNextJsImageUrl(src: string) {
  const encoded = src.match(/url=(.*?)(&|$)/)?.[1];
  return encoded ? decodeURIComponent(encoded) : src;
}

export async function scrapeAnanasCategoryUrls(categoryUrls: string[]): Promise<{ products: Product[]; totalSkipped: number }> {
  const products = new Map<string, Product>();
  let totalSkipped = 0;
  for (const categoryUrl of [...new Set(categoryUrls)]) {
    let pages = 1;
    const seen = new Set<string>();
    for (let page = 1; page <= pages; page++) {
      const url = new URL(categoryUrl);
      url.searchParams.set('page', String(page));
      const response = await requestText(url.href);
      const data = parseAnanasPage(response.body, url.href, page);
      if (page === 1) {
        pages = data.pages;
        if (pages > 2000 || pages < 0) throw new ScraperFailure(`${url}: invalid page count`, 'incomplete');
        console.log(`Ananas: ${categoryUrl}: ${data.total} products, ${pages} pages`);
      }
      const signature = data.hitIds.join(',');
      if (data.hitIds.length && seen.has(signature)) {
        throw new ScraperFailure(`${url}: repeated catalog page`, 'incomplete');
      }
      seen.add(signature);
      totalSkipped += data.skipped;
      for (const product of data.products) products.set(product.link, product);
      console.log(`Ananas: page ${page}/${pages}, ${data.products.length} priced products`);
    }
  }
  if (!products.size) throw new ScraperFailure('Ananas: no available priced products', 'incomplete');
  return { products: [...products.values()], totalSkipped };
}

export async function runAnanasScraper(categoryUrls: string[], scraperName: string) {
  try {
    await initializeDatabase();
    const { products } = await scrapeAnanasCategoryUrls(categoryUrls);
    await insertData(products, 'Ananas');
    console.log(`${scraperName}: Successfully stored ${products.length} products`);
  } catch (error) {
    reportScraperFailure(error);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}
