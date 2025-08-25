import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const baseUrls = ['https://4fitness.rs/proizvodi'];

// Function to scrape a single page for products
async function scrapePage(
  page: Page,
  url: string,
  baseUrl: string,
): Promise<Product[]> {
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Extract category from baseUrl
    const category = 'suplementi';

    // Update selector to match new HTML structure
    await page.waitForSelector('ul.products.columns-3 li.product', {
      visible: true,
      timeout: 20000,
    });

    await ScraperUtils.delay(2000);

    if (await page.$('.captcha-container')) {
      console.log('CAPTCHA detected, attempting solve...');
      const solved = await ScraperUtils.solveImageCaptcha(page);
      if (!solved) throw new Error('CAPTCHA solve failed');
    }

    const products = await page.evaluate((categoryArg) => {
      const productElements = document.querySelectorAll(
        'ul.products.columns-3 li.product',
      );
      return Array.from(productElements)
        .map((element) => {
          // Check if product is out of stock
          const outOfStock = element.classList.contains('outofstock');
          if (outOfStock) {
            return null;
          }

          const name = element
            .querySelector('.woocommerce-loop-product__title')
            ?.textContent?.trim();

          // First try to get discounted price, if not available get regular price
          const priceElement =
            element.querySelector('.price ins .amount')?.textContent?.trim() ||
            element.querySelector('.price > .amount')?.textContent?.trim();

          const price = priceElement || '0';
          const link = element
            .querySelector('.woocommerce-LoopProduct-link')
            ?.getAttribute('href');
          const imageUrl = element
            .querySelector('.attachment-woocommerce_thumbnail')
            ?.getAttribute('src');

          if (!name || !price || !link || !imageUrl) {
            return null;
          }

          return {
            title: name,
            price: price.toString(),
            link,
            thumbnail: imageUrl,
            photos: imageUrl,
            category: categoryArg,
          };
        })
        .filter(
          (product): product is NonNullable<typeof product> => product !== null,
        );
    }, category);

    return products;
  } catch (error) {
    console.error(`Error scraping page ${url}:`, error);
    return [];
  }
}

// Main scraping function with pagination
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

    for (const baseUrl of baseUrls) {
      let pageNumber = 1;
      while (true) {
        const pageUrl =
          pageNumber === 1 ? `${baseUrl}` : `${baseUrl}/page/${pageNumber}`;

        console.log(`Scraping page: ${pageUrl}`);

        const products = await scrapePage(page, pageUrl, baseUrl);

        if (products.length === 0) {
          console.log(
            `Reached last page (${pageNumber}) for category ${baseUrl.split('/').pop()?.split('?')[0] || ''}`,
          );
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
    await insertData(allProducts, '4 Fitness');
  } else {
    console.log('No products found.');
  }
});
