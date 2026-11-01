import { gunzipSync } from 'node:zlib';

export type FailureStatus = 'blocked' | 'unavailable' | 'incomplete' | 'error';

export class ScraperFailure extends Error {
  constructor(
    message: string,
    readonly status: FailureStatus,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'ScraperFailure';
  }
}

export function reportScraperFailure(error: unknown) {
  const failure = error instanceof ScraperFailure ? error : undefined;
  console.error('SCRAPER_FAILURE ' + JSON.stringify({
    status: failure?.status || 'error',
    httpStatus: failure?.httpStatus,
    message: error instanceof Error ? error.message : String(error),
  }));
}

export function assertUsableHtml(html: string, url: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  if (/just a moment|attention required|request could not be satisfied/i.test(title)
    || /cf-mitigated|verify you are human|<h\d[^>]*>\s*403 ERROR/i.test(html)) {
    throw new ScraperFailure(`${url}: access blocked by the source`, 'blocked');
  }
  if (/store unavailable|sajt je u toku odr[zž]avanja/i.test(title)
    || /re[zž]im odr[zž]avanja je uklju[cč]en|DEPLOYMENT_PAUSED/i.test(html)) {
    throw new ScraperFailure(`${url}: source is currently unavailable or under maintenance`, 'unavailable');
  }
}

export async function requestText(
  url: string,
  opts: { retries?: number; timeoutMs?: number; allow404?: boolean; allowedStatuses?: number[]; accept?: string; gzip?: boolean } = {},
): Promise<{ body: string; status: number; url: string }> {
  const retries = opts.retries ?? 2;
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    let body: string;
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
          Accept: opts.accept || 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'Accept-Language': 'sr-RS,sr;q=0.9,en;q=0.8',
        },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 25000),
      });
      if (opts.gzip && response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        body = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
      } else {
        body = await response.text();
      }
    } catch (error) {
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
        continue;
      }
      throw new ScraperFailure(`${url}: request failed (${String(error)})`, 'unavailable');
    }
    const paused = response.headers.get('x-vercel-error') === 'DEPLOYMENT_PAUSED';
    const transient = [429, 500, 502, 503, 504, 522, 524].includes(response.status);
    if (!paused && transient && attempt < retries) {
      const retryAfter = response.headers.get('retry-after');
      const seconds = retryAfter ? Number(retryAfter) : NaN;
      const dateDelay = retryAfter ? Date.parse(retryAfter) - Date.now() : NaN;
      const delay = Number.isFinite(seconds) ? seconds * 1000 : dateDelay;
      if (Number.isFinite(delay) && delay > 30000) {
        throw new ScraperFailure(`${url}: source requested a longer retry delay`, 'unavailable', response.status);
      }
      await new Promise(resolve => setTimeout(resolve,
        Number.isFinite(delay) ? Math.max(0, delay) : 500 * 2 ** attempt));
      continue;
    }
    if ((opts.allow404 && response.status === 404) || opts.allowedStatuses?.includes(response.status)) {
      return { body, status: response.status, url: response.url || url };
    }
    if (!response.ok) {
      const status = [401, 403].includes(response.status) ? 'blocked' : 'unavailable';
      throw new ScraperFailure(`${url}: HTTP ${response.status}${paused ? ' (deployment paused)' : ''}`, status, response.status);
    }
    assertUsableHtml(body, url);
    return { body, status: response.status, url: response.url || url };
  }
}
