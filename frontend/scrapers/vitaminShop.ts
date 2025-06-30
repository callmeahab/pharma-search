import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const baseUrls = ['https://vitaminshop.rs/prodavnica'];

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
    await page.waitForSelector('.products li', {
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
      await page.waitForSelector('.products li', { timeout: 10000 });
    } catch (error) {
      console.log('No products found on page');
      return [];
    }

    const products = await page.$$eval(
      '.products li',
      (elements, categoryArg) => {
        return elements
          .map((element) => {
            // Check if product is out of stock
            if (element.querySelector('.ast-shop-product-out-of-stock')) {
              return null;
            }

            const titleElement = element.querySelector('h2');
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
              '.woocommerce-LoopProduct-link',
            ) as HTMLAnchorElement;
            const link = linkElement?.href || '';

            const imgElement = element.querySelector(
              '.woocommerce-LoopProduct-link > img',
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
      // Extract category from URL by taking the segment after domain
      const category = 'suplementi';

      let pageNumber = 1;
      while (true) {
        const pageUrl = `${baseUrl}?product-page=${pageNumber}`;
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
scrapeMultipleBaseUrls().then(async (allProducts) => {
  if (allProducts.length > 0) {
    await insertData(allProducts, 'Vitamin Shop');
  } else {
    console.log('No products found.');
  }
});
