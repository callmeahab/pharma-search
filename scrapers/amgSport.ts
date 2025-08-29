import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product , initializeDatabase, closeDatabase } from './helpers/database';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = ['https://amgsport.net/shop/?per_page=-1'];

// Function to scrape a single page for products
async function scrapePage(
  page: Page,
  url: string,
  category: string,
): Promise<Product[]> {
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for initial products to be visible
    await page.waitForSelector('.product-wrapper', {
      visible: true,
      timeout: 20000,
    });

    // Scroll to the bottom of the page in increments to load all images
    let previousHeight = 0;
    while (true) {
      const currentHeight = await page.evaluate(
        () => document.body.scrollHeight,
      );
      if (currentHeight === previousHeight) {
        break;
      }
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      await ScraperUtils.delay(500);
      previousHeight = currentHeight;
    }

    // Scroll back to top
    await page.evaluate('window.scrollTo(0, 0)');
    await ScraperUtils.delay(1000);

    // Check for CAPTCHA
    if (await page.$('.captcha-container')) {
      console.log('CAPTCHA detected, attempting solve...');
      const solved = await ScraperUtils.solveImageCaptcha(page);
      if (!solved) throw new Error('CAPTCHA solve failed');
    }

    // Check if product wrappers exist
    try {
      await page.waitForSelector('.product-wrapper', { timeout: 10000 });
    } catch (error) {
      console.log('No products found on page');
      return [];
    }

    const products = await page.$$eval(
      '.product-wrapper',
      (elements, categoryArg) => {
        return elements.map((element) => {
          const titleElement = element.querySelector('h3');
          const title = titleElement?.textContent?.trim() || '';

          let price = '';
          const priceElement = element.querySelector('.price');
          const newPriceElement = priceElement?.querySelector(
            'ins .woocommerce-Price-amount',
          );

          if (newPriceElement) {
            price = newPriceElement.textContent?.trim() || '';
          } else {
            price =
              priceElement
                ?.querySelector('.woocommerce-Price-amount')
                ?.textContent?.trim() || '';
          }

          const linkElement = element.querySelector(
            '.product-image-link',
          ) as HTMLAnchorElement;
          const link = linkElement?.href || '';

          const imgElement = element.querySelector(
            '.product-image-link > img',
          ) as HTMLImageElement;
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

    return products.filter((product) => product.title);
  } catch (error) {
    console.error(
      `Error scraping ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    return [];
  }
}

// Main scraping function without pagination
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
      const category = 'suplementi';
      console.log(`Scraping: ${baseUrl}`);

      const products = await scrapePage(page, baseUrl, category);
      allScrapedProducts = [...allScrapedProducts, ...products];
    }

    return allScrapedProducts;
  } finally {
    await ScraperUtils.cleanup();
    await browser.close();
  }
}

// Execute the scraper
async function main() {
  try {
    // Initialize database connection
    await initializeDatabase();
    
    const allProducts = await scrapeMultipleBaseUrls();
    

  if (allProducts.length > 0) {
    await insertData(allProducts, 'AMG Sport');
  } else {
    console.log('No products found.');
  }
  } catch (error) {
    console.error('Scraper failed:', error);
    process.exit(1);
  } finally {
    // Close database connection
    await closeDatabase();
  }
}

// Run the scraper
main();
