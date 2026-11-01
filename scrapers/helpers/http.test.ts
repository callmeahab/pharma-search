import { expect, spyOn, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { assertUsableHtml, requestText } from './http';

test('source maintenance and bot pages are explicit failures', () => {
  expect(()=>assertUsableHtml('<title>Sajt je u toku održavanja</title>','https://shop.example')).toThrow('unavailable');
  expect(()=>assertUsableHtml('<title>ERROR: The request could not be satisfied</title>','https://shop.example')).toThrow('blocked');
});
test('paused deployments fail without pointless retries', async () => {
  const fetch=spyOn(globalThis,'fetch').mockResolvedValue(new Response('paused',{status:503,headers:{'x-vercel-error':'DEPLOYMENT_PAUSED'}}));
  try { await expect(requestText('https://shop.example')).rejects.toMatchObject({status:'unavailable',httpStatus:503}); expect(fetch).toHaveBeenCalledTimes(1); }
  finally { fetch.mockRestore(); }
});
test('transient rate limiting is retried before a catalog is accepted', async () => {
  const fetch=spyOn(globalThis,'fetch')
    .mockResolvedValueOnce(new Response('wait',{status:429,headers:{'retry-after':'0'}}))
    .mockResolvedValueOnce(new Response('<catalog>ok</catalog>'));
  try { expect((await requestText('https://shop.example')).body).toContain('ok'); expect(fetch).toHaveBeenCalledTimes(2); }
  finally { fetch.mockRestore(); }
});
test('gzip sitemaps and already decoded gzip responses both work', async () => {
  const fetch=spyOn(globalThis,'fetch')
    .mockResolvedValueOnce(new Response(gzipSync('<urlset/>')))
    .mockResolvedValueOnce(new Response('<urlset/>'));
  try {
    expect((await requestText('https://shop.example/sitemap.gz',{gzip:true})).body).toBe('<urlset/>');
    expect((await requestText('https://shop.example/sitemap.gz',{gzip:true})).body).toBe('<urlset/>');
  } finally { fetch.mockRestore(); }
});
test('long Retry-After delays stop the run rather than retrying too early', async () => {
  const fetch=spyOn(globalThis,'fetch').mockResolvedValue(new Response('wait',{status:429,headers:{'retry-after':'3600'}}));
  try { await expect(requestText('https://shop.example')).rejects.toThrow('longer retry delay'); expect(fetch).toHaveBeenCalledTimes(1); }
  finally { fetch.mockRestore(); }
});
