import { expect, spyOn, test } from 'bun:test';
import { scrapeShopify, scrapeWooStore } from './apiScrapers';

const batch = Array.from({ length: 250 }, (_, i) => ({
  title: `Product ${i}`,
  handle: `product-${i}`,
  variants: [{ price: '100.00' }],
}));

test('Shopify rejects a partial catalog when a later page is rate limited', async () => {
  const fetch = spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response('Too many requests', { status: 429, headers: { 'retry-after': '0' } }))
    .mockResolvedValueOnce(Response.json({ products: batch }));
  try {
    await expect(scrapeShopify('https://shop.example', 'Test shop'))
      .rejects.toThrow('HTTP 429');
    expect(fetch).toHaveBeenCalledTimes(4);
  } finally {
    fetch.mockRestore();
  }
});

test('WooCommerce rejects server failures on later pages instead of returning partial data', async () => {
  const fetch=spyOn(globalThis,'fetch')
    .mockResolvedValueOnce(Response.json([{name:'Vitamin C',permalink:'https://shop.example/c',prices:{price:'10000'}}]))
    .mockResolvedValueOnce(new Response('denied',{status:403}));
  try { await expect(scrapeWooStore('https://shop.example','Test',{perPage:1})).rejects.toThrow('HTTP 403'); }
  finally { fetch.mockRestore(); }
});

test('WooCommerce recognizes only an explicit invalid-page response as the end', async () => {
  const fetch=spyOn(globalThis,'fetch')
    .mockResolvedValueOnce(Response.json([{name:'Vitamin C',permalink:'https://shop.example/c',prices:{price:'10000'}}]))
    .mockResolvedValueOnce(Response.json({code:'rest_post_invalid_page_number'},{status:400}));
  try { expect(await scrapeWooStore('https://shop.example','Test',{perPage:1})).toHaveLength(1); }
  finally { fetch.mockRestore(); }
});

test('Shopify rejects a malformed successful response instead of ending pagination', async () => {
  const fetch=spyOn(globalThis,'fetch').mockResolvedValueOnce(Response.json({unrelated:[]}));
  try { await expect(scrapeShopify('https://shop.example','Test')).rejects.toThrow('invalid Shopify'); }
  finally { fetch.mockRestore(); }
});

test('Shopify returns every page of a complete catalog', async () => {
  const fetch = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ products: batch }))
    .mockResolvedValueOnce(Response.json({ products: [{
      title: 'Last product', handle: 'last-product', variants: [{ price: '250.00' }],
    }] }));
  try {
    const products = await scrapeShopify('https://shop.example', 'Test shop');
    expect(products).toHaveLength(251);
    expect(products.at(-1)?.link).toBe('https://shop.example/products/last-product');
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    fetch.mockRestore();
  }
});
