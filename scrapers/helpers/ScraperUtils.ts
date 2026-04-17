import { HTTPRequest, Page } from 'puppeteer';
import { createWorker } from 'tesseract.js';
import puppeteer from 'puppeteer-extra';

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

  static readonly USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)',
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
}
