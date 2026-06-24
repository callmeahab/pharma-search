// Rewritten 2026-06-23: dm.rs renders categories via JS; the Puppeteer crawl only
// captured ~2.5k of ~18k. Use dm's public JSON product API instead (no browser).
import { insertData, Product, initializeDatabase, closeDatabase } from './helpers/database';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const API = 'https://product-search.services.dmtech.com/rs/search/crawl';
const CATEGORIES: Record<string, string> = {
  sminka: '010000', 'nega-i-parfemi': '020000', zdravlje: '030000', ishrana: '040000',
  'bebe-i-deca': '050000', domacinstvo: '060000', ljubimci: '070000', kosa: '110000',
};

// As of 2026-06: the headline moved into a nested `title` object on tileData.
interface DmTile {
  title?: { tileHeadlineLong?: string; tileHeadline?: string };
  brandName?: string;
  self?: string;
  images?: Array<{ tileSrc?: string }>;
  price?: { price?: { current?: { value?: string } } };
}
interface DmResp { count?: number; totalPages?: number; products?: Array<{ title?: string; tileData?: DmTile }> }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The API rate-limits (HTTP 429) on rapid requests — retry with backoff and stay
// polite. pageSize=500 is the largest size that reliably returns 200.
async function fetchPage(catId: string, page: number): Promise<DmResp | null> {
  const url = `${API}?query=&purchasable=true&type=search-static&allCategories.id=${catId}&pageSize=500&currentPage=${page}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Referer: 'https://www.dm.rs/', Accept: 'application/json' },
        redirect: 'follow',
      });
      if (res.status === 429) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;
      return (await res.json()) as DmResp;
    } catch {
      await sleep(1000 * (attempt + 1));
    }
  }
  return null;
}

async function scrape(): Promise<Product[]> {
  const products: Product[] = [];
  const seen = new Set<string>();
  for (const [cat, id] of Object.entries(CATEGORIES)) {
    for (let page = 0; page < 60; page++) {
      const data = await fetchPage(id, page);
      const batch = data?.products || [];
      if (batch.length === 0) break;
      for (const p of batch) {
        const t = p.tileData;
        if (!t) continue;
        const title = (t.title?.tileHeadlineLong || t.title?.tileHeadline || p.title || '').trim();
        const link = t.self ? `https://www.dm.rs${t.self}` : '';
        if (!title || !link || seen.has(link)) continue;
        seen.add(link);
        const img = t.images?.[0]?.tileSrc || '';
        products.push({
          title,
          price: (t.price?.price?.current?.value || '').replace(/RSD/i, '').trim(),
          category: cat,
          link,
          thumbnail: img,
          photos: img,
        });
      }
      if (page + 1 >= (data?.totalPages ?? 1)) break;
      await sleep(600); // be polite — the API rate-limits
    }
  }
  if (products.length === 0) throw new Error('DM: API returned 0 products — failing loud');
  return products;
}

(async () => {
  await initializeDatabase();
  try {
    const products = await scrape();
    await insertData(products, 'DM');
    console.log(`Successfully processed ${products.length} products`);
  } finally {
    await closeDatabase();
  }
})().then(() => process.exit(0)).catch((e) => { console.error('DM scraper failed:', e); process.exit(1); });
