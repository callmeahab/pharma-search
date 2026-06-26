import { HTTPRequest, Page } from 'puppeteer';
import { createWorker } from 'tesseract.js';
import puppeteer from 'puppeteer-extra';
import { resolveChromeExecutable } from './chrome';

export class ScraperUtils {
  private static worker: Awaited<ReturnType<typeof createWorker>>;
  private static readonly configuredPages = new WeakSet<Page>();

  static readonly IS_HEADLESS = true; // Change this from false to true
  static readonly NAVIGATION_TIMEOUT_MS = Number.parseInt(
    process.env.SCRAPER_NAVIGATION_TIMEOUT_MS || '45000',
    10,
  );
  static readonly DEFAULT_TIMEOUT_MS = Number.parseInt(
    process.env.SCRAPER_DEFAULT_TIMEOUT_MS || '15000',
    10,
  );
  static readonly DEFAULT_SETTLE_MS = Number.parseInt(
    process.env.SCRAPER_AFTER_GOTO_SETTLE_MS || '250',
    10,
  );

  // Add default viewport dimensions
  static readonly VIEWPORT = {
    width: 1920,
    height: 1080,
  };

  // Full, current Chrome UAs (the old truncated strings were an obvious bot tell
  // and weren't paired with client hints — see configurePage).
  static readonly USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ];
  private static readonly BLOCKED_RESOURCE_TYPES = new Set([
    'eventsource',
    'font',
    'manifest',
    'media',
    'ping',
    'preflight',
    'websocket',
  ]);
  private static readonly BLOCKED_URL_PATTERNS = [
    'analytics',
    'clarity.ms',
    'doubleclick.net',
    'facebook.com/tr',
    'googletagmanager.com',
    'google-analytics.com',
    'hotjar.',
    'intercom.',
    'newrelic.',
    'segment.',
  ];

  private static async initializeWorker() {
    if (!this.worker) {
      this.worker = await createWorker();
    }
    return this.worker;
  }

  static getBrowserArgs(): string[] {
    const commonArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-plugins',
      '--disable-images',
      '--ignore-certificate-errors',
      '--ignore-ssl-errors',
      '--ignore-certificate-errors-spki-list',
      '--ignore-certificate-errors-spki-list-log',
      '--ignore-ssl-errors-ignore-ssl-errors',
      '--disable-features=VizDisplayCompositor',
      `--window-size=${this.VIEWPORT.width},${this.VIEWPORT.height}`,
    ];

    return this.IS_HEADLESS ? commonArgs : [...commonArgs, '--start-maximized'];
  }

  static async configurePage(page: Page): Promise<string[]> {
    const userAgent =
      this.USER_AGENTS[Math.floor(Math.random() * this.USER_AGENTS.length)];
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'sr-RS,sr;q=0.9,en-US;q=0.8,en;q=0.7',
      DNT: '1',
      'Upgrade-Insecure-Requests': '1',
      'User-Agent': userAgent,
      // Client hints matching the Chrome 120 UA above (their absence is a bot tell).
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    });
    await page.setUserAgent(userAgent);
    await page.setDefaultNavigationTimeout(this.NAVIGATION_TIMEOUT_MS);
    await page.setDefaultTimeout(this.DEFAULT_TIMEOUT_MS);
    await page.setBypassServiceWorker(true);

    // Set viewport size
    await page.setViewport(this.VIEWPORT);

    if (!this.configuredPages.has(page)) {
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        this.handleRequest(request);
      });
      this.configuredPages.add(page);
    }

    return this.getBrowserArgs();
  }

  private static shouldAbortRequest(request: HTTPRequest): boolean {
    const resourceType = request.resourceType();
    if (this.BLOCKED_RESOURCE_TYPES.has(resourceType)) {
      return true;
    }

    const url = request.url().toLowerCase();
    return this.BLOCKED_URL_PATTERNS.some((pattern) => url.includes(pattern));
  }

  private static handleRequest(request: HTTPRequest) {
    if (request.isInterceptResolutionHandled()) {
      return;
    }

    try {
      if (this.shouldAbortRequest(request)) {
        void request.abort();
        return;
      }

      void request.continue();
    } catch {
      // Ignore interception races when Chromium tears down a page mid-request.
    }
  }

  static async goto(
    page: Page,
    url: string,
    options: {
      settleMs?: number;
      timeout?: number;
      waitUntil?: 'domcontentloaded' | 'load' | 'networkidle0' | 'networkidle2';
    } = {},
  ) {
    await page.goto(url, {
      waitUntil: options.waitUntil || 'domcontentloaded',
      timeout: options.timeout || this.NAVIGATION_TIMEOUT_MS,
    });

    const settleMs = options.settleMs ?? this.DEFAULT_SETTLE_MS;
    if (settleMs > 0) {
      await this.delay(settleMs);
    }
  }

  static async gotoAndWaitForSelector(
    page: Page,
    url: string,
    selector: string,
    options: {
      navigationTimeout?: number;
      noResultsMessage?: string;
      selectorTimeout?: number;
      settleMs?: number;
      visible?: boolean;
    } = {},
  ) {
    await this.goto(page, url, {
      settleMs: options.settleMs,
      timeout: options.navigationTimeout,
    });

    await page
      .waitForSelector(selector, {
        timeout: options.selectorTimeout || this.DEFAULT_TIMEOUT_MS,
        visible: options.visible,
      })
      .catch(() => {
        if (options.noResultsMessage) {
          console.log(options.noResultsMessage);
        }
      });
  }

  static async solveImageCaptcha(page: Page): Promise<boolean> {
    await this.initializeWorker();

    try {
      const captchaElement = await page.$('.captcha img');
      if (!captchaElement) return false;

      await captchaElement.screenshot({ path: 'captcha.png' });
      const {
        data: { text },
      } = await this.worker.recognize('captcha.png');
      const solution = text.replace(/[^a-zA-Z0-9]/g, '').trim();

      await page.type('#captcha-input', solution);
      await page.click('#captcha-submit');
      await page.evaluate(() => new Promise((r) => setTimeout(r, 2000)));
      return true;
    } catch (error) {
      console.log('CAPTCHA solve failed:', error);
      return false;
    }
  }

  static async cleanup() {
    await this.worker?.terminate();
  }

  static async launchBrowser() {
    return await puppeteer.launch({
      headless: this.IS_HEADLESS,
      defaultViewport: null,
      args: this.getBrowserArgs(),
      // Prefer a system Chrome (env override or auto-detected) over puppeteer's bundled
      // "Chrome for Testing", which fails to launch on some hosts. undefined = bundled.
      executablePath: resolveChromeExecutable(),
    });
  }

  static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  static async autoScroll(page: Page): Promise<void> {
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let totalHeight = 0;
        const distance = 1000;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight + 100) {
            clearInterval(timer);
            window.scrollTo(0, scrollHeight);
            resolve();
          }
        }, 200);
      });
    });
  }

  // Throws if the page is an anti-bot wall (Cloudflare managed challenge, "Just a
  // moment", "you have been blocked"). Call right after navigation so a blocked
  // scrape FAILS LOUD (recorded as an error + alerted) instead of silently
  // "succeeding" with zero products. NOTE: a managed challenge usually cannot be
  // cleared by stealth alone — it needs a real-browser solve or a scraping proxy.
  static async assertNotBlocked(page: Page, label = 'page'): Promise<void> {
    const info = await page.evaluate(() => ({
      title: document.title || '',
      body: (document.body?.innerText || '').slice(0, 800),
      challenge: !!document.querySelector(
        '#challenge-form, #cf-challenge-running, #challenge-running, [data-translate="checking_browser"]',
      ),
    }));
    const blob = `${info.title}\n${info.body}`.toLowerCase();
    const markers = [
      'just a moment',
      'checking your browser',
      'attention required',
      'sorry, you have been blocked',
      'enable javascript and cookies to continue',
      'verify you are human',
      'cf-mitigated',
    ];
    if (info.challenge || markers.some((m) => blob.includes(m))) {
      throw new Error(
        `${label} blocked by an anti-bot challenge (Cloudflare?) — title="${info.title.slice(0, 80)}". Needs a scraping proxy / CF solver.`,
      );
    }
  }
}
