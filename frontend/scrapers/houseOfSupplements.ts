import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const baseUrls = [
  'https://houseofsupplements.rs/product-category/protein',
  'https://houseofsupplements.rs/product-category/povecanje-telesne-tezine-i-misicne-mase',
  'https://houseofsupplements.rs/product-category/aminokiseline',
  'https://houseofsupplements.rs/product-category/sagorevaci-masti',
  'https://houseofsupplements.rs/product-category/kreatini',
  'https://houseofsupplements.rs/product-category/no-reaktori',
  'https://houseofsupplements.rs/product-category/energija-i-izdrzljivost',
  'https://houseofsupplements.rs/product-category/vitamini-i-minerali',
  'https://houseofsupplements.rs/product-category/povecanje-testosterona',
  'https://houseofsupplements.rs/product-category/cokoladice-i-napici',
  'https://houseofsupplements.rs/product-category/sosevi-namazi-i-ostalo',
  'https://houseofsupplements.rs/product-category/crosswear',
  'https://houseofsupplements.rs/product-category/oprema-i-rekviziti',
  'https://houseofsupplements.rs/product-category/sejkeri',
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
    await page.waitForSelector('.product-small', {
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
      await page.waitForSelector('.product-small', { timeout: 10000 });
    } catch (error) {
      console.log('No products found on page');
      return [];
    }

    const products = await page.$$eval(
      '.product-small',
      (elements, categoryArg) => {
        return elements
          .map((element) => {
            // Check if product is out of stock
            if (element.querySelector('.out-of-stock-label')) {
              return null;
            }

            const titleElement = element.querySelector('.name.product-title');
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
              '.box-image a',
            ) as HTMLAnchorElement;
            const link = linkElement?.href || '';

            const imgElement = element.querySelector(
              '.box-image img',
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
      // Extract category directly from baseUrl
      const category = baseUrl
        .split('product-category/')[1] // Get everything after product-category/
        .replace(/\/$/, ''); // Remove trailing slash if present

      let pageNumber = 1;
      while (true) {
        const pageUrl = `${baseUrl}/page/${pageNumber}`;
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
    await insertData(allProducts, 'House Of Supplements');
  } else {
    console.log('No products found.');
  }
});
