import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = ['https://klub.farmasi.rs/shop/products/all?p='];
const USERNAME = 'bijasac731@downlor.com';
const PASSWORD = 'PetarNobilo1990';

async function login(page: Page): Promise<boolean> {
  try {
    await Promise.all([
      page.goto('https://klub.farmasi.rs/login', {
        waitUntil: 'domcontentloaded',
      }),
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    ]);

    await page.waitForSelector('#username', { timeout: 5000 });
    await page.type('#username', USERNAME);
    await page.type('[name="password"]', PASSWORD);

    await Promise.all([
      page.click('.pt-login-prijavise'),
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 2000));

    await Promise.all([
      page.goto('https://klub.farmasi.rs/shop/products/all', {
        waitUntil: 'domcontentloaded',
      }),
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const currentUrl = await page.url();
    const isLoggedIn = currentUrl.includes('/shop/products/all');

    if (isLoggedIn) {
      console.log('Login successful and navigated to products page!');
      return true;
    } else {
      console.log(
        'Login failed or navigation failed. Current URL:',
        currentUrl,
      );
      return false;
    }
  } catch (error) {
    console.error(`Login error: ${(error as Error).message}`);
    return false;
  }
}

async function scrapePage(
  page: Page,
  url: string,
  category: string,
): Promise<Product[]> {
  const allProducts: Product[] = [];

  try {
    await Promise.all([
      page.goto(url, { waitUntil: 'domcontentloaded' }),
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    ]);

    await page
      .waitForSelector('.product-wrapper', {
        timeout: 10000,
      })
      .catch(() => console.log('No products found on page'));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const products = await page.$$eval('.product-wrapper', (elements) => {
      return elements.map((element) => {
        const title =
          element.querySelector('.product-card-name')?.textContent?.trim() ||
          '';
        const price =
          element.querySelector('.price.shortAnim')?.textContent?.trim() || '';
        const link = element.querySelector('a')?.getAttribute('href') || '';
        const img = element.querySelector('img')?.getAttribute('src') || '';

        return { title, price, link, img };
      });
    });

    for (const product of products) {
      if (!scrapedTitles.has(product.title)) {
        allProducts.push({
          title: product.title,
          price: product.price,
          category,
          link: `https://klub.farmasi.rs${product.link}`,
          thumbnail: product.img,
          photos: product.img,
        });
        scrapedTitles.add(product.title);
      }
    }

    return allProducts;
  } catch (error) {
    console.error(`Error scraping ${url}: ${(error as Error).message}`);
    return [];
  }
}

async function scrapeMultipleBaseUrls(): Promise<Product[]> {
const browser = await puppeteer.launch({
    headless: ScraperUtils.IS_HEADLESS,
    defaultViewport: null,
    args: ScraperUtils.getBrowserArgs(),
  });

  try {
    const page = await browser.newPage();
    await ScraperUtils.configurePage(page);
    let allScrapedProducts: Product[] = [];

    const loginSuccess = await login(page);
    if (!loginSuccess) {
      console.error('Failed to log in. Stopping scraper.');
      return [];
    }

    for (const baseUrl of baseUrls) {
      let pageNum = 0;

      while (true) {
        const pageUrl = `${baseUrl}${pageNum}`;
        console.log(`Scraping page: ${pageUrl}`);

        let retryCount = 0;
        const maxRetries = 2;
        let products: Product[] = [];

        while (retryCount < maxRetries) {
          try {
            products = await scrapePage(page, pageUrl, '');
            if (products.length > 0) break;
          } catch (error) {
            console.error(`Error on attempt ${retryCount + 1}:`, error);
          }
          retryCount++;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        if (products.length === 0) {
          console.log(
            `No products found on page ${pageNum} of ${baseUrl}, stopping...`,
          );
          break;
        }

        allScrapedProducts = [...allScrapedProducts, ...products];
        pageNum++;
      }
    }

    console.log(
      `Scraping completed. Total products found: ${allScrapedProducts.length}`,
    );
    return allScrapedProducts;
  } finally {
    await ScraperUtils.cleanup();
    await browser.close();
  }
}

scrapeMultipleBaseUrls().then(async (allProducts) => {
  if (allProducts.length > 0) {
    await insertData(allProducts, 'Farmasi');
    console.log(`Successfully stored ${allProducts.length} products`);
  } else {
    console.log('No products found.');
  }
});
