import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product , initializeDatabase, closeDatabase } from './helpers/database';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = ['https://fitlab.rs/product-category/suplementi'];

// Function to scrape a single page for products
async function scrapePage(
  page: Page,
  url: string,
  category: string,
): Promise<Product[]> {
  try {
    console.log(`Navigating to ${url}`);

    // Navigate to the page with a more lenient timeout
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Wait for any dynamic content to load
    await ScraperUtils.delay(5000);

    // Debug: Check if we can see the page content
    const pageContent = await page.content();
    console.log('Page loaded, checking content...');

    // Try to find products using multiple possible selectors
    const selectors = [
      '.products li.product',
      '.products li',
      '.product',
      '.woocommerce-loop-product__link',
    ];

    let productsFound = false;
    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        productsFound = true;
        console.log(`Found products using selector: ${selector}`);
        break;
      } catch (error) {
        console.log(`Selector ${selector} not found`);
      }
    }

    if (!productsFound) {
      console.log('No product selectors found on the page');
      return [];
    }

    // Check for CAPTCHA
    if (await page.$('.captcha-container')) {
      console.log('CAPTCHA detected, attempting solve...');
      const solved = await ScraperUtils.solveImageCaptcha(page);
      if (!solved) throw new Error('CAPTCHA solve failed');
    }

    const products = await page.$$eval(
      '.products li.product, .products li, .product',
      (elements, categoryArg) => {
        return elements.map((element) => {
          const titleElement = element.querySelector(
            'h2, .woocommerce-loop-product__title',
          );
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
            '.woocommerce-LoopProduct-link, .woocommerce-loop-product__link',
          ) as HTMLAnchorElement;
          const link = linkElement?.href || '';

          const imgElement = element.querySelector(
            '.woocommerce-LoopProduct-link > img, .woocommerce-loop-product__link > img',
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

    console.log(`Found ${products.length} products on page`);
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
      // Extract category from URL
      const category = 'suplementi';

      let pageNumber = 1;
      while (true) {
        const pageUrl = `${baseUrl}/page/${pageNumber}`;
        console.log(`Scraping page: ${pageUrl}`);

        // Pass the extracted category to scrapePage
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
    await insertData(allProducts, 'FitLab');
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
