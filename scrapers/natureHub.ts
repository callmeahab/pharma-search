import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product , initializeDatabase, closeDatabase } from './helpers/database';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const baseUrls = [
  'https://www.naturehub.rs/biljni-suplementi',
  'https://www.naturehub.rs/prirodna-kozmetika',
  'https://www.naturehub.rs/proteini-i-fitness',
  'https://www.naturehub.rs/proizvodi',
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
    await page.waitForSelector('.wrapper-grid-view', {
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
      await page.waitForSelector('.wrapper-grid-view', { timeout: 10000 });
    } catch (error) {
      console.log('No products found on page');
      return [];
    }

    const products = await page.$$eval(
      '.wrapper-grid-view',
      (elements, categoryArg) => {
        const baseUrl = 'https://www.naturehub.rs';
        return elements
          .map((element) => {
            // Check if product is out of stock
            if (element.querySelector('.fa.fa-warning')) {
              return null;
            }

            const titleElement = element.querySelector('.title');
            const title = titleElement?.textContent?.trim() || '';

            const price =
              element.querySelector('.current-price ')?.textContent?.trim() ||
              '';

            const linkElement = element.querySelector(
              '.item-data > .img-wrapper > a',
            ) as HTMLAnchorElement;
            const link = linkElement?.href || '';

            const imgElement = element.querySelector(
              '.item-data > .img-wrapper > a > img',
            ) as HTMLImageElement;
            // Convert relative image path to absolute URL
            const imgSrc =
              imgElement?.getAttribute('data-original-img') ||
              imgElement?.src ||
              '';
            const img = imgSrc.startsWith('http')
              ? imgSrc
              : `${baseUrl}${imgSrc}`;

            return {
              title,
              price,
              link,
              thumbnail: img,
              photos: img,
              category: categoryArg,
            };
          })
          .filter((product) => product !== null);
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
      // Extract category from the URL path
      const urlPath = new URL(baseUrl).pathname;
      const category = urlPath.split('/').pop() || 'unknown';

      let pageNumber = 1;
      while (true) {
        const pageUrl = `${baseUrl}/page-${pageNumber}`;
        console.log(`Scraping page: ${pageUrl}`);

        const products = await scrapePage(page, pageUrl, category);
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
    await insertData(allProducts, 'Nature Hub');
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
