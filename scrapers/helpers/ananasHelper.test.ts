import { expect, spyOn, test } from 'bun:test';
import { parseAnanasPage, scrapeAnanasCategoryUrls } from './ananasHelper';

function page(hits: unknown[], current = 0, pages = 1) {
  return `<script>window[Symbol.for("InstantSearchInitialResults")] = ${JSON.stringify({
    catalog: { results: [{ hits, page: current, nbPages: pages, nbHits: pages * 48 }] },
  })};</script>`;
}
const hit = { objectID: '123', price: 297, basePrice: 490, onStock: true, available: 3,
  product: { name: 'Vitamin C 1000 mg', slug: 'vitamin-c', coverImageUrl: '/assets/vitamin.jpg', categoryNames: ['Vitamini'] } };

test('Ananas reads the current price and canonical links from server data', () => {
  const result = parseAnanasPage(page([hit, { ...hit, objectID: '124', onStock: false }]), 'https://ananas.rs/kategorije/vitamini', 1);
  expect(result.products).toHaveLength(1);
  expect(result.products[0].price).toBe('297');
  expect(result.products[0].link).toBe('https://ananas.rs/proizvod/vitamin-c/123');
  expect(result.products[0].thumbnail).toBe('https://static.ananas.rs/assets/vitamin.jpg');
  expect(result.skipped).toBe(1);
});

test('Ananas rejects a repeated page and missing catalog markup', () => {
  expect(() => parseAnanasPage(page([hit]), 'https://ananas.rs/category?page=2', 2)).toThrow('pagination');
  expect(() => parseAnanasPage('<html>changed</html>', 'https://ananas.rs/category', 1)).toThrow('missing Ananas');
});

test('Ananas accepts an explicitly sold-out category only on its first page', () => {
  const html='<h6 data-testid="empty-state-title">Rasprodati</h6><div id="category-page-empty-state-identifier"></div>';
  expect(parseAnanasPage(html,'https://ananas.rs/category',1).total).toBe(0);
  expect(()=>parseAnanasPage(html,'https://ananas.rs/category?page=2',2)).toThrow('missing');
});

test('Ananas does not return a partial catalog when a later page is blocked', async () => {
  const fetch = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(page([hit], 0, 2)))
    .mockResolvedValueOnce(new Response('blocked', { status: 403 }));
  try {
    await expect(scrapeAnanasCategoryUrls(['https://ananas.rs/category'])).rejects.toThrow('HTTP 403');
  } finally { fetch.mockRestore(); }
});
