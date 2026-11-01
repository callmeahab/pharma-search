import { expect, spyOn, test } from 'bun:test';
import { parseListingPage, scrapeListing } from './listingScraper';
import { eApotekaListing, hiperListing, exYuListing } from './listingConfigs';

const card = `<div class="product-preview-item"><a class="link-name" href="/sr/proizvod/c"><h3>Vitamin C…</h3></a>
<div class="image-wrapper"><img alt="Vitamin C 1000mg 20 tableta" data-src="/c.jpg"></div>
<span class="price">2.399<span class="price_decimal">50</span><span class="price_currency">RSD</span></span></div>`;

test('listing reader preserves full titles, localized decimals and absolute URLs', async () => {
  const result=await parseListingPage(card+'<div class="pagination"><a href="/sr/svi-proizvodi/2?limit=48">2</a></div>',eApotekaListing.urls[0],eApotekaListing);
  expect(result.products[0].title).toBe('Vitamin C 1000mg 20 tableta');
  expect(result.products[0].price).toBe('2400');
  expect(result.products[0].link).toBe('https://www.eapoteka.rs/sr/proizvod/c');
  expect(result.products[0].category).toBe('svi-proizvodi');
  expect(result.next).toContain('/2?');
});

test('listing reader selects the current sale amount instead of the crossed-out price', async () => {
  const html=`<div class="product-item-info"><a class="product-item-link" href="/biotin"><span class="product-name-brand-name">Solgar</span><h2 class="product-name-full-name">Biotin</h2></a>
<span class="special-price"><span data-price-amount="1472">1.472 RSD</span></span>
<span class="price-final_price"><span data-price-type="" data-price-amount="1900">1.900 RSD</span></span></div>`;
  expect((await parseListingPage(html,hiperListing.urls[0],hiperListing)).products[0].price).toBe('1472');
});
test('Hiper bundle prices without Magento amount attributes still work without duplicating the brand',async()=>{
  const html='<div class="product-item-info"><a class="product-item-link" href="/bundle"><span class="product-name-brand-name">Aleksandar MN</span><h2 class="product-name-full-name">Aleksandar MN Collagen 12x80ml</h2></a><div class="price-box"><span class="price">2.748,00 RSD</span></div></div>';
  const result=await parseListingPage(html,hiperListing.urls[0],hiperListing);
  expect(result.products[0].price).toBe('2748');
  expect(result.products[0].title).toBe('Aleksandar MN Collagen 12x80ml');
});
test('Hiper discounted bundles use the rendered current price when numeric attributes are missing',async()=>{
  const html='<div class="product-item-info"><a class="product-item-link" href="/bundle"><h2 class="product-name-full-name">Floriotic 5x10</h2></a><div class="price-box"><span class="special-price"><span class="price-wrapper"><span class="price">1.095,00 RSD</span></span></span><span class="old-price"><span class="price">2.745,00 RSD</span></span></div></div>';
  expect((await parseListingPage(html,hiperListing.urls[0],hiperListing)).products[0].price).toBe('1095');
});

test('listing reader rejects changed markup and skipped pages', async () => {
  await expect(parseListingPage('<html>changed</html>',eApotekaListing.urls[0],eApotekaListing)).rejects.toThrow('neither products');
  await expect(parseListingPage(card+'<div class="pagination"><a href="/sr/svi-proizvodi/4">4</a></div>',eApotekaListing.urls[0],eApotekaListing)).rejects.toThrow('skips');
});

test('listing crawler rejects a blocked later page instead of returning its first page', async () => {
  const fetch=spyOn(globalThis,'fetch')
    .mockResolvedValueOnce(new Response(card+'<div class="pagination"><a href="/sr/svi-proizvodi/2">2</a></div>'))
    .mockResolvedValueOnce(new Response('denied',{status:403}));
  try { await expect(scrapeListing(eApotekaListing)).rejects.toThrow('HTTP 403'); }
  finally { fetch.mockRestore(); }
});
test('listing crawler discovers child catalogs when the parent has no direct products', async () => {
  const fetch=spyOn(globalThis,'fetch')
    .mockResolvedValueOnce(new Response('<div class="ty-no-items"></div><div class="ut2-subcategories"><a href="/proteini/whey/">Whey</a></div>'))
    .mockResolvedValueOnce(new Response('<div class="ut2-gl__body"><div class="ut2-gl__name">Whey protein</div><a class="product_icon_lnk" href="/whey-product"><img src="/w.jpg"></a><span class="ty-price">1.200,00 RSD</span></div>'));
  try {
    const products=await scrapeListing({...exYuListing,urls:['https://www.exyu-fitness.rs/suplementi/']});
    expect(products).toHaveLength(1);
    expect(products[0].price).toBe('1200');
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally { fetch.mockRestore(); }
});
