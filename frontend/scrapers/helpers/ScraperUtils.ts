import { Page } from 'puppeteer';
import { createWorker } from 'tesseract.js';

export class ScraperUtils {
  private static worker: Awaited<ReturnType<typeof createWorker>>;

  static readonly IS_HEADLESS = true; // Change this from false to true

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

  private static async initializeWorker() {
    if (!this.worker) {
      this.worker = await createWorker();
    }
    return this.worker;
  }

  static async configurePage(page: Page): Promise<string[]> {
    const userAgent =
      this.USER_AGENTS[Math.floor(Math.random() * this.USER_AGENTS.length)];
    await page.setExtraHTTPHeaders({ 'User-Agent': userAgent });
    await page.setUserAgent(userAgent);
    await page.setDefaultNavigationTimeout(60000);

    // Set viewport size
    await page.setViewport(this.VIEWPORT);

    const commonArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      `--window-size=${this.VIEWPORT.width},${this.VIEWPORT.height}`,
    ];

    return this.IS_HEADLESS ? commonArgs : [...commonArgs, '--start-maximized'];
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
