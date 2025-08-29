import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product , initializeDatabase, closeDatabase } from './helpers/database';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://www.lama.rs/lamavita-zdravlje',
  'https://www.lama.rs/proteini',
  'https://www.lama.rs/povecanje-misicne-mase',
  'https://www.lama.rs/rtd-i-zamene-za-obrok',
  'https://www.lama.rs/aminokiseline',
  'https://www.lama.rs/kreatini',
  'https://www.lama.rs/energija',
  'https://www.lama.rs/mrsavljenje-i-definicija',
  'https://www.lama.rs/oprema',
];

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
    await page.waitForSelector('.shopBoxProdN', {
      visible: true,
      timeout: 20000,
    });

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
      await page.waitForSelector('.shopBoxProdN', { timeout: 10000 });
    } catch (error) {
      console.log('No products found on page');
      return [];
    }

    const products = await page.$$eval(
      '.shopBoxProdN',
      (elements, categoryArg) => {
        return elements.map((element) => {
          const titleElement = element.querySelector('.pTl');
          const title = titleElement?.textContent?.trim() || '';

          const priceElement = element.querySelector(
            '.priceProdN p:last-child',
          );
          const price = priceElement?.textContent?.trim() || '';

          const linkElement = element.querySelector(
            '.shopBoxProdN > a',
          ) as HTMLAnchorElement;
          const link = linkElement?.href || '';

          const imgElement = element.querySelector(
            '.shopBoxProdImg > img',
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
      const category = baseUrl.split('/').pop() || 'unknown';
      const pageUrl = `${baseUrl}?items_per_page=All`;
      console.log(`Scraping: ${pageUrl}`);

      const products = await scrapePage(page, pageUrl, category);
      if (products.length === 0) {
        console.log(`No products found for ${category}`);
        continue;
      }

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
    await insertData(allProducts, 'Lama');
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
