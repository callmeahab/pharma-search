import { type Product } from './database';
import { requestText, ScraperFailure } from './http';

interface MaeliaGroup { code: string; name: string }
interface MaeliaItem {
  id: number; name: string; code: string; group_code: string;
  price: number; price_crossed?: number; is_available?: boolean; images?: string[];
}
type TransferState = Record<string, { list?: unknown[]; total?: number }>;

export function parseMaeliaState(html: string): TransferState {
  const raw = html.match(/<script\b[^>]*\bid=["']ap-root-state["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!raw) throw new ScraperFailure('Maelia: missing catalog transfer state', 'incomplete');
  // Angular's TransferState escaping is not HTML entity escaping. Decode once,
  // so a literal "&q;" inside a product name stays literal after JSON parsing.
  const escapes: Record<string, string> = { a: '&', q: '"', s: "'", l: '<', g: '>' };
  try { return JSON.parse(raw.replace(/&([aqslg]);/g, (_, c: string) => escapes[c])); }
  catch { throw new ScraperFailure('Maelia: invalid catalog transfer state', 'incomplete'); }
}

export function parseMaeliaGroups(html: string): MaeliaGroup[] {
  const state = parseMaeliaState(html);
  const entry = Object.entries(state).find(([key]) => key.startsWith('/site/v1/groups') && key.includes('is_root'));
  const groups = entry?.[1].list as MaeliaGroup[] | undefined;
  if (!groups?.length || groups.some(group => !group.code || !group.name)) {
    throw new ScraperFailure('Maelia: catalog categories are missing', 'incomplete');
  }
  return groups;
}

export function parseMaeliaPage(html: string, group: MaeliaGroup, page: number) {
  const state = parseMaeliaState(html);
  const entry = Object.entries(state).find(([key]) => key.startsWith('/site/v1/items'));
  if (!entry) throw new ScraperFailure(`Maelia ${group.code}: missing product list`, 'incomplete');
  let params: { page?: number; count?: number; group_code?: string };
  try { params = JSON.parse(JSON.parse(entry[0].slice('/site/v1/items'.length)).data); }
  catch { throw new ScraperFailure(`Maelia ${group.code}: missing pagination metadata`, 'incomplete'); }
  const data = entry[1];
  if (params.page !== page || params.group_code !== group.code || !params.count
    || !Number.isInteger(data.total) || !Array.isArray(data.list)) {
    throw new ScraperFailure(`Maelia ${group.code}: invalid or repeated page ${page}`, 'incomplete');
  }
  const expectedRows = Math.max(0, Math.min(params.count, data.total! - (page - 1) * params.count));
  if (data.list.length !== expectedRows) {
    throw new ScraperFailure(`Maelia ${group.code}: incomplete page ${page}`, 'incomplete');
  }
  const products: Product[] = [];
  const ids: number[] = [];
  for (const item of data.list as MaeliaItem[]) {
    ids.push(item.id);
    if (item.is_available === false || item.price == null || item.price === 0) continue;
    if (!item.name?.trim() || !item.code || !item.group_code || !Number.isFinite(item.price) || item.price < 0) {
      throw new ScraperFailure(`Maelia: incomplete priced product ${item.id}`, 'incomplete');
    }
    products.push({
      title: item.name.trim(), price: String(Math.round(item.price)), category: group.name,
      link: `https://maelia.rs/sr/catalog/${encodeURIComponent(item.group_code)}/${encodeURIComponent(item.code)}`,
      thumbnail: item.images?.[0] || '', photos: item.images?.join(', ') || '',
    });
  }
  return { products, ids, pages: Math.ceil(data.total! / params.count), total: data.total! };
}

export async function scrapeMaelia(): Promise<Product[]> {
  const root = await requestText('https://maelia.rs/sr/catalog');
  const groups = parseMaeliaGroups(root.body);
  const products = new Map<string, Product>();
  let next = 0;
  async function worker() {
    while (next < groups.length) {
      const group = groups[next++];
      let pages = 1;
      const seen = new Set<string>();
      for (let page = 1; page <= pages; page++) {
        const url = `https://maelia.rs/sr/catalog/${group.code}?page=${page}`;
        const response = await requestText(url);
        const data = parseMaeliaPage(response.body, group, page);
        if (page === 1) {
          pages = data.pages;
          if (pages > 2000) throw new ScraperFailure(`${url}: invalid page count`, 'incomplete');
          console.log(`Maelia: ${group.name}: ${data.total} products, ${pages} pages`);
        }
        const signature = data.ids.join(',');
        if (signature && seen.has(signature)) throw new ScraperFailure(`${url}: repeated catalog page`, 'incomplete');
        seen.add(signature);
        for (const product of data.products) products.set(product.link, product);
        console.log(`Maelia: ${group.name} ${page}/${pages}, ${data.products.length} priced products`);
      }
    }
  }
  await Promise.all([worker(), worker()]);
  if (!products.size) throw new ScraperFailure('Maelia: no priced products', 'incomplete');
  return [...products.values()];
}
