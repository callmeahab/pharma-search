import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = ['https://jugofarm.com/apoteka/'];

// Function to scrape a single page for products
async function scrapePage(
  page: Page,
  url: string,
  category: string,
): Promise<Product[]> {
  try {
    // Use a more lenient loading strategy
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for a short time to allow dynamic content to load
    await new Promise((resolve) => setTimeout(resolve, 3000));

    if (await page.$('.captcha-container')) {
      console.log('CAPTCHA detected, attempting solve...');
      const solved = await ScraperUtils.solveImageCaptcha(page);
      if (!solved) throw new Error('CAPTCHA solve failed');
    }

    // Try to find products directly without waiting for specific container
    const products = await page.$$eval(
      '.product-wrapper',
      (elements, categoryArg) => {
        return elements.map((element) => {
          const titleElement = element.querySelector('h3');
          const title = titleElement?.textContent?.trim() || '';

          const priceElement = element.querySelector('.price');
          const price = priceElement?.textContent?.trim() || '';

          const linkElement = element.querySelector(
            '.product-content > a',
          ) as HTMLAnchorElement;
          const link = linkElement?.href || '';

          const imgElement = element.querySelector('img') as HTMLImageElement;
          const img = imgElement?.src || '';

          return {
            title,
            price,
            link,
            thumbnail: img,
            photos: img,
            category: categoryArg,
          };
        });
      },
      category,
    );

    // If no products found, check if page is empty
    if (products.length === 0) {
      // Try to scroll and wait for content
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Try to find products again after scroll
      const productsAfterScroll = await page.$$eval(
        '.product-wrapper',
        (elements, categoryArg) => {
          return elements.map((element) => {
            const titleElement = element.querySelector('h3');
            const title = titleElement?.textContent?.trim() || '';

            const priceElement = element.querySelector('.price');
            const price = priceElement?.textContent?.trim() || '';

            const linkElement = element.querySelector(
              '.product-content > a',
            ) as HTMLAnchorElement;
            const link = linkElement?.href || '';

            const imgElement = element.querySelector('img') as HTMLImageElement;
            const img = imgElement?.src || '';

            return {
              title,
              price,
              link,
              thumbnail: img,
              photos: img,
              category: categoryArg,
            };
          });
        },
        category,
      );

      if (productsAfterScroll.length > 0) {
        return productsAfterScroll;
      }
    }

    return products.filter((product) => product.title);
  } catch (error) {
    console.error(
      `Error scraping ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    return [];
  }
}

// Main scraping function with pagination
async function scrapeMultipleBaseUrls(): Promise<Product[]> {
  const tempBrowser = await puppeteer.launch();
  const tempPage = await tempBrowser.newPage();
  const args = await ScraperUtils.configurePage(tempPage);
  await tempBrowser.close();

  const browser = await puppeteer.launch({
    headless: ScraperUtils.IS_HEADLESS,
    defaultViewport: null,
    args,
  });

  try {
    const page = await browser.newPage();
    let allScrapedProducts: Product[] = [];

    for (const baseUrl of baseUrls) {
      let pageNumber = 1;
      while (true) {
        const pageUrl = `${baseUrl}page/${pageNumber}/`;
        console.log(`Scraping page: ${pageUrl}`);

        const products = await scrapePage(page, pageUrl, 'pharmacy');
        if (products.length === 0) {
          console.log(`No products found on page ${pageNumber}, stopping...`);
          break;
        }

        allScrapedProducts = [...allScrapedProducts, ...products];
        pageNumber++;
      }
    }

    return allScrapedProducts;
  } finally {
    await ScraperUtils.cleanup();
    await browser.close();
  }
}

// Execute the scraper
scrapeMultipleBaseUrls().then(async (allProducts) => {
  if (allProducts.length > 0) {
    await insertData(allProducts, 'Jugofarm');
  } else {
    console.log('No products found.');
  }
});
