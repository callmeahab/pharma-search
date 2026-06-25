import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product , initializeDatabase, closeDatabase } from './helpers/database';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const baseUrls = ['https://www.titaniumsport.rs/shop/?et_per_page=-1'];

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

    // Wait for products to be visible
    await page.waitForSelector('.content-product', {
      visible: true,
      timeout: 20000,
    });

    // Scroll to the bottom of the page to ensure all products are loaded
    await ScraperUtils.autoScroll(page);

    // Add a small delay to ensure dynamic content loads
    await ScraperUtils.delay(2000);

    // Check for CAPTCHA
    if (await page.$('.captcha-container')) {
      console.log('CAPTCHA detected, attempting solve...');
      const solved = await ScraperUtils.solveImageCaptcha(page);
      if (!solved) throw new Error('CAPTCHA solve failed');
    }

    // Check if product wrappers exist
    try {
      await page.waitForSelector('.content-product', { timeout: 10000 });
    } catch (error) {
      console.log('No products found on page');
      return [];
    }

    const products = await page.$$eval(
      '.content-product',
      (elements, categoryArg) => {
        return elements
          .map((element) => {
            // Check if product is out of stock
            if (element.querySelector('.stock.out-of-stock')) {
              return null;
            }

            const titleElement = element.querySelector('.product-title');
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
              '.images-slider-wrapper > a',
            ) as HTMLAnchorElement;
            const link = linkElement?.href || '';

            const imgElement = element.querySelector(
              '.images-slider-wrapper > a > img',
            ) as HTMLImageElement;
            const img =
              imgElement?.getAttribute('data-src') || imgElement?.src || '';

            return {
              title,
              price,
              link,
              thumbnail: img,
              photos: img,
              category: categoryArg,
            };
          })
          .filter((product) => product !== null); // Filter out null products (out of stock)
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
    await insertData(allProducts, 'Titanium Sport');
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
