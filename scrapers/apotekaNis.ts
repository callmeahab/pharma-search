import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product , initializeDatabase, closeDatabase } from './helpers/database';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://www.apotekanis.co.rs/index.php?route=product/catalog&limit=100',
];

// Function to scrape a single page for products
async function scrapePage(
  page: Page,
  url: string,
  category: string,
): Promise<Product[]> {
  try {
    await page.goto(url, {});

    if (await page.$('.captcha-container')) {
      console.log('CAPTCHA detected, attempting solve...');
      const solved = await ScraperUtils.solveImageCaptcha(page);
      if (!solved) throw new Error('CAPTCHA solve failed');
    }

    try {
      await page.waitForSelector('.product-thumb', { timeout: 10000 });
    } catch (error) {
      console.log('No products found on page');
      return [];
    }

    const products = await page.$$eval(
      '.product-thumb',
      (elements, categoryArg) => {
        return elements.map((element) => {
          const titleElement = element.querySelector('.name');
          const title = titleElement?.textContent?.trim() || '';

          const offStockElement = element.querySelector('.out-of-stock');
          if (offStockElement) {
            console.log(`Out of stock: ${title}`);
            return; // Skip this product if it's out of stock
          }

          const priceElement =
            element.querySelector('.price-normal') ||
            element.querySelector('.price-new');
          const price = priceElement?.textContent?.trim() || '';

          const linkElement = element.querySelector(
            '.name > a',
          ) as HTMLAnchorElement;
          const link = linkElement?.href || '';

          const imgElement = element.querySelector(
            '.product-img img',
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

    return products.filter(
      (product): product is Product => product !== undefined,
    );
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
      let pageNumber = 1;
      while (true) {
        const pageUrl = `${baseUrl}&page=${pageNumber}`;
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
async function main() {
  try {
    // Initialize database connection
    await initializeDatabase();
    
    const allProducts = await scrapeMultipleBaseUrls();
    

  if (allProducts.length > 0) {
    await insertData(allProducts, 'Apotekarska ustanova Nis');
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
