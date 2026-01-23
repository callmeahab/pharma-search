import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product , initializeDatabase, closeDatabase } from './helpers/database';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const baseUrls = [
  'https://www.xlsport.rs/product-category/no-reaktori',
  'https://www.xlsport.rs/product-category/proteini',
  'https://www.xlsport.rs/product-category/sagorevaci-masti',
  'https://www.xlsport.rs/product-category/gh-stimulanti',
  'https://www.xlsport.rs/product-category/amino-kiseline',
  'https://www.xlsport.rs/product-category/kreatini',
  'https://www.xlsport.rs/product-category/vitamaniminerali',
  'https://www.xlsport.rs/product-category/energenti',
  'https://www.xlsport.rs/product-category/gejneri',
  'https://www.xlsport.rs/product-category/zastita-zglobova',
  'https://www.xlsport.rs/product-category/vegan',
  'https://www.xlsport.rs/product-category/biljni-preparati',
  'https://www.xlsport.rs/product-category/imunitet',
  'https://www.xlsport.rs/product-category/potencija',
  'https://www.xlsport.rs/product-category/lecenje-jetre',
  'https://www.xlsport.rs/product-category/lecenje-prostate',
  'https://www.xlsport.rs/product-category/lecenje-srca',
  'https://www.xlsport.rs/product-category/mrp',
  'https://www.xlsport.rs/product-category/rtd',
  'https://www.xlsport.rs/product-category/protein-bar',
  'https://www.xlsport.rs/product-category/oprema',
  'https://www.xlsport.rs/product-category/odeca',
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

    // Extract category from URL path
    const categoryFromUrl =
      url.split('/product-category/')[1]?.split('/')[0]?.split('?')[0] ||
      category;

    // Update selector to match new HTML structure
    await page.waitForSelector('.product-grid-view', {
      visible: true,
      timeout: 20000,
    });

    await ScraperUtils.delay(2000);

    if (await page.$('.captcha-container')) {
      console.log('CAPTCHA detected, attempting solve...');
      const solved = await ScraperUtils.solveImageCaptcha(page);
      if (!solved) throw new Error('CAPTCHA solve failed');
    }

    try {
      await page.waitForSelector('.product-grid-view', { timeout: 10000 });
    } catch (error) {
      console.log('No products found on page');
      return [];
    }

    const products = await page.evaluate(
      (categoryArg) => {
        const productElements = document.querySelectorAll('.product-grid-view');
        return Array.from(productElements)
          .map((element) => {
            // Check if product is out of stock
            if (element.querySelector('.fusion-out-of-stock')) {
              return null;
            }

            const titleElement = element.querySelector('.product-title a');
            const title = titleElement?.textContent?.trim() || '';

            const priceElement = element.querySelector(
              '.woocommerce-Price-amount',
            );
            const priceText = priceElement?.textContent?.trim() || '';
            const price =
              parseFloat(priceText.replace(/[^\d,]/g, '').replace(',', '.')) ||
              0;

            const link = titleElement?.getAttribute('href') || '';

            const imgElement = element.querySelector(
              '.attachment-shop_catalog',
            );
            const img = imgElement?.getAttribute('src') || '';

            return {
              title,
              price: price.toString(), // Convert to string to match Product type
              link,
              thumbnail: img,
              photos: img,
              category: categoryArg, // This will now be the URL segment
            };
          })
          .filter(
            (product): product is NonNullable<typeof product> =>
              product !== null &&
              Boolean(product.title) &&
              Boolean(product.price),
          );
      },
      categoryFromUrl, // Pass the extracted category
    );

    return products;
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
      // Extract category from the base URL
      const category =
        baseUrl.split('/product-category/')[1]?.split('/')[0]?.split('?')[0] ||
        '';

      let pageNumber = 1;
      while (true) {
        const pageUrl =
          pageNumber === 1
            ? `${baseUrl}?product_count=36`
            : `${baseUrl}/page/${pageNumber}/?product_count=36`;

        console.log(`Scraping page: ${pageUrl}`);

        const products = await scrapePage(page, pageUrl, category);

        if (products.length === 0) {
          console.log(
            `Reached last page (${pageNumber}) for category ${category}`,
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
async function main() {
  try {
    // Initialize database connection
    await initializeDatabase();
    
    const allProducts = await scrapeMultipleBaseUrls();
    

  if (allProducts.length > 0) {
    await insertData(allProducts, 'XL Sport');
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
