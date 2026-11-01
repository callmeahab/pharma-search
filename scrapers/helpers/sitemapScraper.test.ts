import { expect, spyOn, test } from 'bun:test';
import { scrapeSitemapVendor } from './sitemapScraper';

test('a blocked product page invalidates the whole sitemap snapshot',async()=>{
  const fetch=spyOn(globalThis,'fetch').mockImplementation(async input=>{
    const url=String(input);
    if(url.endsWith('/sitemap.xml'))return new Response('<urlset><url><loc>https://shop.example/a</loc></url><url><loc>https://shop.example/b</loc></url></urlset>');
    if(url.endsWith('/a'))return new Response('<script type="application/ld+json">{"@type":"Product","name":"Vitamin C","offers":{"price":100}}</script>');
    return new Response('blocked',{status:403});
  });
  try{await expect(scrapeSitemapVendor('https://shop.example','Test',{productSitemaps:['https://shop.example/sitemap.xml']})).rejects.toThrow('HTTP 403');}
  finally{fetch.mockRestore();}
});

test('a missing child sitemap cannot produce a partial catalog',async()=>{
  const fetch=spyOn(globalThis,'fetch')
    .mockResolvedValueOnce(new Response('<sitemapindex><sitemap><loc>https://shop.example/products.xml</loc></sitemap></sitemapindex>'))
    .mockResolvedValueOnce(new Response('missing',{status:404}));
  try{await expect(scrapeSitemapVendor('https://shop.example','Test',{productSitemaps:['https://shop.example/sitemap.xml']})).rejects.toThrow('referenced sitemap is missing');}
  finally{fetch.mockRestore();}
});
