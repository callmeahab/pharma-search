import { parsePrice, type Product } from './database';
import { cleanTitle } from './hygiene';
import { requestText, ScraperFailure } from './http';

interface PriceSelector { selector: string; attribute?: string }
export interface ListingConfig {
  urls: string[];
  card: string;
  title: string;
  brand?: string;
  link: string;
  image: string;
  prices: PriceSelector[];
  unavailable?: string;
  available?: string;
  pagination: string;
  empty: string;
  eapotekaDecimals?: boolean;
  category?: string;
  categoryLinks?: string;
  prepareCategory?: (url: string) => string;
  pageNumber: (url: string) => number;
}
interface Card {
  title: string; brand: string; link: string; image: string; alt: string;
  prices: string[]; decimals: string; ignorePrice: number;
  unavailable: boolean; available: boolean;
}

export async function parseListingPage(html: string, url: string, config: ListingConfig) {
  const cards: Card[] = [];
  let current: Card | undefined;
  const links = new Set<string>();
  const categories = new Set<string>();
  let explicitlyEmpty = false;
  const root = (selector: string) => selector.split(',').map(s => `${config.card} ${s.trim()}`).join(',');
  const rewrite = new HTMLRewriter()
    .on(config.card, { element(element) {
      current = { title: '', brand: '', link: '', image: '', alt: '', prices: [], decimals: '', ignorePrice: 0, unavailable: false, available: false };
      cards.push(current);
      element.onEndTag(() => { current = undefined; });
    } })
    .on(root(config.title), { text(text) { if (current) current.title += text.text; } })
    .on(root(config.link), { element(element) {
      const href = element.getAttribute('href');
      if (current && !current.link && href) current.link = new URL(href, url).href;
    } })
    .on(root(config.image), { element(element) {
      if (!current) return;
      current.alt ||= element.getAttribute('alt') || '';
      const source = ['data-src', 'data-original', 'src'].map(key => element.getAttribute(key))
        .find(value => value && !value.startsWith('data:'));
      if (source && !current.image) current.image = new URL(source, url).href;
    } })
    .on(config.pagination, { element(element) {
      const href = element.getAttribute('href');
      if (href) links.add(new URL(href, url).href);
    } })
    .on(config.empty, { element() { explicitlyEmpty = true; } });
  if (config.unavailable) rewrite.on(root(config.unavailable), { element() { if (current) current.unavailable = true; } });
  if (config.brand) rewrite.on(root(config.brand), { text(text) { if (current) current.brand+=text.text; } });
  if (config.categoryLinks) rewrite.on(config.categoryLinks, { element(element) {
    const href=element.getAttribute('href');
    if (href) {
      const target=new URL(href,url);
      if (target.origin===new URL(url).origin) categories.add(target.href);
    }
  } });
  if (config.available) rewrite.on(root(config.available), { element() { if (current) current.available = true; } });
  config.prices.forEach((price, index) => {
    rewrite.on(root(price.selector), {
      element(element) {
        if (current && price.attribute && !current.prices[index]) {
          const raw = element.getAttribute(price.attribute);
          if (raw != null && raw !== '') current.prices[index] = String(Math.round(Number(raw)));
        }
      },
      text(text) {
        if (current && !price.attribute && !current.ignorePrice) current.prices[index] = (current.prices[index] || '') + text.text;
      },
    });
  });
  if (config.eapotekaDecimals) {
    rewrite.on(root('.price_decimal, .price_currency, .old-price'), {
      element(element) {
        const card = current;
        if (!card) return;
        card.ignorePrice++;
        element.onEndTag(() => { card.ignorePrice--; });
      },
    });
    rewrite.on(root('.price .price_decimal'), { text(text) { if (current) current.decimals += text.text; } });
  }
  await rewrite.transform(new Response(html)).text();
  const products: Product[] = [];
  for (const card of cards) {
    if (card.unavailable || (config.available && !card.available)) continue;
    let title = cleanTitle((!card.title.trim() || /(?:\.\.\.|…)\s*$/.test(card.title)) && card.alt ? card.alt : card.title);
    const brand=cleanTitle(card.brand);
    if (brand && !title.toLowerCase().startsWith(brand.toLowerCase()+' ') && title.toLowerCase()!==brand.toLowerCase()) title=brand+' '+title;
    let rawPrice = card.prices.find(value => value?.trim()) || '';
    if (config.eapotekaDecimals) {
      rawPrice = `${rawPrice.replace(/\D/g, '')},${card.decimals.replace(/\D/g, '').slice(0, 2).padEnd(2, '0')}`;
    }
    const price = parsePrice(rawPrice);
    if (!title || !card.link || price <= 0 || !Number.isFinite(price)) {
      throw new ScraperFailure(`${url}: incomplete product (title=${JSON.stringify(title)}, link=${JSON.stringify(card.link)}, price=${JSON.stringify(rawPrice)})`, 'incomplete');
    }
    products.push({ title, price: String(price), link: card.link, category: config.category || new URL(url).pathname.split('/').filter(Boolean)[0] || '', thumbnail: card.image, photos: card.image });
  }
  if (!cards.length && !explicitlyEmpty && !categories.size) throw new ScraperFailure(`${url}: neither products nor an explicit empty catalog`, 'incomplete');
  const currentPage = config.pageNumber(url);
  const candidates = [...links].filter(link => new URL(link).origin === new URL(url).origin)
    .map(link => ({ link, page: config.pageNumber(link) }))
    .filter(item => item.page > currentPage).sort((a, b) => a.page - b.page);
  const next = candidates[0];
  if (next && next.page !== currentPage + 1) throw new ScraperFailure(`${url}: pagination skips catalog pages`, 'incomplete');
  return { products, cardCount: cards.length, next: next?.link, categories: [...categories] };
}

export async function scrapeListing(config: ListingConfig): Promise<Product[]> {
  const products = new Map<string, Product>();
  const categoryQueue=[...config.urls];
  const visitedCategories=new Set<string>();
  for (let index=0; index<categoryQueue.length; index++) {
    const category=config.prepareCategory?.(categoryQueue[index]) || categoryQueue[index];
    const categoryKey=new URL(category).pathname.replace(/\/$/,'');
    if (visitedCategories.has(categoryKey)) continue;
    visitedCategories.add(categoryKey);
    let url: string | undefined = category;
    const seen = new Set<string>();
    const signatures = new Set<string>();
    while (url) {
      if (seen.has(url) || seen.size >= 2000) throw new ScraperFailure(`${url}: repeated or excessive pagination`, 'incomplete');
      seen.add(url);
      const response = await requestText(url);
      const data = await parseListingPage(response.body, response.url, config);
      if (seen.size===1) categoryQueue.push(...data.categories);
      const signature = data.products.map(product => product.link).sort().join('\n');
      if (signature && signatures.has(signature)) throw new ScraperFailure(`${url}: repeated product page`, 'incomplete');
      signatures.add(signature);
      for (const product of data.products) products.set(product.link, product);
      console.log(`Catalog ${url}: ${data.products.length} priced products`);
      url = data.next;
    }
  }
  if (!products.size) throw new ScraperFailure('Catalog returned no available priced products', 'incomplete');
  return [...products.values()];
}
